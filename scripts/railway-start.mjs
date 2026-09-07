#!/usr/bin/env node
// ==============================================================================
//  ArcenPay — Railway Production Startup Script
//
//  Modes:
//    1. "facilitator" : Runs ONLY the Facilitator node
//    2. "backend"     : Runs ONLY the Backend API server (with Prisma migrations)
//    3. "all" (default): Runs BOTH Backend and Facilitator in the same container!
//
//  Detection:
//    - Controlled by `SERVICE` env var (e.g. SERVICE=backend or SERVICE=facilitator)
//    - Or auto-detected from Railway's `RAILWAY_SERVICE_NAME`
//    - Defaults to running BOTH if you just deploy a single service on Railway!
// ==============================================================================

import { spawn } from "node:child_process";

const serviceEnv = (process.env.SERVICE || process.env.APP || "").toLowerCase();
const railwayServiceName = (process.env.RAILWAY_SERVICE_NAME || "").toLowerCase();

const isExplicitFacilitator =
  serviceEnv === "facilitator" ||
  (railwayServiceName && railwayServiceName.includes("facilitator"));

const isExplicitBackend =
  serviceEnv === "backend" ||
  (railwayServiceName && (railwayServiceName === "backend" || railwayServiceName === "arcen-backend"));

// If neither is explicitly requested, run BOTH in the same container!
const runMode = isExplicitFacilitator
  ? "facilitator"
  : isExplicitBackend
  ? "backend"
  : "all";

function spawnProcess(name, command, args, extraEnv = {}) {
  console.log(`[Railway: ${name}] Spawning: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  child.on("error", (err) => {
    console.error(`[Railway: ${name}] Failed to start:`, err);
  });

  child.on("exit", (code, signal) => {
    console.warn(`[Railway: ${name}] Process exited (code: ${code}, signal: ${signal})`);
  });

  return child;
}

function runCommandSync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });

    child.on("error", (err) => reject(err));
  });
}

async function runPrismaMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn("=================================================================");
    console.warn("  [WARNING] DATABASE_URL is not set in environment variables!    ");
    console.warn("  Skipping Prisma database migrations for this boot.             ");
    console.warn("  --> Set DATABASE_URL in Railway Dashboard -> Variables tab.    ");
    console.warn("=================================================================");
    return;
  }

  if (process.env.SKIP_MIGRATIONS === "true") {
    console.log("[Railway Backend] SKIP_MIGRATIONS=true -> Skipping migrations.");
    return;
  }

  console.log("[Railway Backend] Deploying Prisma database migrations...");
  try {
    await runCommandSync("npx", [
      "prisma",
      "migrate",
      "deploy",
      "--schema=apps/arcen-backend/prisma/schema.prisma",
    ]);
    console.log("[Railway Backend] Database migrations deployed successfully.");
  } catch (err) {
    console.error("[Railway Backend] Migration failed. Check DATABASE_URL:", err.message);
    // Continue running so the container does not get caught in an infinite restart loop
  }
}

async function main() {
  const port = process.env.PORT || "3300";

  console.log("=================================================");
  console.log(`  ArcenPay Railway Launcher (Mode: ${runMode.toUpperCase()})`);
  console.log(`  Public HTTP Port: ${port}                       `);
  console.log("=================================================");

  if (runMode === "facilitator") {
    // ── Mode: Facilitator Only ─────────────────────────────
    console.log("[Railway] Launching Facilitator node...");
    const facilitator = spawnProcess("Facilitator", "node", [
      "apps/facilitator/dist/server.js",
    ]);
    facilitator.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  if (runMode === "backend") {
    // ── Mode: Backend Only ─────────────────────────────────
    await runPrismaMigrations();
    console.log("[Railway] Launching Backend API server...");
    const backend = spawnProcess("Backend", "node", [
      "--import",
      "tsx",
      "apps/arcen-backend/dist/server.js",
    ]);
    backend.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  // ── Mode: ALL (Unified Backend + Facilitator in 1 Container) ───
  console.log("[Railway] Unified Deployment: Running BOTH Backend API and Facilitator Node!");

  // 1. Run migrations
  await runPrismaMigrations();

  // 2. Launch Backend on public $PORT
  console.log(`[Railway] Starting Backend API on port ${port}...`);
  const backend = spawnProcess("Backend", "node", [
    "--import",
    "tsx",
    "apps/arcen-backend/dist/server.js",
  ]);

  // 3. Launch Facilitator alongside Backend
  // Facilitator runs on internal port (default 3402) and points to local Backend
  const facilitatorPort = process.env.FACILITATOR_PORT || "3402";
  const localBackendUrl = `http://127.0.0.1:${port}`;
  console.log(`[Railway] Starting Facilitator on internal port ${facilitatorPort}...`);
  console.log(`[Railway] Facilitator will forward events to local Backend: ${localBackendUrl}`);

  const facilitator = spawnProcess(
    "Facilitator",
    "node",
    ["apps/facilitator/dist/server.js"],
    {
      PORT: facilitatorPort,
      BACKEND_URL: process.env.BACKEND_URL || localBackendUrl,
    }
  );

  // If Backend exits, exit container
  backend.on("exit", (code) => {
    console.error("[Railway] Backend process exited, terminating container...");
    facilitator.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error("[Railway Fatal Error]:", err);
  process.exit(1);
});
