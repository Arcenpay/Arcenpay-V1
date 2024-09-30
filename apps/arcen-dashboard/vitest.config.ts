import path from "node:path";
import { defineConfig } from "vitest/config";

const isCI = !!process.env.CI;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    include: [
      "lib/**/*.test.ts",
      "src/**/*.test.ts",
      "app/**/*.test.ts",
      "components/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    exclude: [
      "tests/e2e/**",
      "node_modules/**",
      ".next/**",
      // Skip tests that require a real database connection in CI
      ...(isCI ? ["lib/__tests__/db.test.ts"] : []),
    ],
  },
});
