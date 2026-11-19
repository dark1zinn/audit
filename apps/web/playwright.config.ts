import { defineConfig, devices } from "@playwright/test"

// The suite runs against a live server. `bun run e2e` (repo root) builds the web app, starts the
// server on a fresh database and sets E2E_BASE_URL; running Playwright directly needs it too.
const baseURL = process.env.E2E_BASE_URL
if (baseURL === undefined || baseURL === "") {
  throw new Error("E2E_BASE_URL is required. Run `bun run e2e` from the repository root.")
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  // One worker: specs share the owner session and the sign-in rate limit is 5 per minute per IP.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions:
      process.env.PW_CHROMIUM === undefined || process.env.PW_CHROMIUM === ""
        ? {}
        : { executablePath: process.env.PW_CHROMIUM },
  },
  projects: [
    {
      // First-run setup; saves the owner session that every other spec reuses.
      name: "setup",
      testMatch: "setup.e2e.ts",
    },
    {
      name: "chromium",
      testIgnore: "setup.e2e.ts",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        // Relative to the working directory (`apps/web`), where the runner invokes Playwright.
        storageState: "e2e/.auth/owner.json",
      },
    },
  ],
})
