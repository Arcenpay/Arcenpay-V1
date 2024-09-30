import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

declare global {
  var __ARCENPAY_BACKEND_ENV_LOADED__: boolean | undefined;
}

function resolveEnvLocations() {
  const cwd = process.cwd();
  const runningFromAppDir = cwd.endsWith(path.join("apps", "arcen-backend"));
  const appDir = runningFromAppDir
    ? cwd
    : path.resolve(cwd, "apps/arcen-backend");
  const workspaceRoot = runningFromAppDir
    ? path.resolve(cwd, "../..")
    : cwd;

  return [
    path.resolve(workspaceRoot, ".env.local"),
    path.resolve(workspaceRoot, ".env"),
    path.resolve(appDir, ".env.local"),
    path.resolve(appDir, ".env"),
  ];
}

if (!globalThis.__ARCENPAY_BACKEND_ENV_LOADED__) {
  const envPaths = resolveEnvLocations();
  const appDir = process.cwd().endsWith(path.join("apps", "arcen-backend"))
    ? process.cwd()
    : path.resolve(process.cwd(), "apps/arcen-backend");
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      // Load shared workspace defaults first, then let app-local env supply defaults.
      // Hosting environment variables (such as Railway-injected PORT) are preserved.
      dotenv.config({ path: envPath, override: false });
    }
  }
  globalThis.__ARCENPAY_BACKEND_ENV_LOADED__ = true;
}
