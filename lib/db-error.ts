/**
 * The sentence a screen may show for a database failure.
 *
 * Drizzle wraps a driver error as `Failed query: <the SQL> params: <every value>`. That
 * string is useful in a server log and wrong on a screen: it prints the statement and the
 * submission's own values — collector ids, coordinates — into an operator's warning or a
 * map badge. The Postgres reason (`invalid input value for enum …`, `connection
 * timeout`) is on `cause`; that is what leaves the server. The full error is logged.
 */
export function publicDbError(scope: string, error: unknown): string {
  console.error(`[${scope}]`, error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  const message = cause ?? (error instanceof Error ? error.message : String(error));
  if (/^Failed query:/i.test(message)) return "The database rejected the write.";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
