/**
 * Login page tests — no auth dependency (runs without storageState).
 */

import { test, expect } from "@playwright/test";

// Override project storageState for this file — login tests must start unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login page", () => {
  test("redirects unauthenticated users from / to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows wallet-first auth flow on login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /connect your wallet/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("login page has correct page title", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/arcenpay|dashboard/i);
  });

  test("login page meta description is present", async ({ page }) => {
    await page.goto("/login");
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveCount(1);
  });
});
