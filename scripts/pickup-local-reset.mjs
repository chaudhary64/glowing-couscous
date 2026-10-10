/**
 * Empty the local pickups and credit-notes tables (DynamoDB Local only).
 *
 *   npm run pickup:local:reset
 *
 * Every local handoff routes 37.5 kg of lead-acid to RX-02, whose licence is 4,000 kg a
 * day, so ~106 demo or test handoffs in one day fill it and the router (correctly)
 * refuses the next load with "No licensed recycler can take Lead-acid batteries". This
 * clears the local loads, notes and audit events so the demo starts from an empty day.
 * The recycler catalogue is left alone.
 *
 * It refuses to run against anything but a local endpoint: the deployed tables in AWS
 * are the compliance trail and nothing here may delete from them.
 */
import { BatchWriteItemCommand, DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.PICKUP_DYNAMODB_ENDPOINT || "http://127.0.0.1:8000";
const { hostname } = new URL(endpoint);
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
  console.error(`Refusing to reset ${endpoint}: only DynamoDB Local may be emptied.`);
  process.exit(1);
}

const client = new DynamoDBClient({
  endpoint,
  region: process.env.PICKUP_REGION || "ap-south-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const TABLES = [
  { name: process.env.PICKUP_TABLE_PICKUPS || "ecoepr-pickups", keys: ["pickupId", "sk"] },
  { name: process.env.PICKUP_TABLE_CREDIT_NOTES || "ecoepr-credit-notes", keys: ["noteId", "sk"] },
];

for (const table of TABLES) {
  let removed = 0;
  let startKey;
  do {
    const page = await client.send(
      new ScanCommand({ TableName: table.name, ExclusiveStartKey: startKey, ProjectionExpression: table.keys.join(", ") }),
    );
    const items = page.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      let pending = { [table.name]: items.slice(i, i + 25).map((item) => ({ DeleteRequest: { Key: item } })) };
      removed += pending[table.name].length;
      // BatchWriteItem may hand some deletes back unprocessed; resend until none remain.
      while (pending[table.name]?.length) {
        const result = await client.send(new BatchWriteItemCommand({ RequestItems: pending }));
        pending = result.UnprocessedItems ?? {};
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  console.log(`[pickup:local:reset] ${table.name}: removed ${removed} item(s)`);
}
