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
  for (const envPath of resolveEnvLocations()) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
  globalThis.__ARCENPAY_BACKEND_ENV_LOADED__ = true;
}
