import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const cwd = process.cwd();

for (const envPath of [
  path.resolve(cwd, ".env.local"),
  path.resolve(cwd, ".env.prod"),
  path.resolve(cwd, ".env"),
  path.resolve(cwd, "apps/arcen-backend/.env.local"),
  path.resolve(cwd, "apps/arcen-backend/.env"),
]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

export default defineConfig({
  schema: "apps/arcen-backend/prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/placeholder",
  },
});
