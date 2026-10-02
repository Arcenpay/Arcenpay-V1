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

let shuttingDown = false;

// Railway's restart policy only covers the container's main process, so a
// facilitator that crashes at boot (bad config, RPC failure) would otherwise
// stay dead while the backend keeps serving. Supervise each facilitator with
// exponential backoff so the node self-heals instead of silently degrading.
function superviseProcess(name, command, args, extraEnv = {}, options = {}) {
  const maxRestarts = options.maxRestarts ?? 20;
  const baseDelayMs = options.baseDelayMs ?? 3000;
  let restarts = 0;

  const start = () => {
    const child = spawnProcess(name, command, args, extraEnv);

    child.on("exit", (code, signal) => {
      if (shuttingDown || signal === "SIGTERM" || signal === "SIGINT") return;

      restarts += 1;
      if (restarts > maxRestarts) {
        console.error(
          `[Railway: ${name}] Crashed ${restarts} times — giving up.`,
        );
        if (typeof options.onGiveUp === "function") options.onGiveUp();
        return;
      }

      const delay = Math.min(baseDelayMs * 2 ** (restarts - 1), 60000);
      console.warn(
        `[Railway: ${name}] Exited (code: ${code}) — restarting in ${delay}ms ` +
          `(attempt ${restarts}/${maxRestarts}).`,
      );
      setTimeout(start, delay);
    });

    return child;
  };

  return start();
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
      "--config=prisma.config.ts",
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

  // The facilitator resolves ONE chain from CHAIN_ID at boot, so a chain family
  // = a process. FACILITATOR_CHAINS lets a single container run several side by
  // side (e.g. "5042002,9100001"), each on its own internal port. Defaults to
  // the single CHAIN_ID, so existing deployments behave exactly as before.
  const facilitatorChains = (
    process.env.FACILITATOR_CHAINS ||
    process.env.CHAIN_ID ||
    "5042002"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const facilitatorBasePort = Number(process.env.FACILITATOR_PORT || 3402);

  const facilitatorEnvFor = (chainId, index, localBackendUrl) => ({
    PORT: String(facilitatorBasePort + index),
    CHAIN_ID: chainId,
    ...(localBackendUrl
      ? {
          INTERNAL_BACKEND_URL: localBackendUrl,
          INTERNAL_API_BASE_URL: localBackendUrl,
          BACKEND_URL: localBackendUrl,
        }
      : {}),
  });

  console.log("=================================================");
  console.log(`  ArcenPay Railway Launcher (Mode: ${runMode.toUpperCase()})`);
  console.log(`  Public HTTP Port: ${port}                       `);
  console.log(`  Facilitator chains: ${facilitatorChains.join(", ")}`);
  console.log("=================================================");

  if (runMode === "facilitator") {
    // ── Mode: Facilitator Only ─────────────────────────────
    console.log("[Railway] Launching Facilitator node(s)...");
    facilitatorChains.forEach((chainId, i) =>
      superviseProcess(
        `Facilitator[${chainId}]`,
        "node",
        ["apps/facilitator/dist/server.js"],
        facilitatorEnvFor(chainId, i),
        { onGiveUp: () => process.exit(1) },
      ),
    );
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

  // ── Mode: ALL (Unified Backend + Facilitators in 1 Container) ───
  console.log("[Railway] Unified Deployment: Backend API + Facilitator node(s)!");

  // 1. Run migrations
  await runPrismaMigrations();

  // 2. Launch Backend on public $PORT
  console.log(`[Railway] Starting Backend API on port ${port}...`);
  const backend = spawnProcess("Backend", "node", [
    "--import",
    "tsx",
    "apps/arcen-backend/dist/server.js",
  ]);

  // 3. Launch one Facilitator per configured chain, each on its own internal
  //    port, all pointing back at this container's backend (which they POST
  //    billing events to).
  const localBackendUrl = `http://127.0.0.1:${port}`;
  const facilitators = facilitatorChains.map((chainId, i) => {
    const envForChain = facilitatorEnvFor(chainId, i, localBackendUrl);
    console.log(
      `[Railway] Facilitator[${chainId}] on internal port ${envForChain.PORT} → ${localBackendUrl}`,
    );
    // Billing events flow facilitator → backend (POST /api/v1/billing/events),
    // so no per-chain FACILITATOR_BASE_URL_<id> is required for billing. The
    // backend's single FACILITATOR_URL only serves single-chain endpoints
    // (paymaster, ZK proofs, sessions, ops health).
    return superviseProcess(
      `Facilitator[${chainId}]`,
      "node",
      ["apps/facilitator/dist/server.js"],
      envForChain,
    );
  });

  // If Backend exits, exit container
  backend.on("exit", (code) => {
    console.error("[Railway] Backend process exited, terminating container...");
    shuttingDown = true;
    for (const f of facilitators) f.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error("[Railway Fatal Error]:", err);
  process.exit(1);
});
