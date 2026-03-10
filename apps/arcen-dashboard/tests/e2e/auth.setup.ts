/**
 * Auth setup — runs before all tests that require a logged-in user.
 *
 * This file saves browser storage state (cookies/localStorage) to
 * tests/e2e/.auth/user.json after completing the SIWE login flow.
 *
 * Because the dashboard uses SIWE (Sign-In with Ethereum), real wallet
 * interaction is needed. In CI, inject a test wallet via environment:
 *   PLAYWRIGHT_TEST_WALLET_PK  — 0x-prefixed private key of a funded test wallet
 *
 * For local dev, you can skip auth setup entirely and run tests against
 * a server with auth disabled (SKIP_AUTH=true in .env.local).
 */

import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // If a pre-baked session cookie is available (injected by CI), use it
  const sessionCookie = process.env.PLAYWRIGHT_SESSION_COOKIE;
  if (sessionCookie) {
    await page.context().addCookies([
      {
        name: "meap-session",
        value: sessionCookie,
        domain: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").hostname,
        path: "/",
        httpOnly: true,
        secure: process.env.CI === "true",
        sameSite: "Lax",
      },
    ]);
    // Verify the cookie works by navigating to the dashboard
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  // If SKIP_AUTH is set, create an empty auth state (server must have auth disabled)
  if (process.env.SKIP_AUTH === "true") {
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  // Navigate to login page and attempt SIWE auth
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);

  // NOTE: Full SIWE flow requires a browser wallet extension.
  // For automated CI testing, use PLAYWRIGHT_SESSION_COOKIE instead.
  // This block is provided as a manual test aid.
  console.warn(
    "[auth.setup] No PLAYWRIGHT_SESSION_COOKIE provided. " +
      "Auth setup will be skipped — authenticated tests will fail. " +
      "Set PLAYWRIGHT_SESSION_COOKIE to a valid session JWT or SKIP_AUTH=true.",
  );

  // Save empty state so downstream tests can run (they will fail if they need auth)
  await page.context().storageState({ path: AUTH_FILE });
});
