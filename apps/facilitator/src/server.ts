// ============================================================
//  ArcenPay Facilitator Node — Entry Point
//  Validates x402 payments, watches on-chain events,
//  and delivers notifications to providers
// ============================================================

// ── Sentry must be initialized FIRST, before all other imports ──
import * as Sentry from "@sentry/node";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Multi-chain deployments run one facilitator PROCESS per chainId (see
// architecture note in @arcenpay/internal-core chains.ts). Set
// FACILITATOR_ENV_FILE to point a given process at a chain-specific env
// file (e.g. `.env.bot-testnet`) WITHOUT touching the default `.env` used
// by any other already-running facilitator instance for a different chain.
const explicitEnvFile = process.env.FACILITATOR_ENV_FILE;

const FACILITATOR_ENV_PATHS = [
  ...(explicitEnvFile
    ? [
        path.resolve(process.cwd(), explicitEnvFile),
        path.resolve(process.cwd(), "apps/facilitator", explicitEnvFile),
      ]
    : []),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/facilitator/.env.local"),
  path.resolve(process.cwd(), "apps/facilitator/.env"),
];

for (const envPath of FACILITATOR_ENV_PATHS) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

import express from "express";
import cors from "cors";
import arcjet, { shield, detectBot, fixedWindow } from "@arcjet/node";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import {
  x402Middleware,
  buildEventIdempotencyKey,
  createProtocolEvent,
  mapProtocolEventToBillingType,
  type ProtocolEventName,
} from "@arcenpay/node";
import {
  ERC7579AutopayModuleABI,
  PlanFactoryABI,
  SessionVaultABI,
  SubscriptionRegistryABI,
  getPrimaryRuntimeChainProfile,
  formatRuntimeChainMismatch,
  getContractAddresses,
  getChainEnvironment,
  getChainFamily,
  isValidAddressForChain,
  isValidTxHashForChain,
  normalizeWalletForChain,
  validateChainEnvironment,
  type PlanTier,
  type X402VerifiedPaymentContext,
} from "@arcenpay/internal-core";
import { createResilientFacilitatorClient } from "./rpc-client.js";
import {
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  http,
  parseAbiParameters,
  verifyMessage,
  type Hex,
} from "viem";
import { DurableJobQueue } from "./queue.js";
import { X402ReplayProtection } from "./replay-protection.js";
import {
  createOperatorAuthMiddleware,
  readBearerToken,
  secureCompare,
} from "./http-security.js";
import {
  createSubscriptionRouteStore,
  resolveRoutingTeamId as resolveSubscriptionRoutingTeamId,
} from "./subscription-routing.js";
import { microsToDecimalString } from "./renewal-amount.js";
import { BalanceMonitor } from "./balance-monitor.js";
import {
  handleTelegramWebhook,
  storePendingApproval,
  getPendingApproval,
} from "./telegram-webhook.js";
import { AggregatorService } from "./services/aggregator.js";
import { SettlementService } from "./services/settlement.js";
import { SettlementWriterService } from "./services/settlement-writer.js";
import { RedisUsageStore } from "./services/redis-usage.js";
import { EventListenerService } from "./services/events.js";
import {
  WebhookService,
  type WebhookDeliveryLog,
  type WebhookPayload,
} from "./services/webhooks.js";
import { EmailService } from "./services/email.js";
import { TablelandService } from "./services/tableland.js";
import { LitProtocolService } from "./services/lit.js";
import { ProofOrchestrator } from "./services/proof-orchestrator.js";
import { BillingKeeper } from "./services/keeper.js";
import { StellarRenewalDriver } from "./services/stellar-renewal-driver.js";
import { SolanaRenewalDriver } from "./services/solana-renewal-driver.js";
import { AxelarTransport } from "./services/transport-axelar.js";
import { CCIPTransport } from "./services/transport-ccip.js";
import {
  registerChainAdapter,
  type ChainAdapter,
} from "./services/chain-adapter.js";
import { EvmChainAdapter } from "./services/evm-adapter.js";
import { StellarChainAdapter } from "./services/stellar-adapter.js";
import { SolanaChainAdapter } from "./services/solana-adapter.js";

const app = express();

// Trust exactly one proxy hop by default (Railway's edge). Without this,
// Express uses the direct socket peer, so every IP-keyed control (Arcjet
// shield/bot, the x402 per-wallet fallback) keys on the proxy address instead
// of the real client — collapsing all callers into one bucket. Override with
// TRUSTED_PROXY_HOPS when the topology differs.
app.set(
  "trust proxy",
  (() => {
    const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
    if (raw === undefined || raw === "") return 1;
    if (raw === "false") return false;
    const hops = Number(raw);
    return Number.isFinite(hops) && hops >= 0 ? hops : 1;
  })(),
);

// Baseline response security headers. The facilitator serves JSON/ops traffic
// (no HTML), so lock it down hard: no framing, no sniffing, no referrer, HSTS.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains",
  );
  next();
});

const PORT = process.env.PORT || 3402;
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "84532", 10);
const CHAIN_ENV = getChainEnvironment(CHAIN_ID);
const RUNTIME_CHAIN_PROFILE = getPrimaryRuntimeChainProfile();
const RPC_URL =
  process.env.RPC_URL ||
  CHAIN_ENV.services.rpcUrl ||
  RUNTIME_CHAIN_PROFILE.rpcUrl ||
  "https://sepolia.base.org";
const CONTRACTS = CHAIN_ENV.contracts;
// viem chain client — EVM chains only. On Stellar there is no viem client
// (the StellarChainAdapter owns the Soroban RPC), so we install a stub that
// throws a descriptive error if any EVM-only code path touches it. Stellar
// code paths never call chainClient.
const chainClient: ReturnType<typeof createResilientFacilitatorClient> =
  getChainFamily(CHAIN_ID) === "evm"
    ? createResilientFacilitatorClient(RPC_URL, CHAIN_ID)
    : (new Proxy(
        {},
        {
          get(_target, prop) {
            throw new Error(
              `[Facilitator] chainClient.${String(prop)} is EVM-only but the runtime chain ${CHAIN_ID} is ` +
                `${getChainFamily(CHAIN_ID) ?? "unknown"}. ` +
                `Use the family ChainAdapter instead.`,
            );
          },
        },
      ) as ReturnType<typeof createResilientFacilitatorClient>);
const FACILITATOR_PROFILE = (
  process.env.FACILITATOR_PROFILE || "development"
).toLowerCase();
const QUEUE_REDIS_REQUIRED =
  FACILITATOR_PROFILE === "production" || process.env.REDIS_REQUIRED === "true";
const PROOF_MODE =
  (process.env.PROOF_MODE ||
    (FACILITATOR_PROFILE === "production" ? "strict" : "dev")) === "strict"
    ? "strict"
    : "dev";
const PROOF_BUILD_DIR =
  process.env.ARCENPAY_CIRCUIT_BUILD_DIR ||
  process.env.MEAP_CIRCUIT_BUILD_DIR ||
  path.resolve(process.cwd(), "circuits", "build");
const PROOF_WASM_PATH =
  process.env.ZK_CIRCUIT_WASM_PATH ||
  path.join(PROOF_BUILD_DIR, "UsageBilling_js", "UsageBilling.wasm");
const PROOF_ZKEY_PATH =
  process.env.ZK_CIRCUIT_ZKEY_PATH ||
  path.join(PROOF_BUILD_DIR, "circuit_final.zkey");
const PROOF_VKEY_PATH =
  process.env.ZK_CIRCUIT_VKEY_PATH ||
  path.join(PROOF_BUILD_DIR, "verification_key.json");
const PROOF_ARTIFACT_VERSION =
  process.env.ARCENPAY_PROOF_ARTIFACT_VERSION ||
  process.env.MEAP_PROOF_ARTIFACT_VERSION ||
  "";
const PROOF_ARTIFACT_MANIFEST_PATH =
  process.env.ARCENPAY_PROOF_ARTIFACT_MANIFEST_PATH ||
  process.env.MEAP_PROOF_ARTIFACT_MANIFEST_PATH ||
  path.resolve(process.cwd(), "circuits", "artifact-manifest.json");
const PROOF_SIGNER_PRIVATE_KEY =
  process.env.PROOF_SIGNER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const REDIS_PREFIX = process.env.REDIS_PREFIX || "arcenpay";
const FACILITATOR_SECRET = (process.env.FACILITATOR_SECRET || "").trim();
const rawBackendUrl = (
  process.env.INTERNAL_API_BASE_URL ||
  process.env.INTERNAL_BACKEND_URL ||
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://127.0.0.1:3300"
).trim().replace(/\/$/, "");
const BACKEND_URL = rawBackendUrl.endsWith("/api/v1")
  ? rawBackendUrl.slice(0, -"/api/v1".length).replace(/\/$/, "")
  : rawBackendUrl.endsWith("/api")
  ? rawBackendUrl.slice(0, -"/api".length).replace(/\/$/, "")
  : rawBackendUrl;
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "").trim().replace(/\/$/, "");
const INTERNAL_API_BASE_URL = BACKEND_URL;
const BACKEND_API_PREFIX = "/api/v1";
const DASHBOARD_PLAN_RESOLVER_PATH = `${BACKEND_API_PREFIX}/internal/catalog/resolve-plan`;
const LIT_ENABLED = process.env.ENABLE_LIT_PROTOCOL === "true";
const BILLING_MAINTENANCE_ENABLED =
  process.env.ENABLE_BILLING_MAINTENANCE_AUTOMATION === "true";
const BILLING_MAINTENANCE_EXECUTE_DUNNING =
  process.env.BILLING_MAINTENANCE_EXECUTE_DUNNING === "true";
const BILLING_MAINTENANCE_INTERVAL_MS = Number(
  process.env.BILLING_MAINTENANCE_INTERVAL_MS || 15 * 60 * 1000,
);
const BILLING_MAINTENANCE_INITIAL_DELAY_MS = Number(
  process.env.BILLING_MAINTENANCE_INITIAL_DELAY_MS || 30 * 1000,
);
const BILLING_MAINTENANCE_TEAM_LIMIT = Number(
  process.env.BILLING_MAINTENANCE_TEAM_LIMIT || 200,
);
const BILLING_MAINTENANCE_LIMIT_PER_TEAM = Number(
  process.env.BILLING_MAINTENANCE_LIMIT_PER_TEAM || 100,
);
const DEFAULT_ERC4337_ENTRYPOINT_V07 =
  "0x0000000071727de22e5e9d8baf0edac6f37da032";
const PIMLICO_API_KEY = (
  process.env.PIMLICO_API_KEY ||
  process.env.NEXT_PUBLIC_PIMLICO_API_KEY ||
  ""
).trim();
const PIMLICO_RPC_URL = (
  process.env.PIMLICO_RPC ||
  process.env.NEXT_PUBLIC_PIMLICO_RPC ||
  ""
).trim();
const PAYMASTER_RPC_URL = (
  process.env.PAYMASTER_RPC_URL ||
  process.env.PIMLICO_RPC ||
  ""
).trim();
const PAYMASTER_RPC_METHOD = (
  process.env.PAYMASTER_RPC_METHOD || "pm_sponsorUserOperation"
).trim();
const PAYMASTER_RPC_AUTH_TOKEN = (
  process.env.PAYMASTER_RPC_AUTH_TOKEN || ""
).trim();
const PAYMASTER_CHAIN_IDS = parseChainIdSet(
  process.env.PAYMASTER_CHAIN_IDS ||
    (FACILITATOR_PROFILE === "production" ? "" : "84532"),
);
const PAYMASTER_DEFAULT_ENTRYPOINT = (
  process.env.PAYMASTER_ENTRYPOINT || DEFAULT_ERC4337_ENTRYPOINT_V07
).trim();
const PAYMASTER_RECORD_ESTIMATED_SPEND =
  process.env.PAYMASTER_RECORD_ESTIMATED_SPEND !== "false";
const PAYMASTER_ESTIMATED_GAS_USED = Math.max(
  1,
  Number.parseInt(process.env.PAYMASTER_ESTIMATED_GAS_USED || "120000", 10) ||
    120000,
);
const PAYMASTER_ESTIMATED_GAS_COST_USD = Math.max(
  0,
  Number.parseFloat(process.env.PAYMASTER_ESTIMATED_GAS_COST_USD || "0.05") ||
    0.05,
);

function isHexAddress(value: string | undefined | null): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseChainIdSet(raw: string): Set<number> {
  const values = raw
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);
  return new Set(values);
}

function normalizeBackendApiPath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (
    normalized === BACKEND_API_PREFIX ||
    normalized.startsWith(`${BACKEND_API_PREFIX}/`)
  ) {
    return normalized;
  }

  if (normalized === "/api") {
    return BACKEND_API_PREFIX;
  }

  if (normalized.startsWith("/api/")) {
    return `${BACKEND_API_PREFIX}/${normalized.slice("/api/".length)}`;
  }

  return `${BACKEND_API_PREFIX}${normalized}`;
}

function buildInternalApiUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl}${normalizeBackendApiPath(pathname)}`;
}

function buildPimlicoPaymasterUrl(chainId: number): string {
  const specific = (
    process.env[`PIMLICO_RPC_${chainId}`] ||
    process.env[`NEXT_PUBLIC_PIMLICO_RPC_${chainId}`] ||
    ""
  ).trim();
  if (specific) return specific;

  if (PIMLICO_RPC_URL) return PIMLICO_RPC_URL;

  const specificApiKey = (
    process.env[`PIMLICO_API_KEY_${chainId}`] ||
    process.env[`NEXT_PUBLIC_PIMLICO_API_KEY_${chainId}`] ||
    ""
  ).trim();
  const apiKey = specificApiKey || PIMLICO_API_KEY;
  if (!apiKey) return "";

  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}

function getPaymasterRpcUrl(chainId: number): string {
  const specific = (
    process.env[`PAYMASTER_RPC_URL_${chainId}`] ||
    process.env[`PIMLICO_RPC_${chainId}`] ||
    ""
  ).trim();
  if (specific) return specific;

  const pimlico = buildPimlicoPaymasterUrl(chainId);
  if (pimlico) return pimlico;

  return PAYMASTER_RPC_URL;
}

function validateRuntimeConfig(): void {
  const errors: string[] = [];
  const verifierAddress = CONTRACTS.zkUsageVerifier;

  try {
    validateChainEnvironment(CHAIN_ID, {
      production: FACILITATOR_PROFILE === "production",
      requiredServices: ["rpcUrl"],
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // On EVM chains the verifier is a 0x hex address; on Stellar it is a C…
  // Soroban contract id. Validate with the family-aware helper so a Stellar
  // facilitator does not fail production boot on a non-hex contract id.
  const verifierFamily = getChainFamily(CHAIN_ID);
  const verifierInvalid =
    verifierFamily === null ||
    !isValidAddressForChain(verifierAddress, CHAIN_ID) ||
    (verifierFamily === "evm" &&
      verifierAddress === "0x0000000000000000000000000000000000000000");
  if (verifierInvalid && FACILITATOR_PROFILE === "production") {
    errors.push(
      `Invalid ZKUsageVerifier address for chain ${CHAIN_ID}: ${String(verifierAddress)}`,
    );
  } else if (verifierInvalid) {
    console.warn(
      `[Facilitator] Warning: ZKUsageVerifier address is not configured for chain ${CHAIN_ID}.`,
    );
  }

  if (FACILITATOR_PROFILE === "production") {
    if (!process.env.RPC_URL) {
      errors.push(
        "RPC_URL must be explicitly set in production. The public Sepolia fallback is rate-limited and unreliable.",
      );
    }

    if (!process.env.CHAIN_ID) {
      errors.push("CHAIN_ID must be explicitly set in production.");
    }

    if (!FACILITATOR_SECRET) {
      errors.push(
        "FACILITATOR_SECRET is required in production to authenticate dashboard → facilitator requests.",
      );
    }

    if (PROOF_MODE === "strict") {
      for (const artifactPath of [
        PROOF_WASM_PATH,
        PROOF_ZKEY_PATH,
        PROOF_VKEY_PATH,
      ]) {
        if (!fs.existsSync(artifactPath)) {
          errors.push(`Missing proof artifact in strict mode: ${artifactPath}`);
        }
      }
    } else {
      console.warn(
        `[Facilitator] Note: PROOF_MODE is '${PROOF_MODE}'. Using zero-proof dev envelope for settlements (circuit binary artifacts not required).`,
      );
    }

    if (
      PROOF_ARTIFACT_VERSION &&
      !fs.existsSync(PROOF_ARTIFACT_MANIFEST_PATH)
    ) {
      errors.push(
        `ARCENPAY_PROOF_ARTIFACT_VERSION is set but artifact manifest is missing: ${PROOF_ARTIFACT_MANIFEST_PATH}`,
      );
    }

    if (QUEUE_REDIS_REQUIRED && !process.env.REDIS_URL) {
      errors.push(
        "REDIS_URL is required in production (or when REDIS_REQUIRED=true).",
      );
    }
  }

  if (process.env.WEBHOOK_URL && !process.env.WEBHOOK_SIGNING_SECRET) {
    errors.push("WEBHOOK_SIGNING_SECRET is required when WEBHOOK_URL is set.");
  }

  if (process.env.TABLELAND_TABLE_NAME && !process.env.TABLELAND_PRIVATE_KEY) {
    errors.push(
      "TABLELAND_PRIVATE_KEY is required when TABLELAND_TABLE_NAME is configured.",
    );
  }

  if (!isHexAddress(PAYMASTER_DEFAULT_ENTRYPOINT)) {
    errors.push(
      `PAYMASTER_ENTRYPOINT must be a valid address. Received: ${PAYMASTER_DEFAULT_ENTRYPOINT}`,
    );
  }

  if (
    PAYMASTER_CHAIN_IDS.size > 0 &&
    [...PAYMASTER_CHAIN_IDS].some((chainId) => !getPaymasterRpcUrl(chainId))
  ) {
    console.warn(
      "[Facilitator] Some PAYMASTER_CHAIN_IDS do not have a configured paymaster RPC URL; sponsorship requests will be denied for those chains.",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `[Facilitator] Runtime configuration invalid:\n- ${errors.join("\n- ")}`,
    );
  }
}

validateRuntimeConfig();

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "facilitator_" });

const x402RequestsTotal = new Counter({
  name: "x402_requests_total",
  help: "Total x402-gated requests handled by facilitator",
  labelNames: ["endpoint", "method", "status"],
  registers: [metricsRegistry],
});

const x402ValidationErrorsTotal = new Counter({
  name: "x402_validation_errors_total",
  help: "Total x402 validation failures by rejection reason",
  labelNames: ["reason"],
  registers: [metricsRegistry],
});

const onChainSubmissionsLatencySeconds = new Histogram({
  name: "on_chain_submissions_latency_seconds",
  help: "Latency of on-chain settlement submissions (seconds)",
  labelNames: ["outcome"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

const aggregatorQueueDepth = new Gauge({
  name: "aggregator_queue_depth",
  help: "Number of sessions currently pending settlement threshold",
  registers: [metricsRegistry],
});

const proofGenerationDurationSeconds = new Histogram({
  name: "proof_generation_duration_seconds",
  help: "Duration of proof input generation pipeline (seconds)",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
});

const durableQueuePendingDepth = new Gauge({
  name: "durable_queue_pending_depth",
  help: "Number of pending jobs in durable queue by queue name",
  labelNames: ["queue"],
  registers: [metricsRegistry],
});

const durableQueueDeadLetterDepth = new Gauge({
  name: "durable_queue_dead_letter_depth",
  help: "Number of dead-lettered jobs by queue name",
  labelNames: ["queue"],
  registers: [metricsRegistry],
});

const x402ReplayRejections = new Counter({
  name: "x402_replay_rejections_total",
  help: "Total x402 requests rejected as replays",
  registers: [metricsRegistry],
});

// ============================================================
//  X402 Wallet Rate Limiting (per-wallet payment frequency)
// ============================================================

function extractWalletFromXPaymentHeader(
  headerValue: string | string[] | undefined,
): string | null {
  if (!headerValue || Array.isArray(headerValue)) return null;

  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as { payload?: unknown };
    const payload =
      typeof parsed.payload === "string"
        ? JSON.parse(parsed.payload)
        : parsed.payload;
    const from = (payload as { from?: unknown })?.from;
    if (typeof from !== "string") return null;
    // EVM addresses are lowercased for the rate-limit key; Solana base58 is
    // case-sensitive and must be used verbatim, or per-wallet limiting silently
    // falls back to the IP.
    const normalized = normalizeWalletForChain(from, CHAIN_ID);
    return normalized && isValidAddressForChain(normalized, CHAIN_ID)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

type WalletRateLimitOptions = {
  windowMs: number;
  max: number;
  message: Record<string, string>;
};

function walletRateLimit({ windowMs, max, message }: WalletRateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const now = Date.now();
    const wallet = extractWalletFromXPaymentHeader(req.headers["x-payment"]);
    const key = wallet || req.ip || req.socket.remoteAddress || "unknown";

    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json(message);
    }

    entry.count += 1;
    hits.set(key, entry);
    return next();
  };
}

const x402WalletLimiter = walletRateLimit({
  windowMs: 60 * 1000,
  max: (() => {
    const value = Number(process.env.X402_RATE_LIMIT_PER_WALLET || 300);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 300;
  })(),
  message: {
    error: "Too many x402 requests for this wallet. Try again shortly.",
  },
});

// ============================================================
//  Arcjet Security — shield, bot detection, rate limiting
// ============================================================

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"],
    }),
    fixedWindow({
      mode: "LIVE",
      characteristics: ["ip.src"],
      window: "60s",
      max: 200,
    }),
  ],
});

// ============================================================
//  Global Middleware
// ============================================================

const corsOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isTrustedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    const lower = hostname.toLowerCase();
    return (
      lower === "arcenpay.com" ||
      lower.endsWith(".arcenpay.com") ||
      // SECURITY: `*.vercel.app` / `*.railway.app` are SHARED PUBLIC SUFFIXES.
      // Anyone can deploy `evil.vercel.app`, so trusting the whole suffix while
      // `credentials: true` is set hands every attacker a first-party origin
      // that can read authenticated responses. Exact configured origins only.
      lower === "localhost" ||
      lower === "127.0.0.1" ||
      corsOrigins.includes(origin) ||
      // A wildcard is only honoured outside production; in production it would
      // mean "any site may send credentialed requests".
      (corsOrigins.includes("*") && process.env.NODE_ENV !== "production")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isTrustedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "50kb" })); // 50KB body limit (PRD §11.2)

// ── Operator authentication (single choke point for the whole API surface) ──
//
// SECURITY: previously each endpoint opted in individually, and the ones that
// forgot were fully anonymous — including `POST /api/webhooks/replay/:id`
// (forces outbound HTTP + a signed payload), `GET /api/webhooks/log`,
// `GET /api/usage/:sessionId/logs`, `POST /api/telegram/webhook` (approves
// fund releases) and `GET /api/agent/dispatch/:requestId`. Enforcing this at
// the root means a newly added route is protected by default instead of
// depending on the author remembering to add a guard.
app.use(
  createOperatorAuthMiddleware(() => FACILITATOR_SECRET, {
    allowMetricsPublic: () =>
      process.env.FACILITATOR_METRICS_PUBLIC === "true",
  }),
);

app.use(async (req, res, next) => {
  if (FACILITATOR_SECRET && secureCompare(readBearerToken(req), FACILITATOR_SECRET)) {
    return next();
  }

  // Skip Arcjet if ARCJET_KEY is missing or invalid in production to avoid blocking legitimate users
  if (
    !process.env.ARCJET_KEY ||
    process.env.ARCJET_KEY.includes("placeholder")
  ) {
    return next();
  }

  try {
    const decision = await aj.protect(req);
    if (decision.isDenied()) {
      if (decision.reason.isBot()) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(429).json({ error: "Too many requests" });
    }
  } catch (err) {
    console.warn("[Facilitator] Arcjet protect failed, allowing request:", err);
  }
  next();
});

// ============================================================
//  Initialize Services
// ============================================================

const aggregatorService = new AggregatorService({
  settlementThreshold: Number(process.env.SETTLEMENT_THRESHOLD || 100),
});

const proofOrchestrator = new ProofOrchestrator({
  autoSubmitThreshold: Number(process.env.SETTLEMENT_THRESHOLD || 100),
  windowDurationSeconds: Number(process.env.PROOF_WINDOW_SECONDS || 3600),
  maxRetries: Number(process.env.PROOF_MAX_RETRIES || 3),
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  signerPrivateKey: PROOF_SIGNER_PRIVATE_KEY,
  proofMode: PROOF_MODE,
  circuitWasmPath: PROOF_WASM_PATH,
  zkeyPath: PROOF_ZKEY_PATH,
  verificationKeyPath: PROOF_VKEY_PATH,
  artifactVersion: PROOF_ARTIFACT_VERSION,
  artifactManifestPath: PROOF_ARTIFACT_MANIFEST_PATH,
});
const usageService = proofOrchestrator.getUsageService();

// SettlementService (EVM SessionVault polling + proof submission watcher) —
// EVM-only. On Stellar, settlement runs through the SettlementWriterService
// (Soroban client) and the StellarChainAdapter; this viem-based watcher is
// not constructed.
const settlementService: SettlementService | null =
  getChainFamily(CHAIN_ID) === "evm"
    ? new SettlementService({
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
      })
    : null;

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error("PRIVATE_KEY must be a valid 32-byte hex string.");
  }
  return hex as `0x${string}`;
}

// On-chain settlement (EVM, Stellar and Solana). For Solana the writer needs
// the Anchor program id (ARCENPAY_CONTRACT_<chainId>_sessionVault); if it is
// not configured the writer constructor throws and settlement stays disabled.
// Settlement signer resolution. The key FORMAT is family-specific (EVM = 0x hex,
// Solana/Stellar = their own encodings), so a single shared variable cannot
// serve several chains from one container. Prefer a per-chain variable:
//   SETTLEMENT_PRIVATE_KEY_<chainId>  ->  SETTLEMENT_PRIVATE_KEY  ->  PRIVATE_KEY
const settlementKeyForChain = process.env[`SETTLEMENT_PRIVATE_KEY_${CHAIN_ID}`];

const enableOnchainSettlement =
  process.env.X402_ENABLE_SETTLEMENT === "true" ||
  Boolean(
    settlementKeyForChain ||
      process.env.SETTLEMENT_PRIVATE_KEY ||
      process.env.PRIVATE_KEY,
  );

let settlementWriter: SettlementWriterService | null = null;
if (enableOnchainSettlement) {
  const privateKeyRaw =
    settlementKeyForChain ||
    process.env.SETTLEMENT_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
  if (!privateKeyRaw) {
    console.warn(
      "[Facilitator] On-chain settlement requested but SETTLEMENT_PRIVATE_KEY is not set.",
    );
  } else {
    // For Stellar the key is an S… secret and for Solana a base58 keypair —
    // both handled by the SettlementWriterService family branch. For EVM
    // chains it must be a 32-byte hex private key.
    const settlementFamily = getChainFamily(CHAIN_ID);
    try {
      const isNonEvmKey =
        settlementFamily === "stellar" || settlementFamily === "solana";
      settlementWriter = new SettlementWriterService({
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
        privateKey: isNonEvmKey
          ? privateKeyRaw.trim()
          : normalizePrivateKey(privateKeyRaw),
        providerAddress: process.env.X402_PROVIDER_ADDRESS || undefined,
        sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS || undefined,
        waitForReceipt: process.env.X402_WAIT_FOR_RECEIPT !== "false",
      });
      console.log("[Facilitator] x402 on-chain settlement writer active");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (settlementFamily === "solana") {
        // Do not let an EVM-format key silently downgrade Solana settlement to
        // verify-only — say exactly what is wrong and how to fix it.
        console.error(
          "[Facilitator] Solana on-chain settlement DISABLED — SETTLEMENT_PRIVATE_KEY " +
            "is not a valid Solana keypair.\n" +
            "  ↳ A Solana signer must be a 64-byte keypair secret (base58 or a JSON " +
            "byte array from `solana-keygen new`), never a 0x-prefixed EVM key.\n" +
            `  ↳ ${message}`,
        );
      } else {
        console.error(
          "[Facilitator] Failed to initialize settlement writer:",
          err,
        );
      }
      settlementWriter = null;
    }
  }
}

const requireAuthorizedSettler =
  process.env.X402_REQUIRE_SETTLER_AUTH !== "false";

const settlementAuthorizationState: {
  signerAddress: string | null;
  sessionVaultAddress: string | null;
  authorized: boolean | null;
  lastCheckedAt: string | null;
  lastError: string | null;
} = {
  signerAddress: settlementWriter?.getSignerAddress() || null,
  sessionVaultAddress: settlementWriter?.getSessionVaultAddress() || null,
  authorized: null,
  lastCheckedAt: null,
  lastError: null,
};

async function refreshSettlementAuthorization(): Promise<boolean | null> {
  if (!settlementWriter) {
    settlementAuthorizationState.authorized = null;
    settlementAuthorizationState.lastCheckedAt = new Date().toISOString();
    settlementAuthorizationState.lastError = null;
    return null;
  }

  try {
    const authorized = await settlementWriter.isSignerAuthorized();
    settlementAuthorizationState.authorized = authorized;
    settlementAuthorizationState.lastCheckedAt = new Date().toISOString();
    settlementAuthorizationState.lastError = null;

    if (!authorized) {
      console.warn(
        `[Facilitator] Settlement signer ${settlementAuthorizationState.signerAddress} is not an authorized SessionVault settler.`,
      );
    }
    return authorized;
  } catch (err: any) {
    settlementAuthorizationState.authorized = null;
    settlementAuthorizationState.lastCheckedAt = new Date().toISOString();
    settlementAuthorizationState.lastError = err?.message || String(err);
    console.error(
      "[Facilitator] Failed to verify settlement signer authorization:",
      err,
    );
    return null;
  }
}

if (settlementWriter) {
  void refreshSettlementAuthorization();
  // Refresh every 5 minutes so revocation is detected without waiting for the
  // next settlement attempt.
  const SETTLEMENT_AUTH_POLL_MS = Number(
    process.env.SETTLEMENT_AUTH_POLL_MS || 5 * 60 * 1000,
  );
  setInterval(() => {
    void refreshSettlementAuthorization();
  }, SETTLEMENT_AUTH_POLL_MS);
}

let redisUsageStore: RedisUsageStore | null = null;
let redisReady: Promise<void> | null = null;
if (process.env.REDIS_URL) {
  redisUsageStore = new RedisUsageStore({
    url: process.env.REDIS_URL,
    keyPrefix: process.env.REDIS_PREFIX || "arcenpay",
    ttlSeconds: Number(process.env.REDIS_USAGE_TTL_SECONDS || 7 * 24 * 60 * 60),
  });
  redisReady = redisUsageStore
    .connect()
    .then(() => {
      console.log("[Facilitator] Redis usage store active");
    })
    .catch((err) => {
      console.error("[Facilitator] Redis init failed:", err);
      redisUsageStore = null;
    });
}

// ── Durable Job Queue ──────────────────────────────────────────────────────
// Provides Redis-backed billing event + webhook delivery queues with
// exponential backoff retry and dead-letter handling.
// NOTE: Redis persistence for the queue is activated when the optional
// `ioredis` package is installed and REDIS_URL is set. Until then the
// queue provides in-memory retry / dead-letter semantics.

const jobQueue = new DurableJobQueue({
  keyPrefix: `${REDIS_PREFIX}:queue`,
});

let queueRedisClient: QueueRedisClient | null = null;
const subscriptionRouteStore = createSubscriptionRouteStore({
  keyPrefix: REDIS_PREFIX,
  // Scope route state by chain: tokenId is per-chain, so EVM tokenId=1 and
  // Solana tokenId=1 are different subscriptions and must not share a key.
  chainId: CHAIN_ID,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  getStorage: () => queueRedisClient,
  onWarn: (message, error) => {
    console.warn(`[Facilitator] ${message}:`, error);
  },
});

const queueRedisReady = (async (): Promise<void> => {
  if (!process.env.REDIS_URL) {
    if (QUEUE_REDIS_REQUIRED) {
      throw new Error(
        "[Facilitator] Queue Redis is required but REDIS_URL is not set.",
      );
    }
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ioredis = require("ioredis") as {
      default?: new (
        url: string,
        opts?: object,
      ) => import("./queue.js").IRedisQueue & { connect(): Promise<void> };
      new (
        url: string,
        opts?: object,
      ): import("./queue.js").IRedisQueue & { connect(): Promise<void> };
    };
    const Ctor = ioredis.default ?? ioredis;
    const client = new Ctor(process.env.REDIS_URL, {
      enableReadyCheck: false,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    await client.connect();
    queueRedisClient = client as QueueRedisClient;
    jobQueue.setRedis(client);
    console.log(
      "[Facilitator] Queue Redis connected — enabling crash recovery",
    );
    await jobQueue.recoverFromRedis("billing");
    await jobQueue.recoverFromRedis("webhooks");
  } catch (err) {
    if (QUEUE_REDIS_REQUIRED) {
      throw new Error(
        `[Facilitator] Queue Redis initialization failed in required mode: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    console.warn(
      "[Facilitator] Queue Redis unavailable — using in-memory queue (no crash recovery)",
    );
  }
})();

async function buildBillingEventRequest(
  payload: BillingEventJobPayload,
): Promise<Record<string, unknown>> {
  const teamId = await resolveSubscriptionRoutingTeamId(
    {
      teamId: payload.teamId,
      onChainPlanId: payload.onChainPlanId,
      sourceTokenId: payload.sourceTokenId,
    },
    {
      readSubscriptionRouteState: (tokenId) =>
        subscriptionRouteStore.read(tokenId),
      resolvePlanScope: resolvePlanScopeFromDashboard,
    },
  );

  const resolvedTeamId =
    teamId || (process.env.FALLBACK_TEAM_ID || "").trim() || null;

  if (!resolvedTeamId) {
    throw new Error(
      `Unable to resolve teamId for billing event ${payload.eventType} (${payload.idempotencyKey}). ` +
        `onChainPlanId=${payload.onChainPlanId ?? "null"}, tokenId=${payload.sourceTokenId ?? "null"}. ` +
        `Set FALLBACK_TEAM_ID env var in the facilitator to route events when plan resolution fails.`,
    );
  }

  if (!teamId) {
    console.warn(
      `[Facilitator] Using FALLBACK_TEAM_ID for billing event ${payload.eventType} (${payload.idempotencyKey}) — plan scope could not be resolved from the dashboard. ` +
        `onChainPlanId=${payload.onChainPlanId ?? "null"}. Ensure the plan exists in the dashboard catalog with this onChainPlanId.`,
    );
  }

  return {
    teamId: resolvedTeamId,
    eventType: payload.eventType,
    eventName: payload.eventName,
    schemaVersion: payload.schemaVersion,
    occurredAt: payload.occurredAt,
    idempotencyKey: payload.idempotencyKey,
    payload: payload.payload,
    triggerInvoice: payload.triggerInvoice,
    source: payload.source,
    // Top-level chainId so the backend can derive `chainFamily` for any rows
    // it creates (SubscriptionState, etc.). The backend Zod accepts this
    // optionally; if absent, it falls back to reading from payload.chainId
    // (legacy path) or to its schema default (84532 = EVM).
    chainId: payload.chainId ?? CHAIN_ID,
  };
}

async function buildSubscriptionSyncRequest(
  payload: SubscriptionSyncJobPayload,
): Promise<Record<string, unknown>> {
  const teamId = await resolveSubscriptionRoutingTeamId(
    {
      teamId: payload.teamId,
      onChainPlanId: payload.onChainPlanId,
      sourceTokenId: payload.sourceTokenId,
    },
    {
      readSubscriptionRouteState: (tokenId) =>
        subscriptionRouteStore.read(tokenId),
      resolvePlanScope: resolvePlanScopeFromDashboard,
    },
  );

  if (!teamId) {
    throw new Error(
      `Unable to resolve teamId for subscription ${payload.event} (${payload.sourceTokenId ?? payload.wallet})`,
    );
  }

  const routeState = payload.sourceTokenId
    ? await subscriptionRouteStore.read(payload.sourceTokenId)
    : null;
  const resolvedWallet = routeState?.wallet ?? payload.wallet;
  if (!resolvedWallet) {
    throw new Error(
      `Unable to resolve subscriber wallet for subscription ${payload.event} (${payload.sourceTokenId ?? "unknown-token"})`,
    );
  }
  // EVM wallets are lowercased canonically; Stellar G… addresses are
  // case-sensitive base32 and MUST be preserved exactly.
  const resolvedChainId = payload.chainId ?? CHAIN_ID;
  const wallet =
    normalizeWalletForChain(resolvedWallet, resolvedChainId) ??
    resolvedWallet;

  return {
    teamId,
    wallet,
    onChainPlanId: payload.onChainPlanId,
    event: payload.event,
    occurredAt: payload.occurredAt,
    sourceTxHash: payload.sourceTxHash,
    sourceTokenId: payload.sourceTokenId,
    chainId: resolvedChainId,
  };
}

// Workers process enqueued jobs with exponential backoff.
// Subscription/billing jobs resolve team scope at execution time so unresolved
// events can retry and eventually dead-letter instead of being dropped.
jobQueue.startWorker<BillingEventJobPayload | SubscriptionSyncJobPayload>(
  "billing",
  async (job) => {
    if (!DASHBOARD_URL) {
      const msg =
        "[Facilitator] DASHBOARD_URL is not configured. Billing events cannot be routed to the dashboard backend. Set DASHBOARD_URL to your dashboard's origin (e.g. http://localhost:3300) so the facilitator can POST billing events to /api/v1/billing/events.";
      console.error(msg);
      throw new Error(msg);
    }
    if (!FACILITATOR_SECRET) {
      const msg =
        "[Facilitator] FACILITATOR_SECRET is not configured. Billing events cannot be authenticated against the dashboard backend. Set FACILITATOR_SECRET to match the backend's FACILITATOR_SECRET env var.";
      console.error(msg);
      throw new Error(msg);
    }
    if (job.type === "billing_event") {
      const payload = job.payload as BillingEventJobPayload;
      const teamId = (payload as Record<string, unknown>).teamId;
      console.log(
        `[Facilitator] Dispatching billing event ${payload.eventType} (${payload.idempotencyKey}) — teamId=${teamId ?? "null"}, onChainPlanId=${payload.onChainPlanId ?? "null"}`,
      );
      // Resolving the team happens BEFORE the HTTP call, so an unresolvable
      // plan never reaches postToDashboard()'s permanent/transient logic. The
      // on-chain plan simply is not in our catalog (e.g. an event replayed from
      // older devnet testing), so no amount of retrying will resolve a team.
      let requestPayload;
      try {
        requestPayload = await buildBillingEventRequest(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Unable to resolve teamId")) {
          console.error(
            `[Facilitator] Dropping unresolvable billing event ${payload.idempotencyKey} (onChainPlanId=${payload.onChainPlanId ?? "null"}): ${message}`,
          );
          return;
        }
        throw err;
      }
      const post = await postToDashboard(
        "/api/v1/billing/events",
        requestPayload,
      );
      if (!post.ok) {
        console.error(
          `[Facilitator] Billing event FAILED: ${payload.eventType} (${payload.idempotencyKey}) — teamId=${requestPayload.teamId} (HTTP ${post.status ?? "network"})`,
        );
        // A permanent 4xx will never succeed; re-queueing it 4x only floods the
        // logs and the database. Drop it (the backend already rejected it).
        if (post.permanent) return;
        throw new Error(
          `Dashboard POST /api/billing/events returned non-2xx for event ${payload.idempotencyKey}`,
        );
      }
      console.log(
        `[Facilitator] Billing event DELIVERED: ${payload.eventType} (${payload.idempotencyKey}) — teamId=${requestPayload.teamId}`,
      );
      return;
    }

    if (job.type === "subscription_sync") {
      let requestPayload;
      try {
        requestPayload = await buildSubscriptionSyncRequest(
          job.payload as SubscriptionSyncJobPayload,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Unable to resolve teamId")) {
          console.error(
            `[Facilitator] Dropping unresolvable subscription sync: ${message}`,
          );
          return;
        }
        throw err;
      }
      const post = await postToDashboard(
        "/api/v1/internal/companies/sync-subscription",
        requestPayload,
        { method: "PATCH" },
      );
      if (!post.ok) {
        console.error(
          `[Facilitator] Subscription sync FAILED: ${(job.payload as SubscriptionSyncJobPayload).event} (HTTP ${post.status ?? "network"})`,
        );
        // The backend rejected the payload itself (e.g. no CatalogPlan matches
        // this on-chain plan id any more). Retrying cannot fix that.
        if (post.permanent) return;
        throw new Error(
          "Dashboard POST /api/internal/companies/sync-subscription returned non-2xx",
        );
      }
      const syncPayload = job.payload as SubscriptionSyncJobPayload;
      if (syncPayload.sourceTokenId && syncPayload.event === "cancelled") {
        await subscriptionRouteStore.remove(syncPayload.sourceTokenId);
      }
      return;
    }

    throw new Error(`Unsupported billing job type: ${job.type}`);
  },
);

jobQueue.startWorker<{ pathname: string; payload: unknown }>(
  "webhooks",
  async (job) => {
    if (!DASHBOARD_URL) return;
    const { pathname, payload } = job.payload;
    const post = await postToDashboard(pathname, payload);
    if (!post.ok) {
      if (post.permanent) {
        console.error(
          `[Facilitator] Webhook delivery rejected permanently: ${pathname} (HTTP ${post.status})`,
        );
        return;
      }
      throw new Error(
        `Dashboard webhook delivery to ${pathname} returned non-2xx`,
      );
    }
  },
);

// ── x402 Replay Protection ─────────────────────────────────────────────────
const replayProtection = new X402ReplayProtection(
  Number(process.env.X402_REPLAY_WINDOW_MS || 10 * 60 * 1000),
);

// viem-based EVM event listener — only constructed for EVM chains. On Stellar
// the StellarChainAdapter polls Soroban events instead and this is never
// started (see startup IIFE).
const eventListener: EventListenerService | null =
  getChainFamily(CHAIN_ID) === "evm"
    ? new EventListenerService({
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
      })
    : null;

// ── Chain Adapter Registry ────────────────────────────────────────────────
//
// Every chain the facilitator watches is registered with a family-aware
// ChainAdapter. Today only the runtime CHAIN_ID is registered (via the EVM
// adapter for EVM ids, the Stellar adapter for Stellar synthetic ids). When
// the facilitator later supports multi-chain watchers, register an adapter
// per chain here.
//
// The EvmChainAdapter wraps the existing viem-based EventListenerService
// (above) so the existing event pipeline keeps working unchanged. The
// StellarChainAdapter polls Soroban getEvents and dispatches normalised
// events through the same ChainAdapter.on() seam. The startup IIFE below
// starts whichever adapter matches the runtime CHAIN_ID's family.
const chainFamily = getChainFamily(CHAIN_ID);
let primaryChainAdapter: ChainAdapter;
if (chainFamily === "evm") {
  primaryChainAdapter = new EvmChainAdapter({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
  });
  registerChainAdapter(primaryChainAdapter);
} else if (chainFamily === "stellar") {
  primaryChainAdapter = new StellarChainAdapter({
    chainId: CHAIN_ID,
    // The server-level RPC_URL is normally an EVM-style URL for the runtime
    // CHAIN_ID; for Stellar we DON'T pass it — let the adapter resolve the
    // Soroban RPC URL via getStellarSorobanRpcUrl() honoring env vars.
  });
  registerChainAdapter(primaryChainAdapter);
} else if (chainFamily === "solana") {
  primaryChainAdapter = new SolanaChainAdapter({
    chainId: CHAIN_ID,
    // Likewise: the adapter resolves the Solana JSON-RPC URL via
    // getSolanaRpcUrl() honouring ARCENPAY_SOLANA_RPC_URL_<id> / SOLANA_RPC_URL_<id>.
  });
  registerChainAdapter(primaryChainAdapter);
} else {
  // Unknown family — cannot arm any listener. Fatal: the facilitator has no
  // meaningful chain work to do and silently running would mask the misconfig.
  throw new Error(
    `[Facilitator] No ChainAdapter available for chainId ${CHAIN_ID} ` +
      `(family ${chainFamily ?? "unknown"}). Supported families: evm, stellar, solana.`,
  );
}

// Optional: Webhook service (if webhook URL is configured)
// Accepts WEBHOOK_SIGNING_SECRET or SVIX_SIGNING_SECRET (alias)
let webhookService: WebhookService | null = null;
const webhookSecret =
  process.env.WEBHOOK_SIGNING_SECRET || process.env.SVIX_SIGNING_SECRET;
if (process.env.WEBHOOK_URL && webhookSecret) {
  webhookService = new WebhookService({
    url: process.env.WEBHOOK_URL,
    secret: webhookSecret,
    onDelivery: persistWebhookDelivery,
  });
}

// Optional: Email service (if Resend API key is configured)
let emailService: EmailService | null = null;
if (process.env.RESEND_API_KEY) {
  emailService = new EmailService({
    apiKey: process.env.RESEND_API_KEY,
    fromAddress: process.env.EMAIL_FROM || "noreply@arcenpay.io",
    brandName: process.env.BRAND_NAME || "ArcenPay",
  });
}

// Optional: Tableland service (if table name configured)
let tablelandService: TablelandService | null = null;
let tablelandReady: Promise<void> | null = null;
if (process.env.TABLELAND_TABLE_NAME) {
  tablelandService = new TablelandService({
    tableName: process.env.TABLELAND_TABLE_NAME,
    privateKey: process.env.TABLELAND_PRIVATE_KEY,
    chainId: CHAIN_ID,
    rpcUrl:
      process.env.TABLELAND_RPC_URL ||
      process.env.BASE_SEPOLIA_RPC_URL ||
      process.env.SEPOLIA_RPC_URL ||
      RPC_URL,
    gatewayUrl: process.env.TABLELAND_GATEWAY_URL,
  });

  tablelandReady = tablelandService
    .initialize()
    .then(() => {
      console.log("[Facilitator] Tableland service active");
    })
    .catch((err) => {
      console.error("[Facilitator] Tableland init failed:", err);
      tablelandService = null;
    });
}

// ── In-memory flag store (fallback when Tableland is not configured) ──────────
// Persists only for the lifetime of the server process. Development use only.
type FlagMatrix = Record<
  ProviderTier,
  Record<string, boolean | string | number>
>;
const inMemoryFlags = new Map<string, FlagMatrix>();
function getInMemoryMatrix(provider: string): FlagMatrix {
  if (!inMemoryFlags.has(provider)) {
    inMemoryFlags.set(provider, { starter: {}, pro: {}, enterprise: {} });
  }
  return inMemoryFlags.get(provider)!;
}

// ── Flag metadata store (label, description, type per provider per flag key) ──
type FlagMeta = { label: string; description: string; type: string };
const flagMetadataStore = new Map<string, Map<string, FlagMeta>>();
function setFlagMeta(
  provider: string,
  flagKey: string,
  meta: Partial<FlagMeta>,
): void {
  if (!flagMetadataStore.has(provider))
    flagMetadataStore.set(provider, new Map());
  const existing = flagMetadataStore.get(provider)!.get(flagKey) ?? {
    label: "",
    description: "",
    type: "boolean",
  };
  flagMetadataStore.get(provider)!.set(flagKey, { ...existing, ...meta });
}

// Optional: Axelar GMP transport (cross-chain subscription mirroring) — EVM-only.
let axelarTransport: AxelarTransport | null = null;
if (
  getChainFamily(CHAIN_ID) === "evm" &&
  process.env.AXELAR_GATEWAY_ADDRESS &&
  process.env.AXELAR_GAS_SERVICE_ADDRESS &&
  PROOF_SIGNER_PRIVATE_KEY
) {
  axelarTransport = new AxelarTransport({
    gatewayAddress: process.env.AXELAR_GATEWAY_ADDRESS as `0x${string}`,
    gasServiceAddress: process.env.AXELAR_GAS_SERVICE_ADDRESS as `0x${string}`,
    rpcUrl: RPC_URL,
    privateKey: normalizePrivateKey(PROOF_SIGNER_PRIVATE_KEY),
    chainId: CHAIN_ID,
    mirrorRegistryAddress: CONTRACTS.mirrorRegistry as `0x${string}`,
  });
  console.log("[Facilitator] Axelar GMP transport initialized");
}

// Optional: CCIP transport fallback (cross-chain subscription mirroring) — EVM-only.
let ccipTransport: CCIPTransport | null = null;
if (
  getChainFamily(CHAIN_ID) === "evm" &&
  process.env.CCIP_ROUTER_ADDRESS &&
  PROOF_SIGNER_PRIVATE_KEY
) {
  ccipTransport = new CCIPTransport({
    routerAddress: process.env.CCIP_ROUTER_ADDRESS as `0x${string}`,
    rpcUrl: RPC_URL,
    privateKey: normalizePrivateKey(PROOF_SIGNER_PRIVATE_KEY),
    chainId: CHAIN_ID,
    mirrorRegistryAddress: CONTRACTS.mirrorRegistry as `0x${string}`,
    ...(process.env.CCIP_LINK_TOKEN_ADDRESS && {
      linkTokenAddress: process.env.CCIP_LINK_TOKEN_ADDRESS as `0x${string}`,
    }),
  });
  console.log("[Facilitator] CCIP GMP transport initialized");
}

const subscriberEmailsByWallet = new Map<
  string,
  { email: string; planId?: string; updatedAt: number }
>();

type QueueRedisClient = import("./queue.js").IRedisQueue & {
  connect(): Promise<void>;
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string): Promise<unknown>;
};

type BillingEventJobPayload = {
  teamId?: string | null;
  eventType: string;
  eventName?: string;
  schemaVersion?: string;
  occurredAt: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  triggerInvoice: boolean;
  source: string;
  onChainPlanId?: string | null;
  sourceTokenId?: string;
  wallet?: string | null;
  // ChainId is threaded through the durable queue so the backend can derive
  // `chainFamily` for any rows it creates from this event (SubscriptionState,
  // Payment, etc.). Defaults to the facilitator's runtime CHAIN_ID; for
  // Stellar synthetic ids (9_000_000+) the backend resolves "STELLAR".
  chainId?: number;
};

type SubscriptionSyncJobPayload = {
  teamId?: string | null;
  wallet: string | null;
  onChainPlanId: string | null;
  event: "minted" | "renewed" | "plan_changed" | "cancelled";
  occurredAt?: string;
  sourceTxHash?: string;
  sourceTokenId?: string;
  // Threaded so the backend derives chainFamily/chainId for ledger rows.
  // Defaults to the facilitator's runtime CHAIN_ID when omitted.
  chainId?: number;
};

const billingBridgeStats: {
  sent: number;
  failed: number;
  lastSentAt: string | null;
  lastError: string | null;
} = {
  sent: 0,
  failed: 0,
  lastSentAt: null,
  lastError: null,
};

interface DashboardPostResult {
  ok: boolean;
  status: number | null;
  /**
   * True when the request can never succeed (a 4xx). The backend is telling us
   * the payload itself is wrong — e.g. an event whose plan no longer exists —
   * so retrying with backoff only floods the logs and the queue.
   * 408/429 are excluded: those are transient by definition.
   */
  permanent: boolean;
}

function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function postToDashboard(
  pathname: string,
  payload: unknown,
  options?: { method?: "POST" | "PATCH" },
): Promise<DashboardPostResult> {
  // Post to the BACKEND directly, not the public dashboard origin.
  //
  // DASHBOARD_URL is a public origin, so routing every billing event, sync and
  // webhook through it takes a needless internet round trip and subjects the
  // facilitator to the edge rate limiter — which is what produced the 429
  // retry storm. In the all-in-one container the launcher points
  // INTERNAL_API_BASE_URL at the co-located backend; in a split deployment
  // BACKEND_URL is the backend's own origin. DASHBOARD_URL stays as the
  // fallback for dashboard-only setups, matching how plan resolution,
  // maintenance and the sync routes already resolve this base.
  const baseUrl = INTERNAL_API_BASE_URL || DASHBOARD_URL;
  if (!baseUrl) {
    console.warn(
      `[Facilitator] Cannot post ${pathname} — neither INTERNAL_API_BASE_URL nor DASHBOARD_URL is configured.`,
    );
    // Misconfiguration: retrying will not fix it.
    return { ok: false, status: null, permanent: true };
  }
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (FACILITATOR_SECRET) {
      headers.Authorization = `Bearer ${FACILITATOR_SECRET}`;
    }
    const response = await fetch(buildInternalApiUrl(baseUrl, pathname), {
      method: options?.method ?? "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      billingBridgeStats.failed += 1;
      billingBridgeStats.lastError = `HTTP ${response.status}`;
      return {
        ok: false,
        status: response.status,
        permanent: isPermanentFailure(response.status),
      };
    }
    billingBridgeStats.sent += 1;
    billingBridgeStats.lastSentAt = new Date().toISOString();
    billingBridgeStats.lastError = null;
    return { ok: true, status: response.status, permanent: false };
  } catch (err) {
    billingBridgeStats.failed += 1;
    billingBridgeStats.lastError =
      err instanceof Error ? err.message : String(err);
    console.error(
      `[Facilitator] Failed posting to dashboard ${pathname}:`,
      err,
    );
    // Network/transport error — transient, worth retrying.
    return { ok: false, status: null, permanent: false };
  }
}

async function resolvePlanScopeFromDashboard(
  onChainPlanId: string,
): Promise<{
  teamId: string;
  planId: string | null;
  environmentId: string | null;
} | null> {
  const internalBaseUrl = INTERNAL_API_BASE_URL || DASHBOARD_URL;
  if (!internalBaseUrl) {
    console.warn(
      "[Facilitator] Neither INTERNAL_API_BASE_URL nor DASHBOARD_URL is configured — unable to resolve plan scope from dashboard. " +
        "Billing event routing will depend solely on the subscription route store. " +
        "Set DASHBOARD_URL so on-chain plan IDs can be matched to team/plan records.",
    );
    return null;
  }

  const url = new URL(
    buildInternalApiUrl(internalBaseUrl, DASHBOARD_PLAN_RESOLVER_PATH),
  );
  url.searchParams.set("onChainPlanId", onChainPlanId);

  const headers: Record<string, string> = {};
  if (FACILITATOR_SECRET) {
    headers.Authorization = `Bearer ${FACILITATOR_SECRET}`;
  }

  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Plan resolver returned HTTP ${response.status} for onChainPlanId=${onChainPlanId}`,
    );
  }

  const data = (await response.json()) as {
    teamId?: string;
    planId?: string | null;
    environmentId?: string | null;
  };

  if (!data.teamId) {
    throw new Error(
      `Plan resolver returned no teamId for onChainPlanId=${onChainPlanId}`,
    );
  }

  return {
    teamId: data.teamId,
    planId: data.planId ?? null,
    environmentId: data.environmentId ?? null,
  };
}

async function persistWebhookDelivery(
  entry: WebhookDeliveryLog,
  payload: WebhookPayload,
): Promise<void> {
  const payloadData =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  const teamId =
    typeof payloadData.teamId === "string" ? payloadData.teamId.trim() : "";

  if (!teamId) return;

  await jobQueue.enqueue(
    "webhooks",
    "webhook_delivery",
    {
      pathname: "/api/v1/webhooks/delivery",
      payload: {
        teamId,
        deliveryId: entry.id,
        event: entry.event,
        url: entry.url,
        statusCode: entry.statusCode,
        attemptNumber: entry.attemptNumber,
        deliveredAt: new Date(entry.deliveredAt).toISOString(),
        success: entry.success,
        error: entry.error,
        payload,
      },
    },
    { idempotencyKey: `webhook:${entry.id}` },
  );
}

async function persistBillingEvent(
  eventName: ProtocolEventName,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  triggerInvoice = false,
  occurredAt?: string | number | Date,
  routing?: {
    teamId?: string | null;
    onChainPlanId?: string | null;
    sourceTokenId?: string;
    wallet?: string | null;
  },
): Promise<void> {
  const eventEnvelope = createProtocolEvent(eventName, payload, {
    source: "facilitator",
    idempotencyKey,
    chainId: CHAIN_ID,
    occurredAt,
  });
  await jobQueue.enqueue(
    "billing",
    "billing_event",
    {
      teamId: routing?.teamId ?? null,
      eventType: mapProtocolEventToBillingType(eventName),
      eventName: eventEnvelope.name,
      schemaVersion: eventEnvelope.schemaVersion,
      occurredAt: eventEnvelope.occurredAt,
      idempotencyKey: eventEnvelope.idempotencyKey,
      payload: eventEnvelope.payload,
      triggerInvoice,
      source: eventEnvelope.source,
      onChainPlanId: routing?.onChainPlanId ?? null,
      sourceTokenId: routing?.sourceTokenId,
      wallet: routing?.wallet ?? null,
      chainId: CHAIN_ID,
    } satisfies BillingEventJobPayload,
    // Namespaced by chain: an idempotency key is unique per chain, not globally.
    { idempotencyKey: `billing:${CHAIN_ID}:${eventEnvelope.idempotencyKey}` },
  );
}

async function enqueueSubscriptionSync(input: {
  teamId?: string | null;
  wallet: string | null;
  onChainPlanId: string | null;
  event: "minted" | "renewed" | "plan_changed" | "cancelled";
  occurredAt?: string;
  sourceTxHash?: string;
  sourceTokenId?: string;
  chainId?: number;
}): Promise<void> {
  const dedupeParts = [
    // Namespaced by chain so the same wallet/tokenId/tx shape on two chains
    // cannot be deduped into a single sync job.
    input.chainId ?? CHAIN_ID,
    input.event,
    // Family-aware normalization: EVM lowercases, Stellar/Solana keep case.
    (input.wallet
      ? normalizeWalletForChain(input.wallet, input.chainId ?? CHAIN_ID)
      : null) ?? input.sourceTokenId ?? "unknown",
    input.sourceTxHash ??
      input.sourceTokenId ??
      input.occurredAt ??
      String(Date.now()),
  ];

  await jobQueue.enqueue(
    "billing",
    "subscription_sync",
    input satisfies SubscriptionSyncJobPayload,
    { idempotencyKey: `sync:${dedupeParts.join(":")}` },
  );
}

/**
 * Look up a subscriber's email address.
 *
 * Priority:
 *   1. In-memory cache (populated when subscriber registers via POST /api/subscriber/email)
 *   2. Platform API via GET /api/subscriber/lookup?wallet=… (if internal API base URL is set)
 *
 * Results from the remote lookup are cached in memory to avoid repeated API calls
 * within the same process lifetime.
 */
async function lookupSubscriberEmail(
  walletAddress: string,
): Promise<string | null> {
  // Family-aware key: EVM lowercases, Stellar/Solana keep their exact case.
  const key = normalizeWalletForChain(walletAddress, CHAIN_ID) ?? walletAddress;

  // 1 — check memory first
  const cached = subscriberEmailsByWallet.get(key);
  if (cached) return cached.email;

  // 2 — fall back to platform lookup
  if (!INTERNAL_API_BASE_URL) return null;
  try {
    const url = `${buildInternalApiUrl(
      INTERNAL_API_BASE_URL,
      "/api/v1/subscriber/lookup",
    )}?wallet=${encodeURIComponent(key)}`;
    const headers: Record<string, string> = {};
    if (FACILITATOR_SECRET)
      headers["Authorization"] = `Bearer ${FACILITATOR_SECRET}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      email?: string | null;
      planId?: string | null;
    };
    if (data.email) {
      // populate cache for subsequent calls
      subscriberEmailsByWallet.set(key, {
        email: data.email,
        planId: data.planId ?? undefined,
        updatedAt: Date.now(),
      });
      return data.email;
    }
  } catch {
    // network error — non-fatal
  }
  return null;
}

/**
 * Resolve the current owner (subscriber) of an NFT token ID via ownerOf().
 * Returns the checksummed address or null on failure.
 */
async function getTokenOwner(tokenId: bigint): Promise<string | null> {
  const ownerOfAbi = [
    {
      name: "ownerOf",
      type: "function",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
    },
  ] as const;
  try {
    const owner = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: ownerOfAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
    return owner;
  } catch {
    return null;
  }
}

let billingMaintenanceRunInFlight = false;
let billingMaintenanceLastRunAt: string | null = null;
let billingMaintenanceLastSuccessAt: string | null = null;
let billingMaintenanceLastError: string | null = null;

async function triggerDashboardBillingMaintenance(): Promise<void> {
  if (!INTERNAL_API_BASE_URL) {
    throw new Error(
      "BACKEND_URL or DASHBOARD_URL is required to trigger billing maintenance.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (FACILITATOR_SECRET) {
    headers.Authorization = `Bearer ${FACILITATOR_SECRET}`;
  }

  const response = await fetch(
    buildInternalApiUrl(
      INTERNAL_API_BASE_URL,
      "/api/v1/internal/billing/maintenance/all",
    ),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        executeDunning: BILLING_MAINTENANCE_EXECUTE_DUNNING,
        teamLimit: BILLING_MAINTENANCE_TEAM_LIMIT,
        limitPerTeam: BILLING_MAINTENANCE_LIMIT_PER_TEAM,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Dashboard billing maintenance failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
    );
  }
}

function startBillingMaintenanceScheduler() {
  if (!BILLING_MAINTENANCE_ENABLED) {
    return;
  }

  if (!INTERNAL_API_BASE_URL) {
    console.warn(
      "[Facilitator] Billing maintenance automation enabled, but INTERNAL_API_BASE_URL is not configured.",
    );
    return;
  }

  if (!FACILITATOR_SECRET) {
    console.warn(
      "[Facilitator] Billing maintenance automation enabled, but FACILITATOR_SECRET is not configured.",
    );
    return;
  }

  const run = async () => {
    if (billingMaintenanceRunInFlight) {
      console.warn(
        "[Facilitator] Skipping billing maintenance tick because a previous run is still in flight.",
      );
      return;
    }

    billingMaintenanceRunInFlight = true;
    billingMaintenanceLastRunAt = new Date().toISOString();
    try {
      await triggerDashboardBillingMaintenance();
      billingMaintenanceLastSuccessAt = new Date().toISOString();
      billingMaintenanceLastError = null;
      console.log(
        `[Facilitator] Billing maintenance completed (executeDunning=${BILLING_MAINTENANCE_EXECUTE_DUNNING})`,
      );
    } catch (err) {
      billingMaintenanceLastError =
        err instanceof Error ? err.message : "unknown error";
      console.error(
        "[Facilitator] Billing maintenance automation failed:",
        err,
      );
    } finally {
      billingMaintenanceRunInFlight = false;
    }
  };

  setTimeout(() => {
    void run();
    setInterval(() => {
      void run();
    }, BILLING_MAINTENANCE_INTERVAL_MS);
  }, BILLING_MAINTENANCE_INITIAL_DELAY_MS);

  console.log(
    `[Facilitator] Billing maintenance automation active — interval=${BILLING_MAINTENANCE_INTERVAL_MS}ms executeDunning=${BILLING_MAINTENANCE_EXECUTE_DUNNING}`,
  );
}

// Optional: Lit Protocol service
let litService: LitProtocolService | null = null;
let litReady: Promise<void> | null = null;
const litRuntimeState: {
  configured: boolean;
  network: string | null;
  ready: boolean;
  lastError: string | null;
} = {
  configured: false,
  network: null,
  ready: false,
  lastError: null,
};
if (LIT_ENABLED && process.env.LIT_NETWORK) {
  const litNetwork = (
    process.env.LIT_NETWORK === "habanero" ||
    process.env.LIT_NETWORK === "datil" ||
    process.env.LIT_NETWORK === "datil-test" ||
    process.env.LIT_NETWORK === "datil-dev"
      ? process.env.LIT_NETWORK
      : "manzano"
  ) as ConstructorParameters<typeof LitProtocolService>[0]["network"];
  litRuntimeState.configured = true;
  litRuntimeState.network = litNetwork;
  litService = new LitProtocolService({
    network: litNetwork,
    registryAddress: CONTRACTS.subscriptionRegistry,
    chain:
      CHAIN_ID === 8453
        ? "base"
        : CHAIN_ID === 84532
          ? "baseSepolia"
          : "sepolia",
  });
  litReady = litService
    .connect()
    .then(() => {
      litRuntimeState.ready = true;
      litRuntimeState.lastError = null;
      console.log("[Facilitator] Lit service active");
    })
    .catch((err) => {
      litRuntimeState.ready = false;
      litRuntimeState.lastError =
        err instanceof Error ? err.message : String(err);
      console.error("[Facilitator] Lit init failed:", err);
      litService = null;
    });
} else if (process.env.LIT_NETWORK && !LIT_ENABLED) {
  console.log(
    "[Facilitator] Lit configured but disabled. Set ENABLE_LIT_PROTOCOL=true to connect.",
  );
}

function getDefaultFlagsForTier(planTier: PlanTier): Record<string, boolean> {
  if (planTier === "enterprise") {
    return {
      webhook_integration: true,
      analytics_dashboard: true,
      api_access: true,
      multi_user: true,
      custom_branding: true,
      priority_support: true,
    };
  }
  if (planTier === "pro") {
    return {
      webhook_integration: true,
      analytics_dashboard: true,
      api_access: true,
      multi_user: true,
      custom_branding: false,
      priority_support: false,
    };
  }
  return {
    webhook_integration: true,
    analytics_dashboard: false,
    api_access: false,
    multi_user: false,
    custom_branding: false,
    priority_support: false,
  };
}

function toSafeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`[Facilitator] ${field} exceeds JS safe integer range.`);
  }
  return Number(value);
}

async function getSubscriptionSnapshot(tokenId: bigint): Promise<{
  planId: bigint;
  planTier: PlanTier;
  expiresAt: bigint;
  billingInterval: number;
}> {
  const planFeatures = (await chainClient.readContract({
    address: CONTRACTS.subscriptionRegistry as `0x${string}`,
    abi: SubscriptionRegistryABI,
    functionName: "getPlanFeatures",
    args: [tokenId],
  })) as [bigint, string];

  const expiresAt = (await chainClient.readContract({
    address: CONTRACTS.subscriptionRegistry as `0x${string}`,
    abi: SubscriptionRegistryABI,
    functionName: "expiresAt",
    args: [tokenId],
  })) as bigint;

  const plan = (await chainClient.readContract({
    address: CONTRACTS.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getPlan",
    args: [planFeatures[0]],
  })) as { billingInterval: number | bigint };

  return {
    planId: planFeatures[0],
    planTier: planFeatures[1],
    expiresAt,
    billingInterval: Number(plan.billingInterval),
  };
}

function isConfiguredAddress(
  value: string | undefined | null,
): value is `0x${string}` {
  const candidate = value ?? "";
  if (!isHexAddress(candidate)) {
    return false;
  }
  return (
    candidate.toLowerCase() !== "0x0000000000000000000000000000000000000000"
  );
}

function resolveDestinationMirrorRegistryAddress(
  destinationChainId: number,
): `0x${string}` | null {
  try {
    const addresses = getContractAddresses(destinationChainId);
    return isConfiguredAddress(addresses.mirrorRegistry)
      ? (addresses.mirrorRegistry as `0x${string}`)
      : null;
  } catch {
    return null;
  }
}

async function buildMirrorPayload(
  tokenId: bigint,
  sourceUpdatedAt: bigint,
): Promise<`0x${string}`> {
  const subscriber = await getTokenOwner(tokenId);
  if (!subscriber) {
    throw new Error(`Unable to resolve owner for token ${tokenId}`);
  }

  const snapshot = await getSubscriptionSnapshot(tokenId);
  return encodeAbiParameters(
    parseAbiParameters(
      "address subscriber,uint256 sourceTokenId,uint256 planId,string planTier,uint64 expiration,uint64 sourceUpdatedAt",
    ),
    [
      subscriber as `0x${string}`,
      tokenId,
      snapshot.planId,
      snapshot.planTier,
      BigInt(snapshot.expiresAt),
      sourceUpdatedAt,
    ],
  );
}

// Family-aware: this facilitator is single-chain, so on an EVM runtime these
// stay hex-only, while on Solana they accept base58 — the same behaviour EVM
// gets, applied to the running family.
function isValidAddress(value: string): boolean {
  return isValidAddressForChain(value, CHAIN_ID);
}

function isBytes32(value: string): boolean {
  return isValidTxHashForChain(value, CHAIN_ID);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireFacilitatorSecretIfConfigured(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // HARDEN: In production or when FACILITATOR_SECRET is configured, require it.
  // Never silently allow all traffic when the secret is missing.
  if (!FACILITATOR_SECRET) {
    return res.status(401).json({
      ok: false,
      error:
        "FACILITATOR_SECRET is not configured — access denied for security. " +
        "Set the FACILITATOR_SECRET environment variable to enable admin endpoints.",
    });
  }

  // SECURITY: constant-time comparison. `!==` on a shared secret is a timing
  // oracle that leaks the token byte by byte.
  if (!secureCompare(readBearerToken(req), FACILITATOR_SECRET)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  return next();
}

const PROVIDER_TIERS = ["starter", "pro", "enterprise"] as const;
type ProviderTier = (typeof PROVIDER_TIERS)[number];
type ProviderFlagType = "boolean" | "string" | "number";

function normalizeProviderTier(value: string): ProviderTier {
  const normalized = value.toLowerCase().trim();
  if (normalized === "enterprise") return "enterprise";
  if (normalized === "pro") return "pro";
  return "starter";
}

function inferFlagType(value: unknown): ProviderFlagType {
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "boolean";
}

function formatFlagLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildProviderFlagCatalog(
  matrix: Record<string, Record<string, boolean | string | number>>,
): Array<{
  key: string;
  label: string;
  type: ProviderFlagType;
  planTiers: string[];
  enabledCount: number;
  totalCount: number;
}> {
  const keys = new Set<string>();
  for (const tier of PROVIDER_TIERS) {
    const flags = matrix[tier] || {};
    for (const key of Object.keys(flags)) {
      keys.add(key);
    }
  }

  return Array.from(keys).map((key) => {
    const planTiers = PROVIDER_TIERS.filter((tier) => {
      const value = matrix[tier]?.[key];
      return value === true || value === 1 || value === "true";
    });
    const sample =
      matrix.enterprise?.[key] ??
      matrix.pro?.[key] ??
      matrix.starter?.[key] ??
      false;
    return {
      key,
      label: formatFlagLabel(key),
      type: inferFlagType(sample),
      planTiers,
      enabledCount: planTiers.length,
      totalCount: PROVIDER_TIERS.length,
    };
  });
}

function parseSessionTuple(raw: unknown): {
  agent: string;
  token: string;
  balance: bigint;
  totalFunded: bigint;
  totalSettled: bigint;
  active: boolean;
  createdAt: bigint;
} {
  const tuple = raw as
    | {
        agent?: string;
        token?: string;
        balance?: bigint;
        totalFunded?: bigint;
        totalSettled?: bigint;
        active?: boolean;
        createdAt?: bigint;
        [index: number]: unknown;
      }
    | undefined;

  return {
    agent: String(
      tuple?.agent ??
        tuple?.[0] ??
        "0x0000000000000000000000000000000000000000",
    ),
    token: String(
      tuple?.token ??
        tuple?.[1] ??
        "0x0000000000000000000000000000000000000000",
    ),
    balance: BigInt(
      (tuple?.balance ?? tuple?.[2] ?? 0n) as bigint | number | string,
    ),
    totalFunded: BigInt(
      (tuple?.totalFunded ?? tuple?.[3] ?? 0n) as bigint | number | string,
    ),
    totalSettled: BigInt(
      (tuple?.totalSettled ?? tuple?.[4] ?? 0n) as bigint | number | string,
    ),
    active: Boolean(tuple?.active ?? tuple?.[5] ?? false),
    createdAt: BigInt(
      (tuple?.createdAt ?? tuple?.[6] ?? 0n) as bigint | number | string,
    ),
  };
}

// ============================================================
//  Event Listeners — PRD §9.1
// ============================================================

// Watch all subscription events and forward to webhooks
eventListener?.on("*", async (event) => {
  console.log(`[Facilitator] Event: ${event.type} tokenId=${event.tokenId}`);

  // Forward to webhook if configured
  if (webhookService) {
    await webhookService.deliverEvent(event);
  }
});

// Specific handlers for each event type
eventListener?.on("minted", async (event) => {
  console.log(
    `[Facilitator] 🎉 New subscriber: ${event.subscriber} (Plan ${event.planId})`,
  );
  const tokenId = event.tokenId.toString();
  const onChainPlanId = event.planId?.toString() ?? null;
  const occurredAt = event.timestamp
    ? new Date(Number(event.timestamp) * 1000).toISOString()
    : undefined;
  const mintedPlanScope = onChainPlanId
    ? await resolvePlanScopeFromDashboard(onChainPlanId).catch((err) => {
        console.error(
          "[Facilitator] Failed to resolve team for minted subscription:",
          err,
        );
        return null;
      })
    : null;

  if (event.subscriber) {
    await subscriptionRouteStore.write(tokenId, {
      wallet: event.subscriber.toLowerCase(),
      teamId: mintedPlanScope?.teamId ?? null,
      onChainPlanId,
      updatedAt: occurredAt ?? new Date().toISOString(),
    });
  }
  // Sync subscription to dashboard DB so flag evaluation uses the correct plan
  if (event.subscriber) {
    enqueueSubscriptionSync({
      teamId: mintedPlanScope?.teamId ?? null,
      wallet: event.subscriber,
      onChainPlanId,
      event: "minted",
      occurredAt,
      sourceTxHash: event.transactionHash,
      sourceTokenId: tokenId,
    }).catch((err) =>
      console.error("[Facilitator] sync-subscription (minted) failed:", err),
    );
  }
  let snapshotForEmail: Awaited<
    ReturnType<typeof getSubscriptionSnapshot>
  > | null = null;
  if (tablelandService && event.subscriber) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        const snapshot = await getSubscriptionSnapshot(event.tokenId);
        snapshotForEmail = snapshot;
        const features = getDefaultFlagsForTier(snapshot.planTier);
        await tablelandService.syncSubscription({
          walletAddress: event.subscriber,
          tokenId: toSafeNumber(event.tokenId, "tokenId"),
          planTier: snapshot.planTier,
          expiresAt: toSafeNumber(snapshot.expiresAt, "expiresAt"),
          billingInterval: snapshot.billingInterval,
          features,
        });
      } catch (err) {
        console.error("[Facilitator] Tableland sync failed on minted:", err);
      }
    }
  }
  if (litService) {
    if (litReady) {
      await litReady;
    }
    if (litService && event.subscriber) {
      try {
        const acc = litService.buildSubscriptionACC(event.subscriber);
        console.log(
          `[Facilitator] Lit ACC prepared for ${event.subscriber}: ${acc.length} rules`,
        );
      } catch (err) {
        console.error("[Facilitator] Lit ACC generation failed:", err);
      }
    }
  }
  // Send welcome email if subscriber email is known and email service is configured
  if (emailService && event.subscriber) {
    const subscriberEmail = await lookupSubscriberEmail(event.subscriber);
    if (subscriberEmail) {
      try {
        await emailService.sendTemplate(
          "welcome" as any,
          { email: subscriberEmail, walletAddress: event.subscriber },
          {
            walletAddress: event.subscriber,
            planId: event.planId?.toString() || "",
            tokenId: event.tokenId?.toString() || "",
            planTier: snapshotForEmail?.planTier || "",
            expiresAt: snapshotForEmail?.expiresAt
              ? new Date(
                  Number(snapshotForEmail.expiresAt) * 1000,
                ).toISOString()
              : "",
          },
        );
      } catch (err) {
        console.error("[Facilitator] Welcome email failed:", err);
      }
    }
  }
});

eventListener?.on("renewed", async (event) => {
  console.log(
    `[Facilitator] 🔄 Renewed: tokenId=${event.tokenId} until ${event.expiration}`,
  );
  const tokenId = event.tokenId.toString();
  const existingRouteState = await subscriptionRouteStore.read(tokenId);
  const renewedSubscriberWallet =
    existingRouteState?.wallet || (await getTokenOwner(event.tokenId));
  // Resolve the on-chain planId for this token so sync-subscription can set activePlanId
  let renewedPlanId: bigint | null = null;
  try {
    const planFeatures = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "getPlanFeatures",
      args: [event.tokenId],
    })) as [bigint, string];
    renewedPlanId = planFeatures[0] ?? null;
  } catch (err) {
    console.error(
      "[Facilitator] Failed to resolve planId for renewed event:",
      err,
    );
  }
  const renewedOnChainPlanId =
    renewedPlanId?.toString() ?? existingRouteState?.onChainPlanId ?? null;
  const renewedPlanScope = renewedOnChainPlanId
    ? await resolvePlanScopeFromDashboard(renewedOnChainPlanId).catch((err) => {
        console.error(
          "[Facilitator] Failed to resolve team for renewed subscription:",
          err,
        );
        return null;
      })
    : null;
  const renewedTeamId =
    existingRouteState?.teamId || renewedPlanScope?.teamId || null;

  if (renewedSubscriberWallet) {
    await subscriptionRouteStore.write(tokenId, {
      wallet: renewedSubscriberWallet.toLowerCase(),
      teamId: renewedTeamId ?? null,
      onChainPlanId: renewedOnChainPlanId,
      updatedAt: event.timestamp
        ? new Date(Number(event.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });
  }

  // Sync subscription to dashboard DB so flag evaluation uses the correct plan
  enqueueSubscriptionSync({
    teamId: renewedTeamId ?? null,
    wallet: renewedSubscriberWallet,
    onChainPlanId: renewedOnChainPlanId,
    event: "renewed",
    occurredAt: event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined,
    sourceTxHash: event.transactionHash,
    sourceTokenId: tokenId,
  }).catch((err) =>
    console.error("[Facilitator] sync-subscription (renewed) failed:", err),
  );
  if (tablelandService) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        const snapshot = await getSubscriptionSnapshot(event.tokenId);
        await tablelandService.updateEntitlementByTokenId(
          toSafeNumber(event.tokenId, "tokenId"),
          {
            plan_tier: snapshot.planTier,
            feature_flags: getDefaultFlagsForTier(snapshot.planTier),
            expires_at: toSafeNumber(snapshot.expiresAt, "expiresAt"),
            last_renewed: Math.floor(Date.now() / 1000),
            billing_interval: snapshot.billingInterval,
          },
        );
      } catch (err) {
        console.error("[Facilitator] Tableland sync failed on renewed:", err);
      }
    }
  }
});

eventListener?.on("billing_executed", async (event) => {
  const tokenId = event.tokenId.toString();
  const billingReason = Number(event.billingReason ?? 0n);
  const onChainPlanId = event.planId?.toString() ?? null;
  const subscriberWallet =
    event.account ?? (await getTokenOwner(event.tokenId));
  const subscriberEmail = subscriberWallet
    ? await lookupSubscriberEmail(subscriberWallet)
    : null;
  const amountMicros = event.amountPaid ?? 0n;
  const amount = microsToDecimalString(amountMicros);
  const merchantAmount = microsToDecimalString(event.merchantAmount ?? 0n);
  const protocolFee = microsToDecimalString(event.protocolFee ?? 0n);
  const occurredAtMs = event.timestamp
    ? Number(event.timestamp) * 1000
    : undefined;
  const occurredAtIso =
    occurredAtMs !== undefined
      ? new Date(occurredAtMs).toISOString()
      : undefined;
  const planScope = onChainPlanId
    ? await resolvePlanScopeFromDashboard(onChainPlanId).catch((err) => {
        console.error(
          "[Facilitator] Failed to resolve team for billing execution:",
          err,
        );
        return null;
      })
    : null;
  const existingRouteState = await subscriptionRouteStore.read(tokenId);
  const teamId = existingRouteState?.teamId || planScope?.teamId || null;
  const catalogPlanId = planScope?.planId ?? null;
  const environmentId = planScope?.environmentId ?? null;

  if (subscriberWallet) {
    await subscriptionRouteStore.write(tokenId, {
      wallet: subscriberWallet.toLowerCase(),
      teamId,
      onChainPlanId,
      updatedAt: occurredAtIso ?? new Date().toISOString(),
    });
  }

  const billingEventName =
    billingReason === 0 ? "subscription.minted" : "subscription.renewed";

  let currentExpiration: string | undefined;
  try {
    const snapshot = await getSubscriptionSnapshot(event.tokenId);
    currentExpiration = snapshot.expiresAt.toString();
  } catch (err) {
    console.error(
      "[Facilitator] Failed to resolve current expiration for billing execution:",
      err,
    );
  }

  await persistBillingEvent(
    billingEventName,
    buildEventIdempotencyKey(billingEventName, [
      event.transactionHash || tokenId,
      tokenId,
    ]),
    {
      tokenId,
      planId: catalogPlanId ?? onChainPlanId,
      catalogPlanId,
      onChainPlanId,
      environmentId,
      subscriber: subscriberWallet,
      customerWallet: subscriberWallet,
      amount,
      grossAmount: amount,
      merchantAmount,
      protocolFee,
      txHash: event.transactionHash,
      timestamp: event.timestamp?.toString(),
      expiration: currentExpiration,
      billingReason,
      ...(subscriberEmail && { email: subscriberEmail }),
      description:
        billingReason === 0
          ? "Subscription activation"
          : "Subscription renewal",
    },
    true,
    occurredAtMs,
    {
      teamId,
      onChainPlanId,
      sourceTokenId: tokenId,
      wallet: subscriberWallet ?? null,
    },
  );

  enqueueSubscriptionSync({
    teamId,
    wallet: subscriberWallet,
    onChainPlanId,
    event: billingReason === 0 ? "minted" : "renewed",
    occurredAt: occurredAtIso,
    sourceTxHash: event.transactionHash,
    sourceTokenId: tokenId,
  }).catch((err) =>
    console.error(
      "[Facilitator] sync-subscription (billing_executed) failed:",
      err,
    ),
  );

  if (
    emailService &&
    billingReason === 1 &&
    subscriberWallet &&
    subscriberEmail
  ) {
    try {
      await emailService.sendTemplate(
        "renewal_receipt" as any,
        { email: subscriberEmail, walletAddress: subscriberWallet },
        {
          walletAddress: subscriberWallet,
          tokenId,
          expiresAt: currentExpiration
            ? new Date(Number(currentExpiration) * 1000).toISOString()
            : "",
          amount,
        },
      );
    } catch (err) {
      console.error("[Facilitator] Renewal receipt email failed:", err);
    }
  }
});

eventListener?.on("plan_changed", async (event) => {
  console.log(
    `[Facilitator] 🔀 Plan changed: tokenId=${event.tokenId} ${event.previousPlanId ?? "?"} -> ${event.planId ?? "?"}`,
  );

  const tokenId = event.tokenId.toString();
  const existingRouteState = await subscriptionRouteStore.read(tokenId);
  const subscriberWallet =
    existingRouteState?.wallet || (await getTokenOwner(event.tokenId));
  const onChainPlanId = event.planId?.toString() ?? null;
  const planScope = onChainPlanId
    ? await resolvePlanScopeFromDashboard(onChainPlanId).catch((err) => {
        console.error(
          "[Facilitator] Failed to resolve team for plan-changed subscription:",
          err,
        );
        return null;
      })
    : null;
  const teamId = existingRouteState?.teamId || planScope?.teamId || null;

  if (subscriberWallet) {
    await subscriptionRouteStore.write(tokenId, {
      wallet: subscriberWallet.toLowerCase(),
      teamId: teamId ?? null,
      onChainPlanId,
      updatedAt: event.timestamp
        ? new Date(Number(event.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });
  }

  enqueueSubscriptionSync({
    teamId: teamId ?? null,
    wallet: subscriberWallet,
    onChainPlanId,
    event: "plan_changed",
    occurredAt: event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined,
    sourceTxHash: event.transactionHash,
    sourceTokenId: tokenId,
  }).catch((err) =>
    console.error(
      "[Facilitator] sync-subscription (plan_changed) failed:",
      err,
    ),
  );
});

eventListener?.on("cancelled", async (event) => {
  console.log(`[Facilitator] ❌ Cancelled: tokenId=${event.tokenId}`);
  const tokenId = event.tokenId.toString();
  const existingRouteState = await subscriptionRouteStore.read(tokenId);
  const cancelledSubscriberWallet =
    existingRouteState?.wallet || (await getTokenOwner(event.tokenId));
  const cancelledTeamId = existingRouteState?.teamId ?? null;

  await persistBillingEvent(
    "subscription.cancelled",
    buildEventIdempotencyKey("subscription.cancelled", [
      event.transactionHash || tokenId,
    ]),
    {
      tokenId,
      txHash: event.transactionHash,
      timestamp: event.timestamp?.toString(),
    },
    false,
    event.timestamp ? Number(event.timestamp) * 1000 : undefined,
    {
      teamId: cancelledTeamId,
      onChainPlanId: existingRouteState?.onChainPlanId ?? null,
      sourceTokenId: tokenId,
      wallet: cancelledSubscriberWallet ?? null,
    },
  );

  if (tablelandService) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        await tablelandService.revokeEntitlementByTokenId(
          toSafeNumber(event.tokenId, "tokenId"),
        );
      } catch (err) {
        console.error(
          "[Facilitator] Tableland revoke failed on cancelled:",
          err,
        );
      }
    }
  }
  if (litService) {
    console.log(
      `[Facilitator] Lit access revocation queued for token ${event.tokenId}`,
    );
  }
  // Send access revoked email
  if (emailService && cancelledSubscriberWallet) {
    const subscriberEmail = await lookupSubscriberEmail(
      cancelledSubscriberWallet,
    );
    if (subscriberEmail) {
      try {
        await emailService.sendTemplate(
          "access_revoked" as any,
          { email: subscriberEmail, walletAddress: cancelledSubscriberWallet },
          {
            walletAddress: cancelledSubscriberWallet,
            tokenId: event.tokenId?.toString() || "",
          },
        );
      } catch (err) {
        console.error("[Facilitator] Access revoked email failed:", err);
      }
    }
  }
  // Sync subscription to dashboard DB so flag evaluation uses the correct plan
  enqueueSubscriptionSync({
    teamId: cancelledTeamId,
    wallet: cancelledSubscriberWallet,
    onChainPlanId: null,
    event: "cancelled",
    occurredAt: event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined,
    sourceTxHash: event.transactionHash,
    sourceTokenId: tokenId,
  }).catch((err) =>
    console.error("[Facilitator] sync-subscription (cancelled) failed:", err),
  );
});

// ── Non-EVM (Stellar / Solana) event handlers ──────────────────────────────
// When the runtime chain is Stellar or Solana, register the billing pipeline on
// the family ChainAdapter instead of the viem eventListener. Both adapters emit
// NormalisedSubscriptionEvent (already stringified, wallet case preserved), so
// these handlers drive the same route-store + dashboard-sync + billing seams the
// EVM handlers use, without viem chain re-reads.
const isNonEvmAdapterChain =
  chainFamily === "stellar" || chainFamily === "solana";
if (isNonEvmAdapterChain) {
  const routeStoreWallet = (
    wallet: string | null | undefined,
  ): string | null => {
    // Stellar (base32) and Solana (base58) addresses are case-sensitive —
    // never lowercase them.
    return wallet && wallet.length > 0 ? wallet : null;
  };

  const resolveStellarPlanScope = async (
    onChainPlanId: string | null,
  ): Promise<{ teamId: string | null; planId: string | null; environmentId: string | null } | null> => {
    if (!onChainPlanId) return null;
    return resolvePlanScopeFromDashboard(onChainPlanId).catch((err) => {
      console.error(
        "[Facilitator] Failed to resolve team for Stellar subscription:",
        err,
      );
      return null;
    });
  };

  primaryChainAdapter.on("*", (event) => {
    console.log(
      `[Facilitator] ${chainFamily} event: ${event.type} tokenId=${event.tokenId} tx=${event.transactionHash}`,
    );
  });

  primaryChainAdapter.on("minted", async (event) => {
    const tokenId = event.tokenId;
    const subscriber = routeStoreWallet(event.subscriber);
    const onChainPlanId = event.planId ?? null;
    const occurredAt = event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined;
    const planScope = await resolveStellarPlanScope(onChainPlanId);
    const teamId = planScope?.teamId ?? null;

    if (subscriber) {
      await subscriptionRouteStore.write(tokenId, {
        wallet: subscriber,
        teamId,
        onChainPlanId,
        updatedAt: occurredAt ?? new Date().toISOString(),
      });
    }
    if (subscriber) {
      enqueueSubscriptionSync({
        teamId,
        wallet: subscriber,
        onChainPlanId,
        event: "minted",
        occurredAt,
        sourceTxHash: event.transactionHash,
        sourceTokenId: tokenId,
        chainId: CHAIN_ID,
      }).catch((err) =>
        console.error(
          `[Facilitator] sync-subscription (${chainFamily} minted) failed:`,
          err,
        ),
      );
    }
  });

  primaryChainAdapter.on("renewed", async (event) => {
    const tokenId = event.tokenId;
    const existing = await subscriptionRouteStore.read(tokenId);
    const subscriber = routeStoreWallet(
      event.subscriber ?? existing?.wallet,
    );
    const onChainPlanId = event.planId ?? existing?.onChainPlanId ?? null;
    const occurredAt = event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined;
    const planScope = await resolveStellarPlanScope(onChainPlanId);
    const teamId = existing?.teamId ?? planScope?.teamId ?? null;

    if (subscriber) {
      await subscriptionRouteStore.write(tokenId, {
        wallet: subscriber,
        teamId,
        onChainPlanId,
        updatedAt: occurredAt ?? new Date().toISOString(),
      });
    }
    if (subscriber) {
      enqueueSubscriptionSync({
        teamId,
        wallet: subscriber,
        onChainPlanId,
        event: "renewed",
        occurredAt,
        sourceTxHash: event.transactionHash,
        sourceTokenId: tokenId,
        chainId: CHAIN_ID,
      }).catch((err) =>
        console.error(
          `[Facilitator] sync-subscription (${chainFamily} renewed) failed:`,
          err,
        ),
      );
    }
  });

  primaryChainAdapter.on("billing_executed", async (event) => {
    const tokenId = event.tokenId;
    const billingReason = Number(event.billingReason ?? 0);
    const onChainPlanId = event.planId ?? null;
    const subscriberWallet = routeStoreWallet(
      event.account ?? event.subscriber,
    );
    const existing = await subscriptionRouteStore.read(tokenId);
    const planScope = await resolveStellarPlanScope(onChainPlanId);
    const teamId = existing?.teamId ?? planScope?.teamId ?? null;
    const catalogPlanId = planScope?.planId ?? null;
    const environmentId = planScope?.environmentId ?? null;
    const amount = microsToDecimalString(
      BigInt(event.amountPaidMicros ?? "0"),
    );
    const merchantAmount = microsToDecimalString(
      BigInt(event.merchantAmountMicros ?? "0"),
    );
    const protocolFee = microsToDecimalString(
      BigInt(event.protocolFeeMicros ?? "0"),
    );
    const occurredAtMs = event.timestamp
      ? Number(event.timestamp) * 1000
      : undefined;
    const occurredAtIso = occurredAtMs
      ? new Date(occurredAtMs).toISOString()
      : undefined;

    if (subscriberWallet) {
      await subscriptionRouteStore.write(tokenId, {
        wallet: subscriberWallet,
        teamId,
        onChainPlanId,
        updatedAt: occurredAtIso ?? new Date().toISOString(),
      });
    }

    const billingEventName: ProtocolEventName =
      billingReason === 0 ? "subscription.minted" : "subscription.renewed";

    await persistBillingEvent(
      billingEventName,
      buildEventIdempotencyKey(billingEventName, [
        event.transactionHash || tokenId,
        tokenId,
      ]),
      {
        tokenId,
        planId: catalogPlanId ?? onChainPlanId,
        catalogPlanId,
        onChainPlanId,
        environmentId,
        subscriber: subscriberWallet,
        customerWallet: subscriberWallet,
        amount,
        grossAmount: amount,
        merchantAmount,
        protocolFee,
        txHash: event.transactionHash,
        timestamp: event.timestamp?.toString(),
        expiration: event.expiration?.toString(),
        billingReason,
        description:
          billingReason === 0
            ? "Subscription activation"
            : "Subscription renewal",
      },
      true,
      occurredAtMs,
      {
        teamId,
        onChainPlanId,
        sourceTokenId: tokenId,
        wallet: subscriberWallet ?? null,
      },
    );

    if (subscriberWallet) {
      enqueueSubscriptionSync({
        teamId,
        wallet: subscriberWallet,
        onChainPlanId,
        event: billingReason === 0 ? "minted" : "renewed",
        occurredAt: occurredAtIso,
        sourceTxHash: event.transactionHash,
        sourceTokenId: tokenId,
        chainId: CHAIN_ID,
      }).catch((err) =>
        console.error(
          `[Facilitator] sync-subscription (${chainFamily} billing_executed) failed:`,
          err,
        ),
      );
    }
  });

  primaryChainAdapter.on("plan_changed", async (event) => {
    const tokenId = event.tokenId;
    const existing = await subscriptionRouteStore.read(tokenId);
    const subscriber = routeStoreWallet(
      event.subscriber ?? existing?.wallet,
    );
    const onChainPlanId = event.planId ?? null;
    const occurredAt = event.timestamp
      ? new Date(Number(event.timestamp) * 1000).toISOString()
      : undefined;
    const planScope = await resolveStellarPlanScope(onChainPlanId);
    const teamId = existing?.teamId ?? planScope?.teamId ?? null;

    if (subscriber) {
      await subscriptionRouteStore.write(tokenId, {
        wallet: subscriber,
        teamId,
        onChainPlanId,
        updatedAt: occurredAt ?? new Date().toISOString(),
      });
    }
    if (subscriber) {
      enqueueSubscriptionSync({
        teamId,
        wallet: subscriber,
        onChainPlanId,
        event: "plan_changed",
        occurredAt,
        sourceTxHash: event.transactionHash,
        sourceTokenId: tokenId,
        chainId: CHAIN_ID,
      }).catch((err) =>
        console.error(
          `[Facilitator] sync-subscription (${chainFamily} plan_changed) failed:`,
          err,
        ),
      );
    }
  });

  primaryChainAdapter.on("cancelled", async (event) => {
    const tokenId = event.tokenId;
    const existing = await subscriptionRouteStore.read(tokenId);
    const subscriber = routeStoreWallet(existing?.wallet);
    const teamId = existing?.teamId ?? null;

    await persistBillingEvent(
      "subscription.cancelled",
      buildEventIdempotencyKey("subscription.cancelled", [
        event.transactionHash || tokenId,
      ]),
      {
        tokenId,
        txHash: event.transactionHash,
        timestamp: event.timestamp?.toString(),
      },
      false,
      event.timestamp ? Number(event.timestamp) * 1000 : undefined,
      {
        teamId,
        onChainPlanId: existing?.onChainPlanId ?? null,
        sourceTokenId: tokenId,
        wallet: subscriber,
      },
    );

    if (subscriber) {
      enqueueSubscriptionSync({
        teamId,
        wallet: subscriber,
        onChainPlanId: null,
        event: "cancelled",
        occurredAt: event.timestamp
          ? new Date(Number(event.timestamp) * 1000).toISOString()
          : undefined,
        sourceTxHash: event.transactionHash,
        sourceTokenId: tokenId,
        chainId: CHAIN_ID,
      }).catch((err) =>
        console.error(
          `[Facilitator] sync-subscription (${chainFamily} cancelled) failed:`,
          err,
        ),
      );
    }
  });
}

// Watch for cross-chain dispatch requests and relay via Axelar/CCIP (PRD §7.2)
if (axelarTransport || ccipTransport) {
  let lastCrossChainDispatchBlock: bigint | null = null;
  const handleCrossChainDispatchLogs = async (
    logs: Array<{
      args: unknown;
      blockNumber: bigint;
    }>,
  ) => {
    for (const log of logs) {
      const { tokenId, destinationChainId, route } = log.args as {
        tokenId: bigint;
        destinationChainId: bigint;
        route: number;
        messageId: `0x${string}`;
      };
      const destChainId = Number(destinationChainId);
      const destinationMirrorRegistry =
        resolveDestinationMirrorRegistryAddress(destChainId);

      if (!destinationMirrorRegistry) {
        console.warn(
          `[Facilitator] GMP dispatch for tokenId=${tokenId} destination=${destChainId} skipped — destination MirrorRegistry not configured`,
        );
        continue;
      }

      let payload: `0x${string}`;
      try {
        const block = await chainClient.getBlock({
          blockNumber: log.blockNumber,
        });
        payload = await buildMirrorPayload(tokenId, BigInt(block.timestamp));
      } catch (err) {
        console.error(
          `[Facilitator] Failed to build mirror payload for tokenId=${tokenId}:`,
          err,
        );
        continue;
      }

      const refundAddress = (CONTRACTS.sessionVault ||
        "0x0000000000000000000000000000000000000000") as `0x${string}`;

      let transport: AxelarTransport | CCIPTransport | null = null;
      let routeLabel = "unknown";
      if (route === 1) {
        transport = axelarTransport;
        routeLabel = "Axelar";
      } else if (route === 2) {
        transport = ccipTransport;
        routeLabel = "CCIP";
      }

      if (!transport) {
        console.warn(
          `[Facilitator] GMP dispatch for tokenId=${tokenId} route=${route} (${routeLabel}) — transport not configured`,
        );
        continue;
      }
      try {
        const result = await transport.dispatch(
          destChainId,
          payload,
          refundAddress,
          destinationMirrorRegistry,
        );
        console.log(
          `[Facilitator] GMP dispatched tokenId=${tokenId} → chain ${destChainId} via ${routeLabel} txHash=${result.transactionHash}`,
        );
      } catch (err) {
        console.error(
          `[Facilitator] GMP dispatch failed for tokenId=${tokenId}:`,
          err,
        );
      }
    }
  };

  setTimeout(() => {
    void (async () => {
      try {
        lastCrossChainDispatchBlock = await chainClient.getBlockNumber();
      } catch {
        lastCrossChainDispatchBlock = 0n;
      }

      setInterval(async () => {
        try {
          const currentBlock = await chainClient.getBlockNumber();
          const fromBlock =
            lastCrossChainDispatchBlock == null
              ? currentBlock
              : lastCrossChainDispatchBlock + 1n;

          if (currentBlock < fromBlock) return;

          const logs = await chainClient.getContractEvents({
            address: CONTRACTS.subscriptionRegistry as `0x${string}`,
            abi: SubscriptionRegistryABI,
            eventName: "CrossChainDispatchRequested",
            fromBlock,
            toBlock: currentBlock,
          });

          if (logs.length > 0) {
            await handleCrossChainDispatchLogs(
              logs as Array<{ args: unknown; blockNumber: bigint }>,
            );
          }

          lastCrossChainDispatchBlock = currentBlock;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("request limit reached") ||
            msg.includes("429") ||
            msg.includes("-32011")
          ) {
            console.warn(
              "[Facilitator] CrossChainDispatchRequested watcher rate-limited. Retrying next tick.",
            );
          } else {
            console.error(
              "[Facilitator] CrossChainDispatchRequested watcher error:",
              err,
            );
          }
        }
      }, 25000);
    })();
    console.log("[Facilitator] Cross-chain dispatch watcher active");
  }, 5000);
}

// Watch for settlement events (EVM-only service — no-op on Stellar)
settlementService?.watchSettlements((settlement) => {
  console.log(
    `[Facilitator] 💰 Settlement: ${settlement.sessionId} — ${settlement.settlementAmount} (${settlement.callCount} calls)`,
  );
});

// eventListener.start() is called inside the startup IIFE so the banner
// reflects actual start success/failure.
let eventListenerActive = false;

// Start proof orchestrator auto-submission
proofOrchestrator.startAutoSubmit();
console.log("[Facilitator] ProofOrchestrator auto-submit active");

// Agent balance monitor — polls agent balances and triggers dispatch notifications
const balanceMonitor = new BalanceMonitor({
  apiBaseUrl: INTERNAL_API_BASE_URL,
  facilitatorSecret: FACILITATOR_SECRET || undefined,
  publicClient: chainClient,
  sessionVaultAddress: CONTRACTS.sessionVault,
  pollIntervalMs: Number(process.env.BALANCE_MONITOR_INTERVAL_MS || 60000),
  onDispatch: async (record, provider) => {
    // Store the pending approval in memory for the agent SDK to poll
    storePendingApproval({
      requestId: record.requestId,
      status: "pending",
      agentAddress: record.agentAddress,
      amount: record.amount,
      chatId: provider.chatId || "",
      botToken: provider.botToken || "",
      createdAt: Date.now(),
    });

    // Send Telegram message
    if (provider.type === "telegram" && provider.botToken && provider.chatId) {
      const message =
        `<b>💰 ArcenPay Agent — Top-Up Request</b>\n\n` +
        `<b>Agent:</b> <code>${record.agentAddress.slice(0, 6)}…${record.agentAddress.slice(-4)}</code>\n` +
        `<b>Amount:</b> $${(Number(record.amount) / 1_000_000).toFixed(2)} USDC\n` +
        `<b>Reason:</b> Balance below threshold\n` +
        `<b>Request ID:</b> <code>${record.requestId}</code>\n\n` +
        `<i>Tap one of the buttons below:</i>`;

      try {
        await fetch(
          `https://api.telegram.org/bot${provider.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: provider.chatId,
              text: message,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Approve",
                      callback_data: `arcenpay:approve:${record.requestId}`,
                    },
                    {
                      text: "❌ Deny",
                      callback_data: `arcenpay:deny:${record.requestId}`,
                    },
                  ],
                ],
              },
            }),
          },
        );
      } catch (err) {
        console.error("[BalanceMonitor] Telegram send failed:", err);
      }
    }
  },
});

// Optional: Billing Keeper (if private key is configured and explicitly enabled)
// EVM-only today — the renewal scanner reads the EVM SubscriptionRegistry via
// viem and executes ERC-7579 AutopayModule calls. Stellar renewals flow
// through backend activation/sync + Soroban autopay-account events instead.
let billingKeeper: BillingKeeper | null = null;
if (
  process.env.ENABLE_BILLING_KEEPER === "true" &&
  process.env.PRIVATE_KEY &&
  getChainFamily(CHAIN_ID) === "evm"
) {
  try {
    billingKeeper = new BillingKeeper({
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      privateKey: normalizePrivateKey(process.env.PRIVATE_KEY),
      intervalMs: Number(process.env.KEEPER_INTERVAL_MS || 60000),
      batchSize: Number(process.env.KEEPER_BATCH_SIZE || 20),
      renewalBufferSeconds: Number(
        process.env.KEEPER_RENEWAL_BUFFER_SECONDS || 86400,
      ),
    });

    // Forward renewal events to webhooks
    billingKeeper.onRenewal((result) => {
      if (webhookService) {
        void webhookService.deliver(
          {
            event: result.success
              ? "subscription.auto_renewed"
              : "subscription.renewal_failed",
            timestamp: Date.now(),
            data: {
              tokenId: result.tokenId.toString(),
              subscriber: result.subscriber,
              txHash: result.txHash,
              error: result.error,
            },
          },
          1,
        );
      }

      if (!result.success) {
        void (async () => {
          const tokenId = result.tokenId.toString();
          const routeState = await subscriptionRouteStore.read(tokenId);
          const subscriberEmail = await lookupSubscriberEmail(
            result.subscriber,
          );
          await persistBillingEvent(
            "subscription.renewal_failed",
            buildEventIdempotencyKey("subscription.renewal_failed", [
              result.tokenId,
              result.txHash || result.error || Date.now(),
            ]),
            {
              tokenId,
              subscriber: result.subscriber,
              customerWallet: result.subscriber,
              ...(subscriberEmail && { email: subscriberEmail }),
              txHash: result.txHash,
              error: result.error ?? "renewal failed",
              description: "Subscription renewal failed",
            },
            false,
            new Date(),
            {
              teamId: routeState?.teamId ?? null,
              onChainPlanId: routeState?.onChainPlanId ?? null,
              sourceTokenId: tokenId,
              wallet: routeState?.wallet ?? result.subscriber,
            },
          );
        })().catch((err) => {
          console.error(
            "[Facilitator] Failed to persist renewal failure billing event:",
            err,
          );
        });
      }
    });

    billingKeeper.start();
    console.log("[Facilitator] BillingKeeper active");
  } catch (err) {
    console.error("[Facilitator] BillingKeeper init failed:", err);
    billingKeeper = null;
  }
}

// ── Stellar Renewal Driver ─────────────────────────────────────────────────
// The Soroban autopay-account analog of the EVM BillingKeeper. Only relevant
// when the facilitator runs a Stellar chain AND the operator explicitly enables
// it AND configures subscriber keypairs. Soroban requires the SUBSCRIBER's
// authorization on every charge, so the driver only auto-charges subscribers
// whose S… secrets are configured (STELLAR_RENEWAL_KEYS="G…:S…,…"); other due
// renewals are surfaced as log notices for the co-sign flow.
let stellarRenewalDriver: StellarRenewalDriver | null = null;
if (
  chainFamily === "stellar" &&
  process.env.STELLAR_RENEWAL_DRIVER_ENABLED === "true"
) {
  try {
    stellarRenewalDriver = new StellarRenewalDriver({
      chainId: CHAIN_ID,
      intervalMs: Number(process.env.STELLAR_RENEWAL_DRIVER_INTERVAL_MS || 60_000),
      subscriberKeys: process.env.STELLAR_RENEWAL_KEYS || "",
    });
    stellarRenewalDriver.onRenewal((result) => {
      console.log(
        `[Facilitator] Stellar renewal result: wallet=${result.wallet} ` +
          `due=${result.due} charged=${result.charged} ${result.txHash ? `tx=${result.txHash}` : ""}` +
          (result.error ? ` error=${result.error}` : ""),
      );
    });
    stellarRenewalDriver.start();
    console.log("[Facilitator] StellarRenewalDriver active");
  } catch (err) {
    console.error("[Facilitator] StellarRenewalDriver init failed:", err);
    stellarRenewalDriver = null;
  }
}

// ============================================================
//  Solana Renewal Driver
// ============================================================

let solanaRenewalDriver: SolanaRenewalDriver | null = null;

if (
  chainFamily === "solana" &&
  process.env.SOLANA_RENEWAL_DRIVER_ENABLED === "true"
) {
  try {
    solanaRenewalDriver = new SolanaRenewalDriver({
      chainId: CHAIN_ID,
      intervalMs: Number(process.env.SOLANA_RENEWAL_DRIVER_INTERVAL_MS || 60_000),
      batchSize: Number(process.env.SOLANA_RENEWAL_BATCH_SIZE || 25),
      // The relayer pays network fees only; it never holds a subscriber key.
      // Falls back to the settlement key so a single funded Solana keypair can
      // serve both roles where that is convenient.
      relayerKey:
        process.env.SOLANA_RELAYER_PRIVATE_KEY ||
        process.env.SETTLEMENT_PRIVATE_KEY ||
        process.env.PRIVATE_KEY ||
        "",
    });
    solanaRenewalDriver.onRenewal((result) => {
      const detail = result.txHash ? ` tx=${result.txHash}` : "";
      const err = result.error ? ` error=${result.error}` : "";
      if (result.outcome === "renewed") {
        console.log(
          `[Facilitator] Solana renewal ✅ wallet=${result.wallet} ` +
            `tokenId=${result.tokenId}${detail}`,
        );
      } else if (result.outcome === "reauthorization_required") {
        console.warn(
          `[Facilitator] Solana renewal ⚠️  reauthorization required: ` +
            `wallet=${result.wallet} tokenId=${result.tokenId}${err}`,
        );
      } else if (result.outcome === "failed") {
        console.error(
          `[Facilitator] Solana renewal ❌ failed: wallet=${result.wallet} ` +
            `tokenId=${result.tokenId}${err}`,
        );
      }
    });
    solanaRenewalDriver.start();
    console.log(
      `[Facilitator] SolanaRenewalDriver active (relayer ${solanaRenewalDriver.getRelayerAddress()})`,
    );
  } catch (err) {
    console.error("[Facilitator] SolanaRenewalDriver init failed:", err);
    solanaRenewalDriver = null;
  }
}

startBillingMaintenanceScheduler();

// ============================================================
//  Health Check
// ============================================================

app.get("/metrics", async (_req, res) => {
  aggregatorQueueDepth.set(aggregatorService.getStats().pendingSettlements);
  // Durable queue gauges
  for (const queueName of ["billing", "webhooks"]) {
    const stats = jobQueue.getStats(queueName);
    durableQueuePendingDepth.set({ queue: queueName }, stats.pending);
    durableQueueDeadLetterDepth.set({ queue: queueName }, stats.deadLetter);
  }
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

app.get("/health", async (_req, res) => {
  let blockNumber: string | null = null;
  try {
    blockNumber = (await chainClient.getBlockNumber()).toString();
  } catch {
    blockNumber = null;
  }

  res.json({
    status: "ok",
    service: "arcenpay-facilitator",
    version: "0.1.0",
    profile: FACILITATOR_PROFILE,
    chainId: CHAIN_ID,
    runtimeChain: {
      expectedChainId: RUNTIME_CHAIN_PROFILE.chainId,
      expectedChainName: RUNTIME_CHAIN_PROFILE.chainName,
      supported: CHAIN_ID === RUNTIME_CHAIN_PROFILE.chainId,
      warning:
        CHAIN_ID === RUNTIME_CHAIN_PROFILE.chainId
          ? null
          : `${formatRuntimeChainMismatch({
              actualChainId: CHAIN_ID,
              expectedChainId: RUNTIME_CHAIN_PROFILE.chainId,
            })} Set CHAIN_ID=${RUNTIME_CHAIN_PROFILE.chainId} and a ${RUNTIME_CHAIN_PROFILE.chainName} RPC (${RUNTIME_CHAIN_PROFILE.rpcEnvKeys.join(", ")}).`,
    },
    blockNumber,
    timestamp: new Date().toISOString(),
    services: {
      eventListener: "active",
      webhook: webhookService ? "active" : "not configured",
      email: emailService ? "active" : "not configured",
      tableland: tablelandService ? "active" : "not configured",
      lit: litRuntimeState.configured
        ? litRuntimeState.ready
          ? "active"
          : "failed"
        : "not configured",
      settlementWriter: settlementWriter ? "active" : "not configured",
      aggregator: "active",
      redis: redisUsageStore ? "active" : "not configured",
      dashboardBridge: DASHBOARD_URL ? "active" : "not configured",
    },
    queues: {
      aggregationPending: aggregatorService.getStats().pendingSettlements,
      webhookFailuresLast200: webhookService
        ? webhookService.getDeliveryLog(200).filter((entry) => !entry.success)
            .length
        : 0,
      billingBridge: jobQueue.getStats("billing"),
      webhookDelivery: jobQueue.getStats("webhooks"),
    },
    settlement: {
      onchainEnabled: Boolean(settlementWriter),
      requireAuthorizedSettler,
      signerAddress: settlementAuthorizationState.signerAddress,
      sessionVaultAddress: settlementAuthorizationState.sessionVaultAddress,
      signerAuthorized: settlementAuthorizationState.authorized,
      lastAuthorizationCheckAt: settlementAuthorizationState.lastCheckedAt,
      authorizationError: settlementAuthorizationState.lastError,
    },
    litDetails: {
      configured: litRuntimeState.configured,
      network: litRuntimeState.network,
      ready: litRuntimeState.ready,
      lastError: litRuntimeState.lastError,
    },
    replayProtection: replayProtection.getStats(),
    proofRuntime: usageService.getProofRuntimeConfig(),
    billingMaintenance: {
      enabled: BILLING_MAINTENANCE_ENABLED,
      executeDunning: BILLING_MAINTENANCE_EXECUTE_DUNNING,
      intervalMs: BILLING_MAINTENANCE_INTERVAL_MS,
      initialDelayMs: BILLING_MAINTENANCE_INITIAL_DELAY_MS,
      teamLimit: BILLING_MAINTENANCE_TEAM_LIMIT,
      limitPerTeam: BILLING_MAINTENANCE_LIMIT_PER_TEAM,
      dashboardUrlConfigured: Boolean(DASHBOARD_URL),
      inFlight: billingMaintenanceRunInFlight,
      lastRunAt: billingMaintenanceLastRunAt,
      lastSuccessAt: billingMaintenanceLastSuccessAt,
      lastError: billingMaintenanceLastError,
    },
    slo: (() => {
      const billingStats = jobQueue.getStats("billing");
      const webhookStats = jobQueue.getStats("webhooks");
      const webhookFailures = webhookService
        ? webhookService.getDeliveryLog(200).filter((e) => !e.success).length
        : 0;

      const breaches: string[] = [];

      // SLO 1: Billing queue dead-letter must stay at 0
      if (billingStats.deadLetter > 0) {
        breaches.push(
          `billing_dead_letter: ${billingStats.deadLetter} jobs require manual replay`,
        );
      }
      // SLO 2: Webhook dead-letter must stay at 0
      if (webhookStats.deadLetter > 0) {
        breaches.push(
          `webhook_dead_letter: ${webhookStats.deadLetter} jobs require manual replay`,
        );
      }
      // SLO 3: Billing queue backlog < 50 (indicates dashboard bridge is lagging)
      if (billingStats.pending > 50) {
        breaches.push(
          `billing_backlog: ${billingStats.pending} pending (SLO: <50)`,
        );
      }
      // SLO 4: Webhook failure rate < 10 in last 200 deliveries
      if (webhookFailures > 10) {
        breaches.push(
          `webhook_failure_rate: ${webhookFailures}/200 recent deliveries failed (SLO: <10)`,
        );
      }
      // SLO 5: RPC connectivity — block number must be available
      if (!blockNumber) {
        breaches.push(
          "rpc_connectivity: unable to read latest block — check RPC_URL",
        );
      }
      // SLO 6: Settler authorization must be valid when on-chain settlement is enabled
      if (settlementWriter && !settlementAuthorizationState.authorized) {
        breaches.push(
          "settler_authorization: on-chain settler is not authorized — settlement will fail",
        );
      }

      return {
        ok: breaches.length === 0,
        breachCount: breaches.length,
        breaches,
      };
    })(),
  });
});

// ============================================================
//  Protocol Info
// ============================================================

app.get("/info", (_req, res) => {
  const networkLabel =
    process.env.X402_NETWORK ||
    (getChainFamily(CHAIN_ID) === "stellar"
      ? CHAIN_ID === 9_000_000
        ? "stellar-mainnet"
        : "stellar-testnet"
      : getChainFamily(CHAIN_ID) === "solana"
        ? CHAIN_ID === 9_100_000
          ? "solana-mainnet"
          : CHAIN_ID === 9_100_002
            ? "solana-testnet"
            : "solana-devnet"
        : CHAIN_ID === 677
          ? "bot-mainnet"
          : CHAIN_ID === 968
            ? "bot-testnet"
            : CHAIN_ID === 5042002
              ? "arc-testnet"
              : CHAIN_ID === 8453
                ? "base-mainnet"
                : CHAIN_ID === 11155111
                  ? "ethereum-sepolia"
                  : "base-sepolia");
  res.json({
    protocol: "ArcenPay + ZKVUB",
    version: "0.1.0",
    x402Version: "1",
    chainId: CHAIN_ID,
    supportedNetworks: [networkLabel],
    supportedTokens: ["USDC"],
  });
});

// ============================================================
//  x402 Protected Demo Endpoint
// ============================================================

app.use(
  "/api/premium",
  (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const status = String(res.statusCode);
      const endpoint = req.route?.path
        ? String(req.route.path)
        : req.path || "/api/premium";
      x402RequestsTotal.inc({
        endpoint,
        method: req.method,
        status,
      });

      if (res.statusCode === 402) {
        const rejectionReason = String(
          res.getHeader("x-arcenpay-rejection-reason") || "unknown",
        );
        x402ValidationErrorsTotal.inc({ reason: rejectionReason });
      }

      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      if (!Number.isNaN(durationSeconds) && durationSeconds >= 0) {
        // Keep queue depth fresh on every premium request.
        aggregatorQueueDepth.set(
          aggregatorService.getStats().pendingSettlements,
        );
      }
    });
    next();
  },
  // ── Replay protection — reject replayed x402 payment headers ────────────
  (req, res, next) => {
    const rawHeader = req.headers["x-payment"];
    if (typeof rawHeader === "string" && rawHeader) {
      const paymentId = X402ReplayProtection.paymentIdFromHeader(rawHeader);
      if (replayProtection.checkAndRecord(paymentId)) {
        x402ReplayRejections.inc();
        res.setHeader("x-arcenpay-rejection-reason", "replay_detected");
        return res.status(402).json({
          error:
            "Payment replay detected. Each x-payment header may only be used once.",
          code: "REPLAY_DETECTED",
        });
      }
    }
    next();
  },
  x402WalletLimiter,
  x402Middleware({
    planId: process.env.X402_PLAN_ID || "demo",
    ratePerCall: process.env.X402_RATE_PER_CALL || "0.001",
    // The runtime chain drives verification: pass CHAIN_ID so the middleware
    // picks the correct family branch (EVM EIP-712 vs Stellar ed25519) and
    // the right SessionVault balance-check contract.
    chainId: CHAIN_ID,
    // Pass explicit network override only if configured; otherwise x402Middleware
    // automatically infers the correct network matching CHAIN_ID.
    ...(process.env.X402_NETWORK ? { network: process.env.X402_NETWORK } : {}),
    failOpenOnBalanceCheck: process.env.X402_FAIL_OPEN_BALANCE_CHECK === "true",
    ...(settlementWriter
      ? {
          settlePayment: async ({
            signer,
            amount,
            sessionId,
          }: {
            signer: string;
            amount: bigint;
            sessionId: string;
          }) => {
            const observe = onChainSubmissionsLatencySeconds.startTimer();
            try {
              if (requireAuthorizedSettler) {
                const authorization = await refreshSettlementAuthorization();
                if (authorization !== true) {
                  throw new Error(
                    "Facilitator signer is not authorized to settle SessionVault funds.",
                  );
                }
              }

              const result = await settlementWriter!.settleForSigner({
                signer,
                amount,
                sessionIdHint: sessionId,
                providerAddress: process.env.X402_PROVIDER_ADDRESS || undefined,
              });

              observe({ outcome: "success" });
              return {
                settledAmount: result.settledAmount,
                settlementTxHash: result.transactionHash,
              };
            } catch (error) {
              observe({ outcome: "error" });
              throw error;
            }
          },
        }
      : {}),
  }),
);

app.get("/api/premium/data", (req, res) => {
  const payment = (
    req as express.Request & {
      arcenpayPayment?: X402VerifiedPaymentContext;
    }
  ).arcenpayPayment;
  let aggregation: {
    totalEntries: number;
    thresholdReached: boolean;
  } | null = null;

  if (payment) {
    const usageTimestamp = Date.now();
    // Route usage through ProofOrchestrator for auto proof generation
    void proofOrchestrator.recordUsage(payment.sessionId || "default", {
      endpoint: "/api/premium/data",
      method: "GET",
      timestamp: usageTimestamp,
    });

    aggregation = aggregatorService.addEntry({
      sessionId: payment.sessionId || "default",
      endpoint: "/api/premium/data",
      method: "GET",
      timestamp: usageTimestamp,
      responseSize: 0,
      signature: payment.paymentHeader,
    });

    if (redisUsageStore) {
      void (async () => {
        try {
          if (redisReady) {
            await redisReady;
          }
          if (!redisUsageStore) return;

          await redisUsageStore.appendUsage({
            sessionId: payment.sessionId || "default",
            signer: payment.signer,
            endpoint: "/api/premium/data",
            method: "GET",
            timestamp: usageTimestamp,
            amount: payment.settledAmount || payment.amount,
            settlementTxHash: payment.settlementTxHash,
          });

          if (payment.settlementTxHash) {
            await redisUsageStore.setLatestSettlementTx(
              payment.sessionId || "default",
              payment.settlementTxHash,
            );
          }
        } catch (err) {
          console.error("[Facilitator] Redis usage persist failed:", err);
        }
      })();
    }
  }

  res.json({
    message: "Premium data accessed successfully",
    data: {
      insights: payment?.verified
        ? [
            {
              metric: "settled_amount",
              value: payment.settledAmount,
              change: null,
            },
            {
              metric: "usage_entries",
              value: aggregation?.totalEntries ?? 0,
              change: null,
            },
          ]
        : [],
    },
    payment: {
      verified: payment?.verified,
      signer: payment?.signer,
      settledAmount: payment?.settledAmount,
      settlementTxHash: payment?.settlementTxHash,
      rejectionReason: payment?.rejectionReason,
      usageEntriesInWindow: aggregation?.totalEntries,
      settlementThresholdReached: aggregation?.thresholdReached,
      timestamp: payment?.timestamp,
    },
  });
});

// ============================================================
//  Usage Analytics Endpoint
// ============================================================

app.get("/api/usage/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  let count = usageService.getUsageCount(sessionId);
  let latestSettlementTxHash: string | null = null;

  if (redisUsageStore) {
    try {
      if (redisReady) {
        await redisReady;
      }
      if (redisUsageStore) {
        count = await redisUsageStore.getUsageCount(sessionId);
        latestSettlementTxHash =
          await redisUsageStore.getLatestSettlementTx(sessionId);
      }
    } catch (err) {
      console.error("[Facilitator] Redis usage read failed:", err);
    }
  }

  res.json({
    sessionId,
    callCount: count,
    latestSettlementTxHash,
    source: redisUsageStore ? "redis" : "memory",
  });
});

app.get("/api/usage/:sessionId/report", (req, res) => {
  const observe = proofGenerationDurationSeconds.startTimer();
  const { sessionId } = req.params;
  let circuitInputs: ReturnType<AggregatorService["getCircuitInputs"]>;
  try {
    circuitInputs = aggregatorService.getCircuitInputs(sessionId);
  } finally {
    observe();
  }

  res.json({
    sessionId,
    callCount: circuitInputs.callCount,
    merkleRoot: circuitInputs.merkleRoot,
    windowStart: circuitInputs.windowStart,
    windowEnd: circuitInputs.windowEnd,
    logHashes: circuitInputs.logHashes,
  });
});

app.get("/api/usage/:sessionId/logs", async (req, res) => {
  const { sessionId } = req.params;
  const limitParam = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(Math.trunc(limitParam), 500))
    : 100;

  if (!redisUsageStore) {
    return res.json({
      sessionId,
      source: "memory",
      entries: [],
      message:
        "Redis usage store not configured. Set REDIS_URL to enable durable usage logs.",
    });
  }

  try {
    if (redisReady) {
      await redisReady;
    }
    if (!redisUsageStore) {
      return res.json({ sessionId, source: "memory", entries: [] });
    }
    const entries = await redisUsageStore.getUsageEntries(sessionId, limit);
    return res.json({
      sessionId,
      source: "redis",
      limit,
      count: entries.length,
      entries,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || "Failed to fetch usage logs.",
    });
  }
});

app.get("/api/aggregator/stats", (_req, res) => {
  const stats = aggregatorService.getStats();
  aggregatorQueueDepth.set(stats.pendingSettlements);
  res.json({
    ...stats,
    threshold: Number(process.env.SETTLEMENT_THRESHOLD || 100),
  });
});

app.get("/api/ops/settlement/status", async (_req, res) => {
  await refreshSettlementAuthorization();
  return res.json({
    onchainEnabled: Boolean(settlementWriter),
    requireAuthorizedSettler,
    signerAddress: settlementAuthorizationState.signerAddress,
    sessionVaultAddress: settlementAuthorizationState.sessionVaultAddress,
    signerAuthorized: settlementAuthorizationState.authorized,
    lastAuthorizationCheckAt: settlementAuthorizationState.lastCheckedAt,
    authorizationError: settlementAuthorizationState.lastError,
  });
});

app.get("/api/ops/proof/runtime", (_req, res) => {
  return res.json({
    profile: FACILITATOR_PROFILE,
    ...usageService.getProofRuntimeConfig(),
  });
});

// ============================================================
//  Entitlement Flags Endpoint (Tableland + On-Chain fallback)
// ============================================================

app.get("/api/entitlements/:wallet/flags", async (req, res) => {
  const wallet = String(req.params.wallet || "").trim();
  if (!isValidAddress(wallet)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid wallet address.",
    });
  }

  const normalizedWallet = wallet.toLowerCase() as `0x${string}`;

  try {
    if (tablelandService) {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (tablelandService) {
        const flags = await tablelandService.getFeatureFlags(normalizedWallet);
        if (Object.keys(flags).length > 0) {
          return res.json({
            ok: true,
            source: "tableland",
            wallet: normalizedWallet,
            flags,
            updatedAt: Date.now(),
          });
        }
      }
    }

    const hasActive = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "hasActiveSubscription",
      args: [normalizedWallet],
    })) as boolean;

    if (!hasActive) {
      return res.json({
        ok: true,
        source: "onchain",
        wallet: normalizedWallet,
        flags: {},
        updatedAt: Date.now(),
      });
    }

    const tokenId = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "getWalletSubscription",
      args: [normalizedWallet],
    })) as bigint;

    if (tokenId <= 0n) {
      return res.json({
        ok: true,
        source: "onchain",
        wallet: normalizedWallet,
        flags: {},
        updatedAt: Date.now(),
      });
    }

    const snapshot = await getSubscriptionSnapshot(tokenId);
    const flags = getDefaultFlagsForTier(snapshot.planTier);

    return res.json({
      ok: true,
      source: "onchain",
      wallet: normalizedWallet,
      tokenId: tokenId.toString(),
      planTier: snapshot.planTier,
      flags,
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to resolve entitlement flags.",
    });
  }
});

app.get("/api/entitlements/provider/:provider/flags", async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  if (!isValidAddress(provider)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid provider address.",
    });
  }

  const normalizedProvider = provider.toLowerCase() as `0x${string}`;

  try {
    if (tablelandService) {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (tablelandService) {
        const matrix =
          await tablelandService.listTierFeatureFlags(normalizedProvider);
        return res.json({
          ok: true,
          source: "tableland",
          storageReady: true,
          provider: normalizedProvider,
          planTiers: [...PROVIDER_TIERS],
          flags: buildProviderFlagCatalog(matrix),
          matrix,
          updatedAt: Date.now(),
        });
      }
    }

    // Use in-memory store if it has been bootstrapped
    const memMatrix = getInMemoryMatrix(normalizedProvider);
    const memFlags = buildProviderFlagCatalog(memMatrix);
    // Merge in stored metadata (label, description)
    const metaMap = flagMetadataStore.get(normalizedProvider);
    if (metaMap) {
      for (const flag of memFlags) {
        const meta = metaMap.get(flag.key);
        if (meta?.label) flag.label = meta.label;
        (flag as Record<string, unknown>).description = meta?.description ?? "";
      }
    }
    return res.json({
      ok: true,
      source: "memory",
      storageReady: true,
      provider: normalizedProvider,
      planTiers: [...PROVIDER_TIERS],
      flags: memFlags,
      matrix: memMatrix,
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to resolve provider flags.",
    });
  }
});

app.post(
  "/api/entitlements/provider/:provider/flags/bootstrap",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    const provider = String(req.params.provider || "").trim();
    if (!isValidAddress(provider)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid provider address.",
      });
    }

    if (!tablelandService) {
      const normalizedProvider = provider.toLowerCase();
      inMemoryFlags.set(normalizedProvider, {
        starter: {},
        pro: {},
        enterprise: {},
      });
      return res.json({
        ok: true,
        provider: normalizedProvider,
        initialized: true,
        source: "memory",
      });
    }

    try {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (!tablelandService) {
        return res
          .status(503)
          .json({ ok: false, error: "Tableland service unavailable." });
      }

      const normalizedProvider = provider.toLowerCase();
      for (const tier of PROVIDER_TIERS) {
        await tablelandService.setTierFeatureFlags(
          normalizedProvider,
          tier,
          getDefaultFlagsForTier(tier),
        );
      }

      return res.json({
        ok: true,
        provider: normalizedProvider,
        initialized: true,
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Failed to initialize provider feature flags.",
      });
    }
  },
);

app.put(
  "/api/entitlements/provider/:provider/flags/:flagKey",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    const provider = String(req.params.provider || "").trim();
    const flagKey = String(req.params.flagKey || "")
      .trim()
      .toLowerCase();
    if (!isValidAddress(provider)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid provider address." });
    }
    if (!/^[a-z0-9_]+$/.test(flagKey)) {
      return res.status(400).json({
        ok: false,
        error: "flagKey must be lowercase alphanumeric with underscores.",
      });
    }
    const requestedTiersRaw = Array.isArray(req.body?.planTiers)
      ? (req.body.planTiers as unknown[])
      : [];
    const enabledTiers = new Set(
      requestedTiersRaw
        .filter((tier): tier is string => typeof tier === "string")
        .map((tier) => normalizeProviderTier(tier)),
    );

    if (!tablelandService) {
      const normalizedProvider = provider.toLowerCase();
      const matrix = getInMemoryMatrix(normalizedProvider);
      for (const tier of PROVIDER_TIERS) {
        matrix[tier][flagKey] = enabledTiers.has(tier);
      }
      const label =
        typeof req.body?.label === "string" ? req.body.label.trim() : "";
      const description =
        typeof req.body?.description === "string"
          ? req.body.description.trim()
          : "";
      const type =
        typeof req.body?.type === "string" ? req.body.type.trim() : "boolean";
      setFlagMeta(normalizedProvider, flagKey, { label, description, type });
      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        planTiers: Array.from(enabledTiers),
        source: "memory",
      });
    }

    try {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (!tablelandService) {
        return res
          .status(503)
          .json({ ok: false, error: "Tableland service unavailable." });
      }

      const normalizedProvider = provider.toLowerCase();
      const matrix =
        await tablelandService.listTierFeatureFlags(normalizedProvider);

      for (const tier of PROVIDER_TIERS) {
        const nextFlags = { ...(matrix[tier] || {}) };
        nextFlags[flagKey] = enabledTiers.has(tier);
        await tablelandService.setTierFeatureFlags(
          normalizedProvider,
          tier,
          nextFlags,
        );
      }

      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        planTiers: Array.from(enabledTiers),
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Failed to upsert provider feature flag.",
      });
    }
  },
);

app.patch(
  "/api/entitlements/provider/:provider/flags/:flagKey",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    const provider = String(req.params.provider || "").trim();
    const flagKey = String(req.params.flagKey || "")
      .trim()
      .toLowerCase();
    const tier = normalizeProviderTier(String(req.body?.tier || "starter"));
    const enabled = Boolean(req.body?.enabled);

    if (!isValidAddress(provider)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid provider address." });
    }
    if (!/^[a-z0-9_]+$/.test(flagKey)) {
      return res.status(400).json({
        ok: false,
        error: "flagKey must be lowercase alphanumeric with underscores.",
      });
    }
    if (!tablelandService) {
      const normalizedProvider = provider.toLowerCase();
      const matrix = getInMemoryMatrix(normalizedProvider);
      matrix[tier][flagKey] = enabled;
      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        tier,
        enabled,
        source: "memory",
      });
    }

    try {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (!tablelandService) {
        return res
          .status(503)
          .json({ ok: false, error: "Tableland service unavailable." });
      }

      const normalizedProvider = provider.toLowerCase();
      const matrix =
        await tablelandService.listTierFeatureFlags(normalizedProvider);
      const nextFlags = { ...(matrix[tier] || {}) };
      nextFlags[flagKey] = enabled;
      await tablelandService.setTierFeatureFlags(
        normalizedProvider,
        tier,
        nextFlags,
      );

      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        tier,
        enabled,
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Failed to update provider feature flag.",
      });
    }
  },
);

app.delete(
  "/api/entitlements/provider/:provider/flags/:flagKey",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    const provider = String(req.params.provider || "").trim();
    const flagKey = String(req.params.flagKey || "")
      .trim()
      .toLowerCase();

    if (!isValidAddress(provider)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid provider address." });
    }
    if (!/^[a-z0-9_]+$/.test(flagKey)) {
      return res.status(400).json({
        ok: false,
        error: "flagKey must be lowercase alphanumeric with underscores.",
      });
    }
    if (!tablelandService) {
      const normalizedProvider = provider.toLowerCase();
      const matrix = getInMemoryMatrix(normalizedProvider);
      for (const tier of PROVIDER_TIERS) {
        delete matrix[tier][flagKey];
      }
      flagMetadataStore.get(normalizedProvider)?.delete(flagKey);
      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        deleted: true,
        source: "memory",
      });
    }

    try {
      if (tablelandReady) {
        await tablelandReady;
      }
      if (!tablelandService) {
        return res
          .status(503)
          .json({ ok: false, error: "Tableland service unavailable." });
      }

      const normalizedProvider = provider.toLowerCase();
      const matrix =
        await tablelandService.listTierFeatureFlags(normalizedProvider);

      for (const tier of PROVIDER_TIERS) {
        const nextFlags = { ...(matrix[tier] || {}) };
        delete nextFlags[flagKey];
        await tablelandService.setTierFeatureFlags(
          normalizedProvider,
          tier,
          nextFlags,
        );
      }

      return res.json({
        ok: true,
        provider: normalizedProvider,
        key: flagKey,
        deleted: true,
      });
    } catch (err: any) {
      return res.status(500).json({
        ok: false,
        error: err?.message || "Failed to delete provider feature flag.",
      });
    }
  },
);

app.post("/api/lit/decrypt", async (req, res) => {
  if (!litService) {
    return res.status(503).json({
      ok: false,
      error: "Lit service not configured.",
    });
  }

  const {
    walletAddress,
    ciphertext,
    dataToEncryptHash,
    minimumTier,
    authSig,
    sessionSigs,
  } = req.body || {};

  if (!isValidAddress(String(walletAddress || ""))) {
    return res.status(400).json({
      ok: false,
      error: "walletAddress must be a valid EVM address.",
    });
  }
  if (!ciphertext || !dataToEncryptHash) {
    return res.status(400).json({
      ok: false,
      error: "ciphertext and dataToEncryptHash are required.",
    });
  }

  try {
    if (litReady) {
      await litReady;
    }
    if (!litService) {
      return res
        .status(503)
        .json({ ok: false, error: "Lit service unavailable." });
    }

    const hasActive = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "hasActiveSubscription",
      args: [walletAddress.toLowerCase() as `0x${string}`],
    })) as boolean;
    if (!hasActive) {
      return res.status(403).json({
        ok: false,
        error: "Active subscription required.",
      });
    }

    const conditions =
      minimumTier && ["starter", "pro", "enterprise"].includes(minimumTier)
        ? litService.buildTierACC(minimumTier)
        : litService.buildSubscriptionACC(walletAddress);

    const content = await litService.decrypt(
      String(ciphertext),
      String(dataToEncryptHash),
      conditions,
      {
        authSig,
        sessionSigs,
      },
    );

    return res.json({
      ok: true,
      content,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Lit decryption failed.",
    });
  }
});

// ============================================================
//  Session Balance Endpoint
// ============================================================

app.get("/api/session/:agentAddress/balance", async (req, res) => {
  if (!isValidAddress(req.params.agentAddress)) {
    return res.status(400).json({ error: "Invalid agent address." });
  }
  if (!settlementService) {
    return res
      .status(400)
      .json({ error: "SessionVault balances are not available on this chain." });
  }
  try {
    const balance = await settlementService.getSessionBalance(
      req.params.agentAddress,
    );
    res.json({
      agentAddress: req.params.agentAddress,
      balance: balance.toString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/session/:agentAddress", async (req, res) => {
  const { agentAddress } = req.params;
  if (!isValidAddress(agentAddress)) {
    return res.status(400).json({ error: "Invalid agent address." });
  }
  if (!settlementService) {
    return res
      .status(400)
      .json({ error: "Session data is not available on this chain." });
  }

  const limitParam = Number(req.query.limit || 20);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(Math.trunc(limitParam), 100))
    : 20;

  try {
    const sessionIds = (await chainClient.readContract({
      address: CONTRACTS.sessionVault as `0x${string}`,
      abi: SessionVaultABI,
      functionName: "getAgentSessions",
      args: [agentAddress as `0x${string}`],
    })) as string[];

    const selectedIds = sessionIds.slice(-limit).reverse();
    const sessions = await Promise.all(
      selectedIds.map(async (sessionId) => {
        const rawSession = await settlementService.getSessionDetails(sessionId);
        const details = parseSessionTuple(rawSession);
        return {
          sessionId,
          agent: details.agent,
          token: details.token,
          balance: details.balance.toString(),
          totalFunded: details.totalFunded.toString(),
          totalSettled: details.totalSettled.toString(),
          active: details.active,
          createdAt: details.createdAt.toString(),
        };
      }),
    );

    return res.json({
      agentAddress: agentAddress.toLowerCase(),
      totalSessions: sessionIds.length,
      returned: sessions.length,
      sessions,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err?.message || "Failed to fetch sessions." });
  }
});

app.get("/api/session/details/:sessionId", async (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  if (!isBytes32(sessionId)) {
    return res
      .status(400)
      .json({ error: "sessionId must be a bytes32 hex value." });
  }
  if (!settlementService) {
    return res
      .status(400)
      .json({ error: "Session details are not available on this chain." });
  }

  try {
    const rawSession = await settlementService.getSessionDetails(sessionId);
    const details = parseSessionTuple(rawSession);

    return res.json({
      sessionId,
      agent: details.agent,
      token: details.token,
      balance: details.balance.toString(),
      totalFunded: details.totalFunded.toString(),
      totalSettled: details.totalSettled.toString(),
      active: details.active,
      createdAt: details.createdAt.toString(),
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err?.message || "Failed to fetch session details." });
  }
});

// ============================================================
//  Subscriber Email Capture Endpoint
// ============================================================

app.post("/api/subscriber/email", (req, res) => {
  const walletAddress = String(req.body?.walletAddress || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const planId =
    typeof req.body?.planId === "string"
      ? String(req.body.planId).trim()
      : undefined;

  if (!isValidAddressForChain(walletAddress, CHAIN_ID)) {
    return res.status(400).json({ ok: false, error: "Invalid walletAddress." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address." });
  }

  // Family-aware: EVM lowercases; Stellar/Solana keep their exact case.
  const normalizedWalletAddress =
    normalizeWalletForChain(walletAddress, CHAIN_ID) ?? walletAddress;

  subscriberEmailsByWallet.set(normalizedWalletAddress, {
    email,
    planId,
    updatedAt: Date.now(),
  });

  return res.status(201).json({
    ok: true,
    walletAddress: normalizedWalletAddress,
    email,
    planId: planId || null,
  });
});

app.post(
  "/api/billing/events",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    if (!DASHBOARD_URL) {
      return res
        .status(503)
        .json({ ok: false, error: "DASHBOARD_URL is not configured." });
    }

    const eventType = String(req.body?.eventType || "").trim();
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    const payload =
      req.body?.payload && typeof req.body.payload === "object"
        ? (req.body.payload as Record<string, unknown>)
        : {};
    const source = String(req.body?.source || "ops-replay");
    const triggerInvoice = Boolean(req.body?.triggerInvoice);
    const teamId = String(req.body?.teamId || "").trim();
    const eventName =
      typeof req.body?.eventName === "string" ? req.body.eventName : undefined;
    const schemaVersion =
      typeof req.body?.schemaVersion === "string"
        ? req.body.schemaVersion
        : undefined;
    const occurredAt =
      typeof req.body?.occurredAt === "string"
        ? req.body.occurredAt
        : undefined;

    const allowedEventTypes = new Set([
      "SUBSCRIPTION_MINTED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_CANCELLED",
      "PAYMENT_FAILED",
      "CREDIT_ISSUED",
    ]);

    if (!teamId) {
      return res.status(400).json({
        ok: false,
        error: "teamId is required.",
      });
    }
    if (!allowedEventTypes.has(eventType)) {
      return res.status(400).json({
        ok: false,
        error: "eventType is invalid.",
      });
    }
    if (!idempotencyKey) {
      return res.status(400).json({
        ok: false,
        error: "idempotencyKey is required.",
      });
    }

    await jobQueue.enqueue(
      "billing",
      "billing_event",
      {
        teamId,
        eventType,
        eventName,
        schemaVersion,
        occurredAt,
        idempotencyKey,
        payload,
        triggerInvoice,
        source,
      },
      { idempotencyKey: `billing:${CHAIN_ID}:${idempotencyKey}` },
    );

    return res.status(202).json({
      ok: true,
      queued: true,
      idempotencyKey,
      queue: "billing",
    });
  },
);

// ============================================================
//  Webhook Delivery Log Endpoint
// ============================================================

app.get("/api/webhooks/log", (_req, res) => {
  if (!webhookService) {
    return res.json({ configured: false, entries: [], log: [] });
  }
  const entries = webhookService.getDeliveryLog();
  res.json({
    configured: true,
    entries,
    // deprecated alias retained for compatibility with older dashboard clients
    log: entries,
  });
});

app.post("/api/webhooks/replay/:deliveryId", async (req, res) => {
  if (!webhookService) {
    return res.status(503).json({ error: "Webhooks not configured" });
  }
  const log = webhookService.getDeliveryLog(200);
  const entry = log.find((e) => e.id === req.params.deliveryId);
  if (!entry) {
    return res.status(404).json({ error: "Delivery not found" });
  }
  try {
    await webhookService.deliver(
      {
        event: entry.event,
        timestamp: Date.now(),
        data: { replayed: true, originalId: entry.id },
      },
      1,
    );
    return res.json({ success: true, message: `Replayed webhook ${entry.id}` });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Replay failed" });
  }
});

app.post("/api/webhooks/test", async (_req, res) => {
  if (!webhookService) {
    return res.status(503).json({ error: "Webhooks not configured" });
  }
  try {
    await webhookService.deliver(
      { event: "test.ping", timestamp: Date.now(), data: { test: true } },
      1,
    );
    return res.json({ success: true, message: "Test webhook sent" });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Test failed" });
  }
});

app.get("/api/email/templates", (_req, res) => {
  const templates = [
    {
      id: "welcome",
      name: "Welcome",
      description: "Sent when a subscriber mints their first subscription NFT",
    },
    {
      id: "renewal_receipt",
      name: "Renewal Receipt",
      description: "Sent after a successful subscription renewal",
    },
    {
      id: "payment_failed",
      name: "Payment Failed",
      description: "Sent when an autopay charge fails",
    },
    {
      id: "expiring_soon",
      name: "Expiring Soon",
      description: "Sent 3 days before subscription expiry",
    },
    {
      id: "access_revoked",
      name: "Access Revoked",
      description: "Sent when a subscription is cancelled",
    },
    {
      id: "low_balance",
      name: "Low Session Balance",
      description: "Sent when session vault balance drops below threshold",
    },
  ];
  res.json({
    configured: !!emailService,
    brandName: process.env.BRAND_NAME || "ArcenPay",
    templates,
  });
});

app.get("/api/invoices/status", (_req, res) => {
  res.json({
    dashboardBridgeConfigured: Boolean(DASHBOARD_URL),
    bridgeStats: billingBridgeStats,
    queueStats: {
      billing: jobQueue.getStats("billing"),
      webhooks: jobQueue.getStats("webhooks"),
    },
  });
});

// ============================================================
//  Operator — Durable Queue Management
//  Requires FACILITATOR_SECRET if configured.
// ============================================================

// GET  /api/ops/queue/:name/dead-letter    — list dead-letter jobs
// POST /api/ops/queue/:name/dead-letter/:jobId/replay — replay one job
// POST /api/ops/queue/:name/dead-letter/replay-all    — replay all dead-letter jobs

app.get(
  "/api/ops/queue/:name/dead-letter",
  requireFacilitatorSecretIfConfigured,
  (req, res) => {
    const name = String(req.params.name);
    const jobs = jobQueue.getDeadLetterJobs(name);
    res.json({ queue: name, count: jobs.length, jobs });
  },
);

app.post(
  "/api/ops/queue/:name/dead-letter/replay-all",
  requireFacilitatorSecretIfConfigured,
  (req, res) => {
    const name = String(req.params.name);
    const count = jobQueue.replayAllDeadLetter(name);
    res.json({ ok: true, queue: name, requeued: count });
  },
);

app.post(
  "/api/ops/queue/:name/dead-letter/:jobId/replay",
  requireFacilitatorSecretIfConfigured,
  (req, res) => {
    const name = String(req.params.name);
    const jobId = String(req.params.jobId);
    const replayed = jobQueue.replayDeadLetterJob(name, jobId);
    if (!replayed) {
      return res
        .status(404)
        .json({ error: "Job not found in dead-letter queue" });
    }
    res.json({
      ok: true,
      queue: name,
      jobId,
      message: "Job re-enqueued for retry",
    });
  },
);

// GET /api/ops/replay-protection/stats — x402 replay protection stats
app.get(
  "/api/ops/replay-protection/stats",
  requireFacilitatorSecretIfConfigured,
  (_req, res) => {
    res.json(replayProtection.getStats());
  },
);

// ============================================================
//  Proof Orchestrator Monitoring
// ============================================================

app.get("/api/proofs/active", (_req, res) => {
  const jobs = proofOrchestrator.getActiveJobs();
  res.json({
    count: jobs.length,
    jobs: jobs.map((j) => ({
      sessionId: j.sessionId,
      status: j.status,
      attempts: j.attempts,
      callCount: j.callCount,
      windowStart: j.windowStart,
      windowEnd: j.windowEnd,
      nullifier: j.nullifier,
      error: j.error,
      createdAt: j.createdAt,
      lastAttemptAt: j.lastAttemptAt,
    })),
  });
});

app.get("/api/proofs/history", (req, res) => {
  const limitParam = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(Math.trunc(limitParam), 200))
    : 50;
  const jobs = proofOrchestrator.getJobHistory(limit);
  res.json({
    count: jobs.length,
    jobs: jobs.map((j) => ({
      sessionId: j.sessionId,
      status: j.status,
      attempts: j.attempts,
      callCount: j.callCount,
      windowStart: j.windowStart,
      windowEnd: j.windowEnd,
      nullifier: j.nullifier,
      settlementAmount: j.settlementAmount,
      txHash: j.txHash,
      error: j.error,
      createdAt: j.createdAt,
      lastAttemptAt: j.lastAttemptAt,
    })),
  });
});

// ============================================================
//  Paymaster Relay — Gas Sponsorship Evaluation
// ============================================================

interface PaymasterEvalRequest {
  teamId: string;
  chainId: number;
  walletAddress: string;
  txType: string;
  to?: string;
  data?: string;
  value?: string;
  userOperation?: Record<string, unknown>;
  entryPoint?: string;
  sponsorContext?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHexValue(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  if (!/^0x[a-fA-F0-9]*$/.test(value)) return null;
  return value as Hex;
}

function parseBigIntValue(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && value.length > 0) {
    if (/^0x[a-fA-F0-9]+$/.test(value) || /^[0-9]+$/.test(value)) {
      try {
        const parsed = BigInt(value);
        return parsed >= 0n ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractPaymasterAndData(result: unknown): Hex | null {
  const directHex = parseHexValue(result);
  if (directHex && directHex.length >= 2) return directHex;

  if (!isRecord(result)) return null;

  const directField = parseHexValue(result.paymasterAndData);
  if (directField && directField.length >= 2) return directField;

  const paymasterAddress =
    typeof result.paymaster === "string" && isHexAddress(result.paymaster)
      ? (result.paymaster as `0x${string}`)
      : null;
  const paymasterData = parseHexValue(result.paymasterData ?? "0x");
  const verificationGasLimit = parseBigIntValue(
    result.paymasterVerificationGasLimit ?? result.verificationGasLimit,
  );
  const postOpGasLimit = parseBigIntValue(
    result.paymasterPostOpGasLimit ?? result.postOpGasLimit,
  );

  if (
    paymasterAddress &&
    paymasterData &&
    verificationGasLimit !== null &&
    postOpGasLimit !== null
  ) {
    return encodePacked(
      ["address", "uint128", "uint128", "bytes"],
      [paymasterAddress, verificationGasLimit, postOpGasLimit, paymasterData],
    ) as Hex;
  }

  return null;
}

function extractJsonRpcError(payload: unknown): string {
  if (!isRecord(payload)) return "Invalid JSON-RPC response";
  const err = payload.error;
  if (!isRecord(err)) return "Unknown paymaster RPC error";
  const message =
    typeof err.message === "string"
      ? err.message
      : "Unknown paymaster RPC error";
  const code = typeof err.code === "number" ? ` (${err.code})` : "";
  return `${message}${code}`;
}

async function sponsorUserOperationViaPaymaster(input: {
  chainId: number;
  userOperation: Record<string, unknown>;
  entryPoint: `0x${string}`;
  sponsorContext?: Record<string, unknown>;
}): Promise<{ paymasterAndData: Hex; rawResult: unknown }> {
  const paymasterRpcUrl = getPaymasterRpcUrl(input.chainId);
  if (!paymasterRpcUrl) {
    throw new Error(
      `Paymaster RPC is not configured for chain ${input.chainId}.`,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (PAYMASTER_RPC_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${PAYMASTER_RPC_AUTH_TOKEN}`;
  }

  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: PAYMASTER_RPC_METHOD,
    params: [
      input.userOperation,
      input.entryPoint,
      {
        chainId: input.chainId,
        ...(input.sponsorContext ?? {}),
      },
    ],
  };

  const rpcRes = await fetch(paymasterRpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const json = (await rpcRes.json().catch(() => ({}))) as unknown;

  if (!rpcRes.ok) {
    const rpcMessage = extractJsonRpcError(json);
    throw new Error(`HTTP ${rpcRes.status}: ${rpcMessage}`);
  }

  if (isRecord(json) && json.error) {
    throw new Error(extractJsonRpcError(json));
  }

  const result = isRecord(json) ? json.result : undefined;
  const paymasterAndData = extractPaymasterAndData(result);
  if (!paymasterAndData) {
    throw new Error(
      "Paymaster RPC did not return paymasterAndData (or equivalent split fields).",
    );
  }

  return { paymasterAndData, rawResult: result };
}

app.post(
  "/api/paymaster/evaluate",
  requireFacilitatorSecretIfConfigured,
  async (req, res) => {
    const body = req.body as PaymasterEvalRequest;

    if (!body.teamId || !body.chainId || !body.walletAddress || !body.txType) {
      res.status(400).json({
        sponsored: false,
        reason:
          "Missing required fields: teamId, chainId, walletAddress, txType",
      });
      return;
    }

    if (!body.userOperation || !isRecord(body.userOperation)) {
      res.status(400).json({
        sponsored: false,
        reason: "Missing required field: userOperation",
      });
      return;
    }

    if (
      PAYMASTER_CHAIN_IDS.size === 0 ||
      !PAYMASTER_CHAIN_IDS.has(body.chainId)
    ) {
      const allowed = [...PAYMASTER_CHAIN_IDS].join(", ") || "none";
      res.status(200).json({
        sponsored: false,
        reason: `Chain ${body.chainId} is not eligible for paymaster sponsorship (allowed: ${allowed}).`,
      });
      return;
    }

    // Only specific tx types can be sponsored
    const sponsoredTxTypes = new Set(["subscribe", "renew", "deposit"]);
    if (!sponsoredTxTypes.has(body.txType)) {
      res.status(200).json({
        sponsored: false,
        reason: `Transaction type "${body.txType}" is not eligible for sponsorship`,
      });
      return;
    }

    const paymasterRpcUrl = getPaymasterRpcUrl(body.chainId);
    if (!paymasterRpcUrl) {
      res.status(200).json({
        sponsored: false,
        reason: `Paymaster RPC is not configured for chain ${body.chainId}.`,
      });
      return;
    }

    // Check gas budget with platform API
    if (!INTERNAL_API_BASE_URL) {
      res.status(200).json({
        sponsored: false,
        reason:
          "Gas budget service not configured (BACKEND_URL/DASHBOARD_URL missing)",
      });
      return;
    }

    try {
      const budgetRes = await fetch(
        `${buildInternalApiUrl(
          INTERNAL_API_BASE_URL,
          "/api/v1/platform/gas-budget",
        )}?teamId=${encodeURIComponent(body.teamId)}`,
        {
          headers: FACILITATOR_SECRET
            ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
            : {},
        },
      );

      if (!budgetRes.ok) {
        res.status(200).json({
          sponsored: false,
          reason: `Budget check failed: HTTP ${budgetRes.status}`,
        });
        return;
      }

      const budgetData = (await budgetRes.json()) as {
        budget?: { remainingUsd?: number; budgetExhausted?: boolean };
      };

      if (
        budgetData.budget?.budgetExhausted ||
        (budgetData.budget?.remainingUsd ?? 0) <= 0
      ) {
        res.status(200).json({
          sponsored: false,
          reason: "Daily gas budget exhausted",
          remainingUsd: budgetData.budget?.remainingUsd ?? 0,
        });
        return;
      }

      const entryPoint =
        typeof body.entryPoint === "string" && isHexAddress(body.entryPoint)
          ? (body.entryPoint as `0x${string}`)
          : (PAYMASTER_DEFAULT_ENTRYPOINT as `0x${string}`);

      let sponsorship: { paymasterAndData: Hex; rawResult: unknown };
      try {
        sponsorship = await sponsorUserOperationViaPaymaster({
          chainId: body.chainId,
          userOperation: body.userOperation,
          entryPoint,
          sponsorContext: body.sponsorContext,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[Facilitator] Paymaster RPC error:", err);
        res.status(200).json({
          sponsored: false,
          reason: `Paymaster sponsorship failed: ${message}`,
        });
        return;
      }

      const quoteId = `sponsor_${Date.now().toString(36)}_${randomUUID()}`;

      res.status(200).json({
        sponsored: true,
        chainId: body.chainId,
        walletAddress: body.walletAddress,
        txType: body.txType,
        entryPoint,
        remainingBudgetUsd: budgetData.budget?.remainingUsd,
        paymasterAndData: sponsorship.paymasterAndData,
        sponsorResult: sponsorship.rawResult,
        quoteId,
        message: "Gas sponsorship approved via paymaster RPC.",
      });

      if (PAYMASTER_RECORD_ESTIMATED_SPEND) {
        void postToDashboard("/api/v1/platform/gas-spend", {
          teamId: body.teamId,
          chainId: body.chainId,
          txHash: quoteId,
          gasUsed: PAYMASTER_ESTIMATED_GAS_USED,
          gasCostUsd: PAYMASTER_ESTIMATED_GAS_COST_USD,
          walletAddress: body.walletAddress,
          txType: body.txType,
        }).catch(() => {
          // Non-fatal
        });
      }
    } catch (err) {
      console.error("[Facilitator] Paymaster evaluate error:", err);
      res.status(500).json({
        sponsored: false,
        reason: "Internal error during gas budget evaluation",
      });
    }
  },
);

// ============================================================
//  Agent Dispatch Routes
// ============================================================

// Telegram webhook — receives Approve/Deny callbacks
app.post("/api/telegram/webhook", (req, res) => {
  void handleTelegramWebhook(req, res);
});

// Agent SDK polls this to check if a dispatch was approved
app.get("/api/agent/dispatch/:requestId", (req, res) => {
  const approval = getPendingApproval(req.params.requestId);
  if (!approval) {
    res.json({ status: "not_found" });
    return;
  }
  res.json({
    status: approval.status,
    agentAddress: approval.agentAddress,
    amount: approval.amount,
    resolvedAt: approval.resolvedAt,
  });
});

// ============================================================
//  Start Server
// ============================================================

function logStartupBanner() {
  const statusLine = (
    label: string,
    active: boolean,
    activeLabel = "Active",
    inactiveLabel = "Off (set env var)",
  ) => {
    const status = active ? `✅  ${activeLabel}` : `⚠️  ${inactiveLabel}`;
    return `║   ${label}: ${status.padEnd(37 - label.length)}║`;
  };

  // One process serves ONE chain, but a deployment usually runs several (see
  // FACILITATOR_CHAINS / `npm run dev:facilitators`). List them all so a single
  // process's log is not misread as "only this chain is supported", and mark the
  // chain this process actually owns with `*`.
  const deploymentChainIds = (process.env.FACILITATOR_CHAINS || "")
    .split(",")
    .map((entry) => Number(entry.split(":")[0].trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  const chainsLabel = (deploymentChainIds.length > 0
    ? deploymentChainIds
    : [CHAIN_ID]
  )
    .map((id) => (id === CHAIN_ID ? `${id}*` : String(id)))
    .join(", ");

  console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   🚀  ArcenPay Facilitator v0.1.0               ║
║   📡  Port: ${String(PORT).padEnd(37)}║
║   🔗  Chain: ${String(CHAIN_ID).padEnd(36)}║
║   🧭  Chains: ${chainsLabel.slice(0, 37).padEnd(37)}║
║   💰  x402 Protocol: Active                     ║
║   📣  Events: ${(eventListenerActive ? "✅  Watching" : "❌  Failed — check RPC_URL").padEnd(35)}║
${statusLine("Webhooks", true, "Dashboard", "Dashboard")}
${statusLine("Email   ", !!emailService, "Active", "Off — set RESEND_API_KEY")}
║   ⛓️  Settlement: ${(settlementWriter ? "✅  On-chain" : "⚠️  Verify-only").padEnd(31)}║
${statusLine("Redis   ", !!redisUsageStore, "Active", "Off — set REDIS_URL")}
║   🔬  Proof Mode: ${PROOF_MODE.padEnd(35)}║
║   🧪  Proof Orchestrator: Active                ║
║                                                  ║
╚══════════════════════════════════════════════════╝

   * the chain this process serves (one process per chain).
     Chains: ${deploymentChainIds.length > 0 ? deploymentChainIds.join(", ") : CHAIN_ID}. Run all with: npm run dev:facilitators
     Settlement keys are per chain: SETTLEMENT_PRIVATE_KEY_<chainId> → SETTLEMENT_PRIVATE_KEY → PRIVATE_KEY
  `);
}

void (async () => {
  try {
    if (redisReady) {
      await redisReady;
    }
    await queueRedisReady;

    // Start event listener before printing the banner so status is accurate.
    // Which listener runs depends on the runtime chain family: EVM chains use
    // the viem EventListenerService; Stellar/Solana chains use their family
    // ChainAdapter. Never point the viem listener at a non-EVM RPC — it would
    // poll an incompatible endpoint and fail forever.
    try {
      if (chainFamily === "stellar") {
        await primaryChainAdapter.startEventListener(12000);
        eventListenerActive = true;
        console.log(
          `[Facilitator] StellarChainAdapter started — watching Soroban events for chain ${CHAIN_ID}`,
        );
      } else if (chainFamily === "solana") {
        await primaryChainAdapter.startEventListener(12000);
        eventListenerActive = true;
        console.log(
          `[Facilitator] SolanaChainAdapter started — watching Solana events for chain ${CHAIN_ID}`,
        );
      } else {
        await eventListener!.start(12000);
        eventListenerActive = true;
        console.log(
          "[Facilitator] EventListener started — watching on-chain events",
        );
      }
    } catch (err) {
      eventListenerActive = false;
      console.error("[Facilitator] EventListener failed to start:", err);
    }

    // Start agent balance monitor for dispatch notifications
    let balanceMonitorActive = false;
    try {
      balanceMonitor.start();
      balanceMonitorActive = true;
      console.log("[Facilitator] BalanceMonitor started");
    } catch (err) {
      console.error("[Facilitator] BalanceMonitor failed to start:", err);
    }

    app.listen(Number(PORT), "0.0.0.0", () => {
      logStartupBanner();
    });
  } catch (err) {
    console.error("[Facilitator] Startup failed:", err);
    process.exit(1);
  }
})();

// Graceful shutdown
function stopEventListener() {
  if (chainFamily === "stellar" || chainFamily === "solana") {
    primaryChainAdapter.stopEventListener();
  } else {
    eventListener?.stop();
  }
}

process.on("SIGTERM", () => {
  console.log("[Facilitator] Shutting down after SIGTERM...");
  stopEventListener();
  stellarRenewalDriver?.stop();
  solanaRenewalDriver?.stop();
  settlementService?.stop();
  proofOrchestrator.stop();
  billingKeeper?.stop();
  webhookService?.stop();
  void redisUsageStore?.stop();
  jobQueue.stop();
  replayProtection.stop();
  balanceMonitor.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[Facilitator] Shutting down after SIGINT...");
  stopEventListener();
  stellarRenewalDriver?.stop();
  solanaRenewalDriver?.stop();
  settlementService?.stop();
  proofOrchestrator.stop();
  billingKeeper?.stop();
  webhookService?.stop();
  void redisUsageStore?.stop();
  jobQueue.stop();
  replayProtection.stop();
  balanceMonitor.stop();
  process.exit(0);
});

// HARDEN: Catch unhandled rejections and exceptions to prevent silent process crashes.
// Report to Sentry if configured, then exit so the process manager restarts.
process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    console.error("[Facilitator] UNHANDLED REJECTION — exiting:", reason);
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
      // Allow Sentry to flush before exit (up to 2s)
      void Sentry.close(2000).finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  },
);

process.on("uncaughtException", (error: Error) => {
  console.error("[Facilitator] UNCAUGHT EXCEPTION — exiting:", error);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
    void Sentry.close(2000).finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

export default app;
