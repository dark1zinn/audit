import { defineConfig, devices } from "@playwright/test"

const baseURL = "http://localhost:4173"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 2,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions:
      process.env.PW_CHROMIUM === undefined ? {} : { executablePath: process.env.PW_CHROMIUM },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bunx --bun vite preview --port 4173 --strictPort",
    url: baseURL,
    reuseExistingServer: process.env.CI === undefined,
  },
})
