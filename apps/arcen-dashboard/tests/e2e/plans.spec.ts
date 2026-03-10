/**
 * Plans section tests.
 * Requires authenticated session (storageState from auth.setup.ts).
 */

import { test, expect } from "@playwright/test";
import { setupMockRoutes } from "./fixtures/mock-routes";

test.describe("Plans section", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto("/");
    await page.getByRole("button", { name: /plans/i }).click();
    await expect(page.getByRole("heading", { name: /plans/i })).toBeVisible();
  });

  test("renders plan cards or empty state", async ({ page }) => {
    // Either plan cards or empty state message is shown
    const planCards = page.locator('[data-testid="plan-card"]');
    const emptyState = page.getByText(/no plans/i);
    const hasCards = await planCards.count() > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test("Create Plan button is visible and clickable", async ({ page }) => {
    const createBtn = page.getByRole("button", { name: /create plan/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    // Dialog or form should open
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Create Plan dialog has required fields", async ({ page }) => {
    await page.getByRole("button", { name: /create plan/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/plan name/i)).toBeVisible();
    await expect(dialog.getByLabel(/price/i)).toBeVisible();
    await expect(dialog.getByLabel(/billing interval/i)).toBeVisible();
  });

  test("Create Plan form validates required fields", async ({ page }) => {
    await page.getByRole("button", { name: /create plan/i }).click();
    const dialog = page.getByRole("dialog");
    // Try to submit without filling required fields
    await dialog.getByRole("button", { name: /create|submit/i }).click();
    // Should show validation error or keep dialog open
    await expect(dialog).toBeVisible();
  });

  test("Cancel button closes dialog without creating plan", async ({ page }) => {
    await page.getByRole("button", { name: /create plan/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
