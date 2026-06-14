import { defineConfig, devices } from "@playwright/test";

/**
 * Arcenpay Dashboard — Playwright E2E Test Configuration
 *
 * Tests run against a locally running Next.js dev server by default.
 * In CI, PLAYWRIGHT_BASE_URL is set to the deployed preview/staging URL.
 *
 * Auth state: Tests that require login use storageState from
 * tests/e2e/.auth/user.json, which is populated by tests/e2e/auth.setup.ts
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "on-failure" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Auth setup — runs first, saves session state
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    // Desktop Chrome — primary test suite
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // Mobile Safari — smoke tests only
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 15"],
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testMatch: /.*\.smoke\.ts/,
    },
  ],

  // Start backend + Next.js dev servers before running tests (local only).
  // In CI, PLAYWRIGHT_BASE_URL must point to an already-running server
  // (e.g. a Vercel preview deployment or a server started in a prior CI step).
  webServer: process.env.CI
    ? undefined
    : [
        {
          command: "npm run dev --workspace @arcenpay/backend",
          url: "http://localhost:3300/health",
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            NODE_ENV: "test",
            SENTRY_DSN: "",
          },
        },
        {
          command: "npm run dev",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            // Prevent Next.js from requiring production env vars during tests
            NODE_ENV: "test",
            BACKEND_URL: "http://localhost:3300",
            NEXT_PUBLIC_BACKEND_URL: "http://localhost:3300",
            // Silence the subgraph "not configured" warning — tests mock the endpoint
            NEXT_PUBLIC_GRAPH_URL: "http://localhost:9999/mock-subgraph",
            // Route facilitator calls to localhost so Playwright can intercept them
            NEXT_PUBLIC_FACILITATOR_URL: "http://localhost:3402",
            // Disable Sentry in tests
            SENTRY_DSN: "",
          },
        },
      ],
});
