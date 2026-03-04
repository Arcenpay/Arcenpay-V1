// ============================================================
//  MEAP Facilitator Node — Entry Point
//  Validates x402 payments, watches on-chain events,
//  and delivers notifications to providers
// ============================================================

// ── Sentry must be initialized FIRST, before all other imports ──
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import {
  x402Middleware,
  AggregatorService,
  SettlementService,
  SettlementWriterService,
  RedisUsageStore,
  EventListenerService,
  WebhookService,
  EmailService,
  TablelandService,
  LitProtocolService,
  ProofOrchestrator,
  BillingKeeper,
} from "@meap/node";
import {
  PlanFactoryABI,
  SessionVaultABI,
  SubscriptionRegistryABI,
  getContractAddresses,
  type PlanTier,
  type X402VerifiedPaymentContext,
} from "@meap/core";
import { createPublicClient, http } from "viem";

const app = express();
const PORT = process.env.PORT || 3402;
const RPC_URL =
  process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "11155111");
const CONTRACTS = getContractAddresses(CHAIN_ID);
const chainClient = createPublicClient({
  transport: http(RPC_URL),
});
const FACILITATOR_PROFILE = (
  process.env.FACILITATOR_PROFILE || "development"
).toLowerCase();
const PROOF_MODE =
  (process.env.PROOF_MODE ||
    (FACILITATOR_PROFILE === "production" ? "strict" : "dev")) === "strict"
    ? "strict"
    : "dev";
const PROOF_BUILD_DIR =
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
const PROOF_SIGNER_PRIVATE_KEY =
  process.env.PROOF_SIGNER_PRIVATE_KEY || process.env.PRIVATE_KEY;

function isHexAddress(value: string | undefined | null): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function validateRuntimeConfig(): void {
  const errors: string[] = [];
  const verifierAddress = CONTRACTS.zkUsageVerifier;

  const verifierInvalid =
    !isHexAddress(verifierAddress) ||
    verifierAddress === "0x0000000000000000000000000000000000000000";
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
    if (PROOF_MODE !== "strict") {
      errors.push("PROOF_MODE must be 'strict' when FACILITATOR_PROFILE=production.");
    }

    if (!PROOF_SIGNER_PRIVATE_KEY) {
      errors.push(
        "PROOF_SIGNER_PRIVATE_KEY (or PRIVATE_KEY) is required in production for proof submission.",
      );
    }

    for (const artifactPath of [PROOF_WASM_PATH, PROOF_ZKEY_PATH, PROOF_VKEY_PATH]) {
      if (!fs.existsSync(artifactPath)) {
        errors.push(`Missing proof artifact: ${artifactPath}`);
      }
    }

    if (process.env.REDIS_REQUIRED === "true" && !process.env.REDIS_URL) {
      errors.push("REDIS_URL is required when REDIS_REQUIRED=true.");
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

// ============================================================
//  Rate Limiting (PRD §11.2)
// ============================================================

type InMemoryRateLimitOptions = {
  windowMs: number;
  max: number;
  message: Record<string, string>;
};

function inMemoryRateLimit({
  windowMs,
  max,
  message,
}: InMemoryRateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const now = Date.now();
    const key =
      req.ip ||
      String(req.headers["x-forwarded-for"] || "") ||
      req.socket.remoteAddress ||
      "unknown";

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

const apiLimiter = inMemoryRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 req/min per IP
  message: { error: "Too many requests, please try again later." },
});

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
    return /^0x[a-fA-F0-9]{40}$/.test(from) ? from.toLowerCase() : null;
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
//  Global Middleware
// ============================================================

const corsOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.includes("*") ? "*" : corsOrigins,
  }),
);
app.use(express.json({ limit: "50kb" })); // 50KB body limit (PRD §11.2)
app.use("/api", apiLimiter);

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
});
const usageService = proofOrchestrator.getUsageService();

const settlementService = new SettlementService({
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
});

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error("PRIVATE_KEY must be a valid 32-byte hex string.");
  }
  return hex as `0x${string}`;
}

const enableOnchainSettlement =
  process.env.X402_ENABLE_SETTLEMENT === "true" ||
  Boolean(process.env.PRIVATE_KEY);

let settlementWriter: SettlementWriterService | null = null;
if (enableOnchainSettlement) {
  const privateKeyRaw = process.env.PRIVATE_KEY;
  if (!privateKeyRaw) {
    console.warn(
      "[Facilitator] On-chain settlement requested but PRIVATE_KEY is not set.",
    );
  } else {
    try {
      settlementWriter = new SettlementWriterService({
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
        privateKey: normalizePrivateKey(privateKeyRaw),
        providerAddress: process.env.X402_PROVIDER_ADDRESS as
          | `0x${string}`
          | undefined,
        sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS as
          | `0x${string}`
          | undefined,
        waitForReceipt: process.env.X402_WAIT_FOR_RECEIPT !== "false",
      });
      console.log("[Facilitator] x402 on-chain settlement writer active");
    } catch (err) {
      console.error(
        "[Facilitator] Failed to initialize settlement writer:",
        err,
      );
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
}

let redisUsageStore: RedisUsageStore | null = null;
let redisReady: Promise<void> | null = null;
if (process.env.REDIS_URL) {
  redisUsageStore = new RedisUsageStore({
    url: process.env.REDIS_URL,
    keyPrefix: process.env.REDIS_PREFIX || "meap",
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

const eventListener = new EventListenerService({
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
});

// Optional: Webhook service (if webhook URL is configured)
let webhookService: WebhookService | null = null;
if (process.env.WEBHOOK_URL && process.env.WEBHOOK_SIGNING_SECRET) {
  webhookService = new WebhookService({
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SIGNING_SECRET,
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

const subscriberEmailsByWallet = new Map<
  string,
  { email: string; planId?: string; updatedAt: number }
>();

// Optional: Lit Protocol service
let litService: LitProtocolService | null = null;
let litReady: Promise<void> | null = null;
if (process.env.LIT_NETWORK) {
  litService = new LitProtocolService({
    network: process.env.LIT_NETWORK === "habanero" ? "habanero" : "manzano",
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
      console.log("[Facilitator] Lit service active");
    })
    .catch((err) => {
      console.error("[Facilitator] Lit init failed:", err);
      litService = null;
    });
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
    planTier: planFeatures[1],
    expiresAt,
    billingInterval: Number(plan.billingInterval),
  };
}

function isValidAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
      matrix.enterprise?.[key] ?? matrix.pro?.[key] ?? matrix.starter?.[key] ?? false;
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
eventListener.on("*", async (event) => {
  console.log(`[Facilitator] Event: ${event.type} tokenId=${event.tokenId}`);

  // Forward to webhook if configured
  if (webhookService) {
    await webhookService.deliverEvent(event);
  }
});

// Specific handlers for each event type
eventListener.on("minted", async (event) => {
  console.log(
    `[Facilitator] 🎉 New subscriber: ${event.subscriber} (Plan ${event.planId})`,
  );
  let snapshotForEmail: Awaited<ReturnType<typeof getSubscriptionSnapshot>> | null =
    null;
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
    const subscriberEmail =
      subscriberEmailsByWallet.get(event.subscriber.toLowerCase())?.email;
    if (!subscriberEmail) {
      return;
    }
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
            ? new Date(Number(snapshotForEmail.expiresAt) * 1000).toISOString()
            : "",
        },
      );
    } catch (err) {
      console.error("[Facilitator] Welcome email failed:", err);
    }
  }
});

eventListener.on("renewed", async (event) => {
  console.log(
    `[Facilitator] 🔄 Renewed: tokenId=${event.tokenId} until ${event.expiration}`,
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

eventListener.on("cancelled", async (event) => {
  console.log(`[Facilitator] ❌ Cancelled: tokenId=${event.tokenId}`);
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
});

// Watch for settlement events
settlementService.watchSettlements((settlement) => {
  console.log(
    `[Facilitator] 💰 Settlement: ${settlement.sessionId} — ${settlement.settlementAmount} (${settlement.callCount} calls)`,
  );
});

// Start event listener
eventListener.start(12000).catch(console.error);

// Start proof orchestrator auto-submission
proofOrchestrator.startAutoSubmit();
console.log("[Facilitator] ProofOrchestrator auto-submit active");

// Optional: Billing Keeper (if private key is configured and explicitly enabled)
let billingKeeper: BillingKeeper | null = null;
if (
  process.env.ENABLE_BILLING_KEEPER === "true" &&
  process.env.PRIVATE_KEY
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
    });

    billingKeeper.start();
    console.log("[Facilitator] BillingKeeper active");
  } catch (err) {
    console.error("[Facilitator] BillingKeeper init failed:", err);
    billingKeeper = null;
  }
}

// ============================================================
//  Health Check
// ============================================================

app.get("/metrics", async (_req, res) => {
  aggregatorQueueDepth.set(aggregatorService.getStats().pendingSettlements);
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
    service: "meap-facilitator",
    version: "0.1.0",
    profile: FACILITATOR_PROFILE,
    chainId: CHAIN_ID,
    blockNumber,
    timestamp: new Date().toISOString(),
    services: {
      eventListener: "active",
      webhook: webhookService ? "active" : "not configured",
      email: emailService ? "active" : "not configured",
      tableland: tablelandService ? "active" : "not configured",
      lit: litService ? "active" : "not configured",
      settlementWriter: settlementWriter ? "active" : "not configured",
      aggregator: "active",
      redis: redisUsageStore ? "active" : "not configured",
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
    proofRuntime: usageService.getProofRuntimeConfig(),
  });
});

// ============================================================
//  Protocol Info
// ============================================================

app.get("/info", (_req, res) => {
  res.json({
    protocol: "MEAP + ZKVUB",
    version: "0.1.0",
    x402Version: "1",
    supportedNetworks: ["base-sepolia", "base-mainnet"],
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
          res.getHeader("x-meap-rejection-reason") || "unknown",
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
  x402WalletLimiter,
  x402Middleware({
    planId: "demo",
    ratePerCall: "0.001",
    network: "base-sepolia",
    failOpenOnBalanceCheck: process.env.X402_FAIL_OPEN_BALANCE_CHECK === "true",
    ...(settlementWriter
      ? {
        settlePayment: async ({
          signer,
          amount,
          sessionId,
        }: {
          signer: `0x${string}`;
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
              providerAddress: process.env.X402_PROVIDER_ADDRESS as
                | `0x${string}`
                | undefined,
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
      meapPayment?: X402VerifiedPaymentContext;
    }
  ).meapPayment;
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
      insights: [
        { metric: "active_users", value: 15234, change: "+12.5%" },
        { metric: "revenue_mrr", value: 45000, change: "+8.3%" },
        { metric: "churn_rate", value: 2.1, change: "-0.4%" },
      ],
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
        const matrix = await tablelandService.listTierFeatureFlags(normalizedProvider);
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

    const fallbackMatrix = {
      starter: getDefaultFlagsForTier("starter"),
      pro: getDefaultFlagsForTier("pro"),
      enterprise: getDefaultFlagsForTier("enterprise"),
    } satisfies Record<ProviderTier, Record<string, boolean | string | number>>;

    return res.json({
      ok: true,
      source: "default",
      storageReady: false,
      provider: normalizedProvider,
      planTiers: [...PROVIDER_TIERS],
      flags: buildProviderFlagCatalog(fallbackMatrix),
      matrix: fallbackMatrix,
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to resolve provider flags.",
    });
  }
});

app.post("/api/entitlements/provider/:provider/flags/bootstrap", async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  if (!isValidAddress(provider)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid provider address.",
    });
  }

  if (!tablelandService) {
    return res.status(503).json({
      ok: false,
      error:
        "Tableland service not configured. Set TABLELAND_TABLE_NAME + TABLELAND_PRIVATE_KEY.",
    });
  }

  try {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (!tablelandService) {
      return res.status(503).json({ ok: false, error: "Tableland service unavailable." });
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
});

app.put("/api/entitlements/provider/:provider/flags/:flagKey", async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  const flagKey = String(req.params.flagKey || "").trim().toLowerCase();
  if (!isValidAddress(provider)) {
    return res.status(400).json({ ok: false, error: "Invalid provider address." });
  }
  if (!/^[a-z0-9_]+$/.test(flagKey)) {
    return res.status(400).json({
      ok: false,
      error: "flagKey must be lowercase alphanumeric with underscores.",
    });
  }
  if (!tablelandService) {
    return res.status(503).json({
      ok: false,
      error:
        "Tableland service not configured. Set TABLELAND_TABLE_NAME + TABLELAND_PRIVATE_KEY.",
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

  try {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (!tablelandService) {
      return res.status(503).json({ ok: false, error: "Tableland service unavailable." });
    }

    const normalizedProvider = provider.toLowerCase();
    const matrix = await tablelandService.listTierFeatureFlags(normalizedProvider);

    for (const tier of PROVIDER_TIERS) {
      const nextFlags = { ...(matrix[tier] || {}) };
      nextFlags[flagKey] = enabledTiers.has(tier);
      await tablelandService.setTierFeatureFlags(normalizedProvider, tier, nextFlags);
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
});

app.patch("/api/entitlements/provider/:provider/flags/:flagKey", async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  const flagKey = String(req.params.flagKey || "").trim().toLowerCase();
  const tier = normalizeProviderTier(String(req.body?.tier || "starter"));
  const enabled = Boolean(req.body?.enabled);

  if (!isValidAddress(provider)) {
    return res.status(400).json({ ok: false, error: "Invalid provider address." });
  }
  if (!/^[a-z0-9_]+$/.test(flagKey)) {
    return res.status(400).json({
      ok: false,
      error: "flagKey must be lowercase alphanumeric with underscores.",
    });
  }
  if (!tablelandService) {
    return res.status(503).json({
      ok: false,
      error:
        "Tableland service not configured. Set TABLELAND_TABLE_NAME + TABLELAND_PRIVATE_KEY.",
    });
  }

  try {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (!tablelandService) {
      return res.status(503).json({ ok: false, error: "Tableland service unavailable." });
    }

    const normalizedProvider = provider.toLowerCase();
    const matrix = await tablelandService.listTierFeatureFlags(normalizedProvider);
    const nextFlags = { ...(matrix[tier] || {}) };
    nextFlags[flagKey] = enabled;
    await tablelandService.setTierFeatureFlags(normalizedProvider, tier, nextFlags);

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
});

app.delete("/api/entitlements/provider/:provider/flags/:flagKey", async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  const flagKey = String(req.params.flagKey || "").trim().toLowerCase();

  if (!isValidAddress(provider)) {
    return res.status(400).json({ ok: false, error: "Invalid provider address." });
  }
  if (!/^[a-z0-9_]+$/.test(flagKey)) {
    return res.status(400).json({
      ok: false,
      error: "flagKey must be lowercase alphanumeric with underscores.",
    });
  }
  if (!tablelandService) {
    return res.status(503).json({
      ok: false,
      error:
        "Tableland service not configured. Set TABLELAND_TABLE_NAME + TABLELAND_PRIVATE_KEY.",
    });
  }

  try {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (!tablelandService) {
      return res.status(503).json({ ok: false, error: "Tableland service unavailable." });
    }

    const normalizedProvider = provider.toLowerCase();
    const matrix = await tablelandService.listTierFeatureFlags(normalizedProvider);

    for (const tier of PROVIDER_TIERS) {
      const nextFlags = { ...(matrix[tier] || {}) };
      delete nextFlags[flagKey];
      await tablelandService.setTierFeatureFlags(normalizedProvider, tier, nextFlags);
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
});

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
      return res.status(503).json({ ok: false, error: "Lit service unavailable." });
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
  const email = String(req.body?.email || "").trim().toLowerCase();
  const planId =
    typeof req.body?.planId === "string" ? String(req.body.planId).trim() : undefined;

  if (!isValidAddress(walletAddress)) {
    return res.status(400).json({ ok: false, error: "Invalid walletAddress." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address." });
  }

  subscriberEmailsByWallet.set(walletAddress.toLowerCase(), {
    email,
    planId,
    updatedAt: Date.now(),
  });

  return res.status(201).json({
    ok: true,
    walletAddress: walletAddress.toLowerCase(),
    email,
    planId: planId || null,
  });
});

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
    brandName: process.env.BRAND_NAME || "MEAP",
    templates,
  });
});

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
//  Start Server
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   🚀  MEAP Facilitator Node v0.1.0          ║
║   📡  Port: ${String(PORT).padEnd(33)}║
║   🔗  Chain: ${String(CHAIN_ID).padEnd(32)}║
║   💰  x402 Protocol: Active                 ║
║   📣  Events: Watching                      ║
║   🔔  Webhooks: ${(webhookService ? "Active" : "Off").padEnd(28)}║
║   ✉️   Email: ${(emailService ? "Active" : "Off").padEnd(30)}║
║   ⛓️   Settlement: ${(settlementWriter ? "On-chain" : "Verify-only").padEnd(25)}║
║   🧠  Redis Logs: ${(redisUsageStore ? "Active" : "Off").padEnd(27)}║
║   🔬  Proof Mode: ${PROOF_MODE.padEnd(31)}║
║   🧪  Proof Orchestrator: Active            ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Facilitator] Shutting down...");
  eventListener.stop();
  settlementService.stop();
  proofOrchestrator.stop();
  billingKeeper?.stop();
  webhookService?.stop();
  void redisUsageStore?.stop();
  process.exit(0);
});

export default app;
