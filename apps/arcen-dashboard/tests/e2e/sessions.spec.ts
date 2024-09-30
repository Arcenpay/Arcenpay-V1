/**
 * Sessions section tests.
 * Requires authenticated session (storageState from auth.setup.ts).
 */

import { test, expect } from "@playwright/test";
import { setupMockRoutes } from "./fixtures/mock-routes";

test.describe("Sessions section", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto("/");
    await page.getByRole("button", { name: /sessions/i }).click();
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();
  });

  test("renders summary metric cards", async ({ page }) => {
    // Active Sessions, Total Settled, Pending Proofs cards
    await expect(page.getByText(/active sessions/i)).toBeVisible();
    await expect(page.getByText(/total settled/i)).toBeVisible();
    await expect(page.getByText(/pending proofs/i)).toBeVisible();
  });

  test("Fund New Session button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /fund new session/i })).toBeVisible();
  });

  test("Fund Session dialog opens and has amount field", async ({ page }) => {
    await page.getByRole("button", { name: /fund new session/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/amount/i)).toBeVisible();
  });

  test("sessions table or empty state is shown", async ({ page }) => {
    // Either session rows or empty-state placeholder
    const table = page.locator("table");
    const emptyState = page.getByText(/no active sessions/i);
    const hasTable = await table.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("Proof Submission Log section is visible", async ({ page }) => {
    await expect(page.getByText(/proof submission log/i)).toBeVisible();
  });
});
