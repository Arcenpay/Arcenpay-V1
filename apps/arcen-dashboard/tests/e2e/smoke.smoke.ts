/**
 * Smoke tests — fast sanity checks that run on mobile-safari project too.
 * Covers the absolute minimum: page loads, no JS crashes, key elements present.
 */

import { test, expect } from "@playwright/test";

test("dashboard loads without JS errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Filter known benign warnings from MetaMask SDK / Sentry
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("MetaMask") &&
      !e.includes("_optionalChain") &&
      !e.includes("ResizeObserver"),
  );
  expect(fatalErrors).toHaveLength(0);
});

test("health check endpoint returns 200", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json().catch(() => ({}));
  expect(body).toHaveProperty("status");
});

test("nonce endpoint requires authentication", async ({ request }) => {
  const res = await request.get("/api/auth/nonce");
  expect(res.status()).toBe(401);
});
