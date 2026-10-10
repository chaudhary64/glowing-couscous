/**
 * Feature 4 on a laptop: DynamoDB Local, the three tables, the catalogue, and the
 * stream that pays the collector — no AWS account, no Docker.
 *
 *   npm run pickup:local
 *
 * What it does, in order, and then keeps doing until Ctrl-C:
 *
 *   1. starts DynamoDB Local (`.dynamodb/DynamoDBLocal.jar`, data kept in
 *      `.dynamodb/data` so a restart keeps the demo's loads) unless one is already
 *      listening on the port
 *   2. creates the tables with the keys and indexes `scripts/pickup-setup.sh` creates,
 *      and the stream on the pickups table
 *   3. seeds the recycler catalogue with `scripts/pickup-seed.mjs`, the same seeder the
 *      cloud uses
 *   4. polls the pickups stream and hands each batch to `aws/pickup/payout.mjs` — the
 *      job the Lambda event-source mapping does in the cloud. That is the step that
 *      turns a settled load into a paid one, so the phone's UPI screen depends on this
 *      process running.
 *
 * The Next.js app then runs the API Lambda's own handler in-process when
 * `PICKUP_LOCAL=true` (see `lib/pickup/api.ts`), so the code exercised locally is the
 * code that deploys. Put these in `.env.local`:
 *
 *   PICKUP_LOCAL=true
 *   PICKUP_DYNAMODB_ENDPOINT=http://127.0.0.1:8000
 *
 * DynamoDB Local needs Java 17+: `brew install openjdk`. The jar is downloaded by
 * `npm run pickup:local -- --install` if it is not there.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
} from "@aws-sdk/client-dynamodb-streams";

const PORT = Number(process.env.PICKUP_LOCAL_PORT ?? 8000);
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const REGION = "ap-south-1";
const DIR = ".dynamodb";
const JAR = `${DIR}/DynamoDBLocal.jar`;
const DOWNLOAD = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz";

const TABLES = {
  recyclers: process.env.PICKUP_TABLE_RECYCLERS || "ecoepr-recyclers",
  pickups: process.env.PICKUP_TABLE_PICKUPS || "ecoepr-pickups",
  creditNotes: process.env.PICKUP_TABLE_CREDIT_NOTES || "ecoepr-credit-notes",
};

// Everything this process imports from `aws/pickup/` reads these, so they are set
// before the dynamic import of the payout handler below.
Object.assign(process.env, {
  PICKUP_DYNAMODB_ENDPOINT: ENDPOINT,
  PICKUP_REGION: REGION,
  PICKUP_TABLE_RECYCLERS: TABLES.recyclers,
  PICKUP_TABLE_PICKUPS: TABLES.pickups,
  PICKUP_TABLE_CREDIT_NOTES: TABLES.creditNotes,
});

const local = { endpoint: ENDPOINT, region: REGION, credentials: { accessKeyId: "local", secretAccessKey: "local" } };
const ddb = new DynamoDBClient(local);
const streams = new DynamoDBStreamsClient(local);

const say = (line) => console.log(`[pickup:local] ${line}`);

/* ------------------------------------------------------------ DynamoDB Local */

function findJava() {
  for (const candidate of ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java", "java"]) {
    try {
      execFileSync(candidate, ["-version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

async function listening() {
  try {
    await fetch(ENDPOINT, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

function install() {
  mkdirSync(DIR, { recursive: true });
  say(`downloading DynamoDB Local into ${DIR}/`);
  execFileSync("bash", ["-c", `curl -fsSL "${DOWNLOAD}" | tar -xz -C "${DIR}"`], { stdio: "inherit" });
}

async function startDynamo() {
  if (await listening()) {
    say(`DynamoDB Local already listening on ${ENDPOINT}`);
    return null;
  }
  if (!existsSync(JAR)) {
    if (process.argv.includes("--install")) install();
    else {
      console.error(`${JAR} is missing. Run: npm run pickup:local -- --install`);
      process.exit(1);
    }
  }
  const java = findJava();
  if (!java) {
    console.error("Java is not installed. DynamoDB Local needs it: brew install openjdk");
    process.exit(1);
  }
  mkdirSync(`${DIR}/data`, { recursive: true });
  const child = spawn(
    java,
    ["--enable-native-access=ALL-UNNAMED", `-Djava.library.path=${DIR}/DynamoDBLocal_lib`, "-jar", JAR, "-sharedDb", "-dbPath", `${DIR}/data`, "-port", String(PORT)],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  child.on("exit", (code) => {
    say(`DynamoDB Local exited (${code})`);
    process.exit(code ?? 1);
  });
  for (let i = 0; i < 40; i += 1) {
    if (await listening()) {
      say(`DynamoDB Local started on ${ENDPOINT}`);
      return child;
    }
    await sleep(250);
  }
  console.error("DynamoDB Local did not start within 10 seconds");
  child.kill();
  process.exit(1);
}

/* -------------------------------------------------------------------- tables */

// The same keys and indexes as `scripts/pickup-setup.sh`. Duplicated rather than
// shared because the setup script is plain bash with JSON heredocs; if one changes, the
// other must, and `npm run pickup:test` fails loudly on a missing index.
const gsi = (name, hash, range) => ({
  IndexName: name,
  KeySchema: [
    { AttributeName: hash, KeyType: "HASH" },
    { AttributeName: range, KeyType: "RANGE" },
  ],
  Projection: { ProjectionType: "ALL" },
});
const attrs = (...names) => names.map((name) => ({ AttributeName: name, AttributeType: "S" }));
const keys = (hash, range) => [
  { AttributeName: hash, KeyType: "HASH" },
  { AttributeName: range, KeyType: "RANGE" },
];

const DEFINITIONS = [
  {
    TableName: TABLES.recyclers,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: attrs("pk", "sk", "stream", "facilityId", "catalogueKey", "code"),
    KeySchema: keys("pk", "sk"),
    GlobalSecondaryIndexes: [gsi("stream-index", "stream", "facilityId"), gsi("catalogue-index", "catalogueKey", "code")],
  },
  {
    TableName: TABLES.pickups,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: attrs("pickupId", "sk", "collectorKey", "requestedAt", "facilityKey", "facilityDay"),
    KeySchema: keys("pickupId", "sk"),
    GlobalSecondaryIndexes: [gsi("collector-index", "collectorKey", "requestedAt"), gsi("facility-index", "facilityKey", "facilityDay")],
    StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
  },
  {
    TableName: TABLES.creditNotes,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: attrs("noteId", "sk", "collectorKey", "issuedAt", "pickupId"),
    KeySchema: keys("noteId", "sk"),
    GlobalSecondaryIndexes: [gsi("collector-index", "collectorKey", "issuedAt"), gsi("pickup-index", "pickupId", "issuedAt")],
  },
];

async function describe(name) {
  try {
    return (await ddb.send(new DescribeTableCommand({ TableName: name }))).Table;
  } catch (error) {
    if (error?.name === "ResourceNotFoundException") return null;
    throw error;
  }
}

async function ensureTables() {
  for (const definition of DEFINITIONS) {
    const existing = await describe(definition.TableName);
    if (!existing) {
      await ddb.send(new CreateTableCommand(definition));
      say(`table created: ${definition.TableName}`);
    } else if (definition.StreamSpecification && !existing.StreamSpecification?.StreamEnabled) {
      await ddb.send(
        new UpdateTableCommand({ TableName: definition.TableName, StreamSpecification: definition.StreamSpecification }),
      );
      say(`stream enabled: ${definition.TableName}`);
    } else {
      say(`table exists:  ${definition.TableName}`);
    }
  }
}

function seed() {
  execFileSync(process.execPath, ["scripts/pickup-seed.mjs"], { stdio: "inherit", env: process.env });
}

/* ------------------------------------------------------------- stream relay */

/**
 * The local stand-in for the Lambda event-source mapping: every shard, from its oldest
 * record, batches handed to the payout handler. Starting from the oldest record rather
 * than the newest is safe because payouts are idempotent, and it means a settlement made
 * while this process was down is paid when it comes back — which is what the managed
 * mapping does too, within the stream's 24-hour retention.
 */
async function relayStream() {
  const { handler } = await import("../aws/pickup/payout.mjs");
  const table = await describe(TABLES.pickups);
  const streamArn = table?.LatestStreamArn;
  if (!streamArn) throw new Error(`${TABLES.pickups} has no stream`);
  say(`relaying ${TABLES.pickups} stream to the payout handler`);

  const iterators = new Map(); // shardId -> iterator | null (closed)
  let lastDiscovery = 0;

  for (;;) {
    if (Date.now() - lastDiscovery > 5000) {
      const { StreamDescription } = await streams.send(new DescribeStreamCommand({ StreamArn: streamArn }));
      for (const shard of StreamDescription?.Shards ?? []) {
        if (iterators.has(shard.ShardId)) continue;
        const { ShardIterator } = await streams.send(
          new GetShardIteratorCommand({ StreamArn: streamArn, ShardId: shard.ShardId, ShardIteratorType: "TRIM_HORIZON" }),
        );
        iterators.set(shard.ShardId, ShardIterator ?? null);
      }
      lastDiscovery = Date.now();
    }

    for (const [shardId, iterator] of iterators) {
      if (!iterator) continue;
      let result;
      try {
        result = await streams.send(new GetRecordsCommand({ ShardIterator: iterator }));
      } catch (error) {
        // DynamoDB Local trims an iterator that was taken on a shard before its first
        // record, and any iterator expires after 15 minutes. Both mean "ask again":
        // forgetting the shard makes the next discovery take a fresh TRIM_HORIZON one,
        // and the payout's idempotency makes re-reading from the start harmless.
        if (error?.name === "TrimmedDataAccessException" || error?.name === "ExpiredIteratorException") {
          iterators.delete(shardId);
          lastDiscovery = 0;
          continue;
        }
        say(`stream read failed (${error?.name ?? error}); retrying`);
        continue;
      }
      const records = result.Records ?? [];
      if (records.length) {
        const outcome = await handler({ Records: records });
        const failed = outcome?.batchItemFailures?.length ?? 0;
        if (failed) {
          // Retry from the first failure, as the managed mapping would.
          const first = outcome.batchItemFailures[0].itemIdentifier;
          say(`payout failed at ${first}; retrying`);
          const { ShardIterator } = await streams.send(
            new GetShardIteratorCommand({
              StreamArn: streamArn,
              ShardId: shardId,
              ShardIteratorType: "AT_SEQUENCE_NUMBER",
              SequenceNumber: first,
            }),
          );
          iterators.set(shardId, ShardIterator ?? null);
          continue;
        }
      }
      iterators.set(shardId, result.NextShardIterator ?? null);
    }
    await sleep(400);
  }
}

/* ---------------------------------------------------------------------- main */

const child = await startDynamo();
const stop = () => {
  child?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// A crash must not leave DynamoDB Local holding the port for the next run.
process.on("exit", () => child?.kill());

await ensureTables();
seed();
say("ready — start the app with `npm run dev` and open /demo");
await relayStream();
