import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for every feature on `main`. See tests/e2e/README.md.
 *
 * These run **live**: real Cognito sign-ins, real Azure Foundry calls for the AI
 * features (paid), and real writes to the shared RDS database and S3 bucket that the
 * deployed site uses. The smart-pickup tests run against DynamoDB Local, which this
 * config starts alongside the app.
 */

// `.env.local` holds the Cognito, Azure, S3 and RDS settings, plus E2E_PASSWORD for the
// demo accounts. Loaded here so the test process can read E2E_PASSWORD; the app server
// reads the same file on its own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Missing file: the global setup reports what is absent.
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Model calls are the slow part: a photo plus a Hindi voice note can take 30 s+.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Files run in parallel; tests inside a file run in order, because several build on
  // the one before (a valuation creates the item the decision test then decides).
  fullyParallel: false,
  workers: 3,
  // One retry, because these tests cross the internet to Azure, S3 and RDS and a
  // dropped packet is not a product failure. A test that only passes on its retry is
  // reported as "flaky" in the summary, never silently as passed.
  retries: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]],
  outputDir: "tests/e2e/.results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          // DynamoDB Local + tables + seed + the payout stream relay, for smart pickup.
          command: "npm run pickup:local",
          url: "http://127.0.0.1:8000",
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          // A production build, so the tests exercise what Amplify serves rather than
          // the dev server's on-demand compilation. `npm run build`, not `next build`,
          // so the `prebuild` hook vendors the map's worker and stylesheet first.
          command: `npm run build && npx next start -p ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 300_000,
          env: {
            PICKUP_LOCAL: "true",
            PICKUP_DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
          },
        },
      ],
});
