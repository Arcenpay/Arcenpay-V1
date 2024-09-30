import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "packages", "internal-core", "src");

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error(
    "Usage: node scripts/sync-internal-core.mjs <package-name> [...]",
  );
  process.exit(1);
}

await stat(sourceDir);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLock(lockDir, fn) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockDir);
      try {
        return await fn();
      } finally {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (error && error.code === "EEXIST") {
        await sleep(50);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Timed out waiting for sync lock: ${lockDir}`);
}

for (const target of targets) {
  const targetDir = path.join(
    repoRoot,
    "packages",
    target,
    "src",
    "internal",
    "core",
  );
  const lockDir = `${targetDir}.lock`;

  await withLock(lockDir, async () => {
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });

    // ── Post-sync overrides ──────────────────────────────────────────────
    // The SDK packages are published to npm and should NOT expose
    // process.env-based url configuration to consumers. Override the
    // app-origin module to use hardcoded production URLs.
    // The source-of-truth in internal-core keeps env-var fallbacks because
    // it's also used by the backend/dashboard build (which needs localhost).
    const appOriginTarget = path.join(targetDir, "app-origin.ts");
    const hardcoded = [
      'export const ARCENPAY_API_URL = "https://api.arcenpay.com";',
      'export const ARCENPAY_APP_URL = "https://app.arcenpay.com";',
      "",
      "declare global {",
      "  // eslint-disable-next-line no-var",
      "  var __ARCENPAY_API_URL__: string | undefined;",
      "  // eslint-disable-next-line no-var",
      "  var __ARCENPAY_APP_URL__: string | undefined;",
      "}",
      "",
      "/**",
      " * Runtime override for the SDK's backend URL. The published bundle must not",
      " * read process.env, but a host app may still need to point the SDK at a",
      " * local/staging backend. Set the global before the first SDK call:",
      ' *   globalThis.__ARCENPAY_API_URL__ = "http://localhost:3300";',
      " */",
      'function readRuntimeOverride(key: "api" | "app"): string | undefined {',
      "  try {",
      "    const g = globalThis as unknown as Record<string, unknown>;",
      '    const value = key === "api" ? g.__ARCENPAY_API_URL__ : g.__ARCENPAY_APP_URL__;',
      '    if (typeof value === "string" && value.trim()) return value.trim();',
      "  } catch {",
      "    // ignore",
      "  }",
      "  return undefined;",
      "}",
      "",
      'export interface ResolveArcenPayBaseUrlOptions {',
      '  explicit?: string;',
      "}",
      "",
      'export interface ResolveArcenPayAppUrlOptions {',
      '  explicit?: string;',
      "}",
      "",
      "function trimTrailingSlash(value: string): string {",
      '  return value.replace(/\\/$/, "");',
      "}",
      "",
      "export function resolveArcenPayBaseUrl(",
      '  options: ResolveArcenPayBaseUrlOptions = {},',
      "): string {",
      "  if (options.explicit?.trim()) {",
      "    return trimTrailingSlash(options.explicit.trim());",
      "  }",
      '  const override = readRuntimeOverride("api");',
      "  if (override) return trimTrailingSlash(override);",
      "  return ARCENPAY_API_URL;",
      "}",
      "",
      "export function resolveArcenPayAppUrl(",
      '  options: ResolveArcenPayAppUrlOptions = {},',
      "): string {",
      "  if (options.explicit?.trim()) {",
      "    return trimTrailingSlash(options.explicit.trim());",
      "  }",
      '  const override = readRuntimeOverride("app");',
      "  if (override) return trimTrailingSlash(override);",
      "  return ARCENPAY_APP_URL;",
      "}",
      "",
    ].join("\n");
    await writeFile(appOriginTarget, hardcoded, "utf-8");
    console.log(`  Overrode app-origin.ts in ${target} with hardcoded production URLs`);
  });

  console.log(`Synced internal core -> packages/${target}/src/internal/core`);
}
