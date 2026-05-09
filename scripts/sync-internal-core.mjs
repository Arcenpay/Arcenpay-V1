import { cp, mkdir, rm, stat } from "node:fs/promises";
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
  });

  console.log(`Synced internal core -> packages/${target}/src/internal/core`);
}
