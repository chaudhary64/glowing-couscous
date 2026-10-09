/**
 * DynamoDB access, with the AttributeValue marshalling written out by hand.
 *
 * The Lambda deploys as source files and nothing else, so it cannot depend on a package
 * that the Node runtime does not already ship. `@aws-sdk/client-dynamodb` is part of the
 * Node 18+ runtime; `@aws-sdk/lib-dynamodb` — the document client that does this
 * marshalling for you — is not guaranteed to be, and vendoring a `node_modules` tree
 * into a zip to get it would trade a 30-line function for a build step.
 *
 * So: one small marshaller, used by the Lambda and by the check scripts, which is also
 * why the same code path is exercised in both places. It covers exactly the shapes this
 * feature stores — string, number, boolean, null, array, plain object, and the string
 * and number sets — and throws on anything else rather than guessing.
 *
 * ## The one thing to keep in mind
 *
 * DynamoDB numbers are arbitrary-precision decimals and only safe up to 38 digits of
 * precision; money here is integer paise and mass is integer grams, so nothing in this
 * feature is close to that edge. `fromAttr` returns a JS number, which is a deliberate
 * choice for this dataset and would be the wrong one for a 64-bit ledger id.
 */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";

let client = null;

/**
 * Created lazily so importing this module has no side effects, which is what lets the
 * check scripts import it before they know whether the environment is configured.
 */
export function db() {
  if (!client) client = new DynamoDBClient({});
  return client;
}

/* --------------------------------------------------------------- marshalling */

export function toAttr(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Refusing to store a non-finite number: ${value}`);
    }
    return { N: String(value) };
  }
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) {
    // A list, never a set: order and duplicates are meaningful in every array this
    // feature stores, and a DynamoDB set silently drops both.
    return { L: value.map(toAttr) };
  }
  if (typeof value === "object") {
    const map = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      map[key] = toAttr(entry);
    }
    return { M: map };
  }
  throw new Error(`Unsupported DynamoDB value of type ${typeof value}`);
}

export function fromAttr(attr) {
  if (attr === null || attr === undefined) return null;
  if (typeof attr !== "object") return null;
  if ("S" in attr) return attr.S;
  if ("N" in attr) return Number(attr.N);
  if ("BOOL" in attr) return attr.BOOL;
  if ("NULL" in attr) return null;
  if ("L" in attr) return (attr.L ?? []).map(fromAttr);
  if ("M" in attr) {
    const object = {};
    for (const [key, entry] of Object.entries(attr.M ?? {})) {
      object[key] = fromAttr(entry);
    }
    return object;
  }
  if ("SS" in attr) return [...(attr.SS ?? [])];
  if ("NS" in attr) return (attr.NS ?? []).map(Number);
  return null;
}

/** One stored item as a plain object, internal key attributes included. */
export function fromItem(item) {
  if (!item) return null;
  const object = {};
  for (const [key, entry] of Object.entries(item)) {
    object[key] = fromAttr(entry);
  }
  return object;
}

export function toItem(object) {
  const item = {};
  for (const [key, entry] of Object.entries(object)) {
    if (entry === undefined) continue;
    item[key] = toAttr(entry);
  }
  return item;
}

/* ------------------------------------------------------------------ commands */

export async function getItem(table, key) {
  const result = await db().send(
    new GetItemCommand({
      TableName: table,
      Key: toItem(key),
      ConsistentRead: true,
    }),
  );
  return fromItem(result.Item);
}

export async function putItem(table, item, options = {}) {
  await db().send(
    new PutItemCommand({
      TableName: table,
      Item: toItem(item),
      ConditionExpression: options.condition,
      ExpressionAttributeNames: options.names,
      ExpressionAttributeValues: options.values
        ? toItem(options.values)
        : undefined,
    }),
  );
}

export async function query(table, options) {
  // A global secondary index cannot be read consistently — DynamoDB refuses the whole
  // request, and the error names neither the index nor the caller. Every read of this
  // feature that matters (a live capacity check, a settlement race) goes through a
  // table key, so the strong read is where it is available and the index is
  // eventually-consistent by force rather than by an argument at each call site.
  const consistent = options.index ? false : options.consistent ?? false;
  const rows = [];
  let startKey;
  do {
    const result = await db().send(
      new QueryCommand({
        TableName: table,
        IndexName: options.index,
        KeyConditionExpression: options.keyCondition,
        FilterExpression: options.filter,
        ExpressionAttributeNames: options.names,
        ExpressionAttributeValues: toItem(options.values ?? {}),
        ScanIndexForward: options.forward ?? true,
        ConsistentRead: consistent,
        Limit: options.limit,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of result.Items ?? []) rows.push(fromItem(item));
    startKey = result.LastEvaluatedKey;
    if (options.limit && rows.length >= options.limit) break;
  } while (startKey);
  return rows;
}

export async function updateItem(table, key, options) {
  const result = await db().send(
    new UpdateItemCommand({
      TableName: table,
      Key: toItem(key),
      UpdateExpression: options.update,
      ConditionExpression: options.condition,
      ExpressionAttributeNames: options.names,
      ExpressionAttributeValues: options.values
        ? toItem(options.values)
        : undefined,
      ReturnValues: options.returns ?? "ALL_NEW",
    }),
  );
  return fromItem(result.Attributes);
}

/**
 * A full read, for the seeder only. The API never scans: every route it serves has a
 * key, and a route that needed a full read of a table would be a route whose access
 * pattern had not been thought about yet.
 */
export async function scan(table) {
  const rows = [];
  let startKey;
  do {
    const result = await db().send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }),
    );
    for (const item of result.Items ?? []) rows.push(fromItem(item));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

export async function deleteItem(table, key) {
  await db().send(new DeleteItemCommand({ TableName: table, Key: toItem(key) }));
}

/**
 * A cross-table transaction. Used once, by settlement: the pickup's status and the
 * credit note have to move together, and a note that exists without a settled pickup
 * (or a settled pickup with no note) is exactly the kind of half-state this feature
 * exists to make impossible.
 */
export async function transactWrite(items) {
  await db().send(
    new TransactWriteItemsCommand({
      TransactItems: items.map((entry) => {
        const common = {
          TableName: entry.table,
          ConditionExpression: entry.condition,
          ExpressionAttributeNames: entry.names,
          ExpressionAttributeValues: entry.values
            ? toItem(entry.values)
            : undefined,
        };
        if (entry.kind === "check") {
          return { ConditionCheck: { ...common, Key: toItem(entry.key) } };
        }
        if (entry.kind === "update") {
          return {
            Update: {
              ...common,
              Key: toItem(entry.key),
              UpdateExpression: entry.update,
            },
          };
        }
        return { Put: { ...common, Item: toItem(entry.item) } };
      }),
    }),
  );
}
