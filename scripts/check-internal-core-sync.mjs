#!/usr/bin/env node
// ============================================================
//  Verify the vendored `internal/core` copies in the SDK packages
//  match the source of truth in `packages/internal-core/src`.
//
//  The SDK packages ship copies of internal-core (see
//  scripts/sync-internal-core.mjs) because they are published to npm.
//  Those copies MUST be regenerated whenever internal-core changes —
//  otherwise the SDKs validate/cache against a stale chain registry.
//
//  The only intentional divergence is `app-origin.ts`, which the sync
//  script rewrites with hardcoded production URLs.
//
//  Usage: node scripts/check-internal-core-sync.mjs
//  Exit code 0 = in sync, 1 = drift (run `npm run typecheck:sdk` or
//  `node scripts/sync-internal-core.mjs <pkg>` to fix).
// ============================================================

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "packages", "internal-core", "src");
const targets = ["sdk-node", "sdk-react"];
// Rewritten by the sync script with hardcoded URLs — not comparable.
const IGNORED = new Set(["app-origin.ts"]);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (IGNORED.has(entry.name)) continue;
    files.push(entry.name);
  }
  return files.sort();
}

const sourceFiles = await listFiles(sourceDir);
let drift = false;

for (const target of targets) {
  const targetDir = path.join(
    repoRoot,
    "packages",
    target,
    "src",
    "internal",
    "core",
  );
  const targetFiles = await listFiles(targetDir);

  if (sourceFiles.join(",") !== targetFiles.join(",")) {
    console.error(
      `✗ ${target}: file set differs from internal-core ` +
        `(source: ${sourceFiles.length}, vendored: ${targetFiles.length})`,
    );
    drift = true;
    continue;
  }

  for (const file of sourceFiles) {
    const [a, b] = await Promise.all([
      readFile(path.join(sourceDir, file), "utf-8"),
      readFile(path.join(targetDir, file), "utf-8"),
    ]);
    if (a !== b) {
      console.error(`✗ ${target}: ${file} is out of sync with internal-core`);
      drift = true;
    }
  }
}

if (drift) {
  console.error(
    "\ninternal-core drift detected. Run:\n" +
      "  node scripts/sync-internal-core.mjs sdk-node sdk-react\n",
  );
  process.exit(1);
}

console.log("✓ SDK internal/core copies are in sync with internal-core.");
