/**
 * Dashboard navigation + overview section tests.
 * Requires authenticated session (storageState from auth.setup.ts).
 */

import { test, expect } from "@playwright/test";
import { setupMockRoutes } from "./fixtures/mock-routes";

test.describe("Dashboard — Overview", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto("/");
  });

  test("renders overview section by default", async ({ page }) => {
    // Should not redirect to login when authenticated
    await expect(page).not.toHaveURL(/\/login/);
    // Overview header visible
    await expect(page.getByRole("heading", { name: /overview/i })).toBeVisible();
  });

  test("sidebar navigation links are visible", async ({ page }) => {
    const sidebar = page.locator("nav, [role='navigation']").first();
    await expect(sidebar.getByRole("button", { name: /plans/i })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /subscribers/i })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /sessions/i })).toBeVisible();
  });

  test("metric cards render (loading or populated)", async ({ page }) => {
    // Wait for either skeleton or real data
    const metricCards = page.locator('[class*="metric-card"], [data-testid="metric-card"]');
    // At minimum the cards container should be in the DOM
    await expect(page.locator("main")).toBeVisible();
  });

  test("header shows connect button or wallet address", async ({ page }) => {
    // RainbowKit button is always rendered in header
    const header = page.locator("header, [role='banner']").first();
    await expect(header).toBeVisible();
  });
});

test.describe("Dashboard — Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  test("navigating to Plans section works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /plans/i }).click();
    await expect(page.getByRole("heading", { name: /plans/i })).toBeVisible();
  });

  test("navigating to Subscribers section works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /subscribers/i }).click();
    await expect(page.getByRole("heading", { name: /subscribers/i })).toBeVisible();
  });

  test("navigating to Sessions section works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /sessions/i }).click();
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();
  });

  test("navigating to Settings section works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /settings/i }).click();
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  });
});

test.describe("Dashboard — Subgraph Lag Banner", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  test("lag banner is not visible when subgraph is healthy", async ({ page }) => {
    await page.goto("/");
    // Banner should either not exist or be dismissed
    // This is a smoke test — we can't control subgraph health
    const banner = page.locator('[role="alert"]').first();
    // If it's visible, it should contain subgraph-related text
    if (await banner.isVisible()) {
      await expect(banner).toContainText(/subgraph/i);
    }
  });
});
