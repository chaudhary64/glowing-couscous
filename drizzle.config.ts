import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * The env is loaded with Next's own loader rather than `dotenv`, so the CLI reads
 * exactly the values the app reads — `.env.local` included, in the same precedence
 * order. A second env loader is a second set of rules for the same file, and the two
 * eventually disagree about which value is in force.
 *
 * `DATABASE_URL` points at RDS. RDS has `rds.force_ssl=1` set, so a connection
 * without TLS is refused by the server rather than silently downgraded — the URL
 * carries `sslmode=no-verify`, which encrypts without verifying the certificate
 * chain. Move to `sslmode=verify-full` with the RDS CA bundle when the app ships to
 * real users.
 */
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or export it in the shell.",
  );
}

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },

  /** Ask before dropping anything the schema no longer declares. */
  strict: true,
  verbose: true,
});
