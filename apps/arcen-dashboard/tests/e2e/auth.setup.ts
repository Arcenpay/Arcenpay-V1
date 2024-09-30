/**
 * Auth setup — runs before all tests that require a logged-in user.
 *
 * This file saves browser storage state (cookies/localStorage) to
 * tests/e2e/.auth/user.json after a successful dashboard auth session.
 *
 * Authenticated tests require PLAYWRIGHT_SESSION_COOKIE. Without it, setup
 * fails early with a clear message instead of producing downstream redirects.
 */

import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // If a pre-baked session cookie is available (injected by CI), use it
  const sessionCookie = process.env.PLAYWRIGHT_SESSION_COOKIE;
  if (sessionCookie) {
    await page.context().addCookies([
      {
        name: "arcen_session",
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

  // Navigate to login page. A fully automated email-code flow is not wired
  // into Playwright yet, so CI should inject PLAYWRIGHT_SESSION_COOKIE.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);

  throw new Error(
    "PLAYWRIGHT_SESSION_COOKIE is required for authenticated dashboard E2E tests. " +
      "Create a valid arcen_session cookie first, then rerun test:e2e.",
  );
});
