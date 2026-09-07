#!/usr/bin/env node
// ==============================================================================
//  ArcenPay — Railway Unified Startup Script
//
//  Detects whether the current Railway service is 'facilitator' or 'backend'
//  via RAILWAY_SERVICE_NAME or SERVICE / APP environment variables.
//
//  - If facilitator: launches Express bridge node (apps/facilitator)
//  - If backend (default): runs Prisma migrations, then launches Hono API
// ==============================================================================

import { spawn } from "node:child_process";

const targetService = (
  process.argv[2] ||
  process.env.RAILWAY_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  process.env.SERVICE ||
  process.env.APP ||
  "backend"
).toLowerCase();

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`[Railway Start] Executing: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        error.code = code;
        reject(error);
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function start() {
  if (targetService.includes("facilitator")) {
    console.log("=================================================");
    console.log("  [Railway] Starting ArcenPay Facilitator Node   ");
    console.log(`  Port: ${process.env.PORT || 3402}              `);
    console.log("=================================================");
    await runCommand("node", ["apps/facilitator/dist/server.js"]);
  } else {
    console.log("=================================================");
    console.log("  [Railway] Starting ArcenPay Backend API        ");
    console.log(`  Port: ${process.env.PORT || 3300}              `);
    console.log("=================================================");

    // 1. Run pending Prisma database migrations
    if (process.env.SKIP_MIGRATIONS !== "true") {
      console.log("[Railway Backend] Deploying Prisma database migrations...");
      try {
        await runCommand("npx", [
          "prisma",
          "migrate",
          "deploy",
          "--schema=apps/arcen-backend/prisma/schema.prisma",
        ]);
        console.log("[Railway Backend] Database migrations deployed successfully.");
      } catch (err) {
        console.error("[Railway Backend] Migration failed. Check DATABASE_URL:", err);
        process.exit(1);
      }
    }

    // 2. Launch Hono REST API server
    console.log("[Railway Backend] Starting server process...");
    await runCommand("node", [
      "--import",
      "tsx",
      "apps/arcen-backend/dist/server.js",
    ]);
  }
}

start().catch((err) => {
  console.error("[Railway Fatal Error]:", err);
  process.exit(err.code || 1);
});
