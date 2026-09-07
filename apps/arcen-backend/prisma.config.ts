import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const cwd = process.cwd();
const runningFromAppDir = cwd.endsWith(path.join("apps", "arcen-backend"));
const appDir = runningFromAppDir
  ? cwd
  : path.resolve(cwd, "apps/arcen-backend");
const workspaceRoot = runningFromAppDir
  ? path.resolve(cwd, "../..")
  : cwd;

for (const envPath of [
  path.resolve(workspaceRoot, ".env.local"),
  path.resolve(workspaceRoot, ".env"),
  path.resolve(appDir, ".env.local"),
  path.resolve(appDir, ".env"),
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/placeholder",
  },
});
