// ============================================================
//  MEAP Facilitator Node — Entry Point
//  Validates x402 payments, watches on-chain events,
//  and delivers notifications to providers
// ============================================================

import express from 'express';
import cors from 'cors';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import {
  x402Middleware,
  UsageService,
  AggregatorService,
  SettlementService,
  SettlementWriterService,
  RedisUsageStore,
  EventListenerService,
  WebhookService,
  EmailService,
  TablelandService,
  LitProtocolService,
} from '@meap/node';
import {
  PlanFactoryABI,
  SessionVaultABI,
  SubscriptionRegistryABI,
  getContractAddresses,
  type PlanTier,
  type X402VerifiedPaymentContext,
} from '@meap/core';
import { createPublicClient, http } from 'viem';

const app = express();
const PORT = process.env.PORT || 3402;
const RPC_URL = process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111');
const CONTRACTS = getContractAddresses(CHAIN_ID);
const chainClient = createPublicClient({
  transport: http(RPC_URL),
});

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'facilitator_' });

const x402RequestsTotal = new Counter({
  name: 'x402_requests_total',
  help: 'Total x402-gated requests handled by facilitator',
  labelNames: ['endpoint', 'method', 'status'],
  registers: [metricsRegistry],
});

const x402ValidationErrorsTotal = new Counter({
  name: 'x402_validation_errors_total',
  help: 'Total x402 validation failures by rejection reason',
  labelNames: ['reason'],
  registers: [metricsRegistry],
});

const onChainSubmissionsLatencySeconds = new Histogram({
  name: 'on_chain_submissions_latency_seconds',
  help: 'Latency of on-chain settlement submissions (seconds)',
  labelNames: ['outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

const aggregatorQueueDepth = new Gauge({
  name: 'aggregator_queue_depth',
  help: 'Number of sessions currently pending settlement threshold',
  registers: [metricsRegistry],
});

const proofGenerationDurationSeconds = new Histogram({
  name: 'proof_generation_duration_seconds',
  help: 'Duration of proof input generation pipeline (seconds)',
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

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key =
      req.ip ||
      String(req.headers['x-forwarded-for'] || '') ||
      req.socket.remoteAddress ||
      'unknown';

    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
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
  message: { error: 'Too many requests, please try again later.' },
});

function extractWalletFromXPaymentHeader(
  headerValue: string | string[] | undefined,
): string | null {
  if (!headerValue || Array.isArray(headerValue)) return null;

  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { payload?: unknown };
    const payload =
      typeof parsed.payload === 'string' ? JSON.parse(parsed.payload) : parsed.payload;
    const from = (payload as { from?: unknown })?.from;
    if (typeof from !== 'string') return null;
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

function walletRateLimit({
  windowMs,
  max,
  message,
}: WalletRateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const wallet = extractWalletFromXPaymentHeader(req.headers['x-payment']);
    const key = wallet || req.ip || req.socket.remoteAddress || 'unknown';

    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
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
  message: { error: 'Too many x402 requests for this wallet. Try again shortly.' },
});

// ============================================================
//  Global Middleware
// ============================================================

const corsOrigins = (process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins.includes('*') ? '*' : corsOrigins,
}));
app.use(express.json({ limit: '50kb' })); // 50KB body limit (PRD §11.2)
app.use('/api', apiLimiter);

// ============================================================
//  Initialize Services
// ============================================================

const usageService = new UsageService();
const aggregatorService = new AggregatorService({
  settlementThreshold: Number(process.env.SETTLEMENT_THRESHOLD || 100),
});

const settlementService = new SettlementService({
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
});

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error('PRIVATE_KEY must be a valid 32-byte hex string.');
  }
  return hex as `0x${string}`;
}

const enableOnchainSettlement =
  process.env.X402_ENABLE_SETTLEMENT === 'true' || Boolean(process.env.PRIVATE_KEY);

let settlementWriter: SettlementWriterService | null = null;
if (enableOnchainSettlement) {
  const privateKeyRaw = process.env.PRIVATE_KEY;
  if (!privateKeyRaw) {
    console.warn('[Facilitator] On-chain settlement requested but PRIVATE_KEY is not set.');
  } else {
    try {
      settlementWriter = new SettlementWriterService({
        rpcUrl: RPC_URL,
        chainId: CHAIN_ID,
        privateKey: normalizePrivateKey(privateKeyRaw),
        providerAddress: process.env.X402_PROVIDER_ADDRESS as `0x${string}` | undefined,
        sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS as `0x${string}` | undefined,
        waitForReceipt: process.env.X402_WAIT_FOR_RECEIPT !== 'false',
      });
      console.log('[Facilitator] x402 on-chain settlement writer active');
    } catch (err) {
      console.error('[Facilitator] Failed to initialize settlement writer:', err);
      settlementWriter = null;
    }
  }
}

const requireAuthorizedSettler = process.env.X402_REQUIRE_SETTLER_AUTH !== 'false';

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
    console.error('[Facilitator] Failed to verify settlement signer authorization:', err);
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
    keyPrefix: process.env.REDIS_PREFIX || 'meap',
    ttlSeconds: Number(process.env.REDIS_USAGE_TTL_SECONDS || 7 * 24 * 60 * 60),
  });
  redisReady = redisUsageStore.connect()
    .then(() => {
      console.log('[Facilitator] Redis usage store active');
    })
    .catch((err) => {
      console.error('[Facilitator] Redis init failed:', err);
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
    fromAddress: process.env.EMAIL_FROM || 'noreply@arcenpay.io',
    brandName: process.env.BRAND_NAME || 'ArcenPay',
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
      console.log('[Facilitator] Tableland service active');
    })
    .catch((err) => {
      console.error('[Facilitator] Tableland init failed:', err);
      tablelandService = null;
    });
}

// Optional: Lit Protocol service
let litService: LitProtocolService | null = null;
let litReady: Promise<void> | null = null;
if (process.env.LIT_NETWORK) {
  litService = new LitProtocolService({
    network: process.env.LIT_NETWORK === 'habanero' ? 'habanero' : 'manzano',
    registryAddress: CONTRACTS.subscriptionRegistry,
    chain: CHAIN_ID === 8453 ? 'base' : CHAIN_ID === 84532 ? 'baseSepolia' : 'sepolia',
  });
  litReady = litService
    .connect()
    .then(() => {
      console.log('[Facilitator] Lit service active');
    })
    .catch((err) => {
      console.error('[Facilitator] Lit init failed:', err);
      litService = null;
    });
}

function getDefaultFlagsForTier(planTier: PlanTier): Record<string, boolean> {
  if (planTier === 'enterprise') {
    return {
      webhook_integration: true,
      analytics_dashboard: true,
      api_access: true,
      multi_user: true,
      custom_branding: true,
      priority_support: true,
    };
  }
  if (planTier === 'pro') {
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
    functionName: 'getPlanFeatures',
    args: [tokenId],
  })) as [bigint, string];

  const expiresAt = (await chainClient.readContract({
    address: CONTRACTS.subscriptionRegistry as `0x${string}`,
    abi: SubscriptionRegistryABI,
    functionName: 'expiresAt',
    args: [tokenId],
  })) as bigint;

  const plan = (await chainClient.readContract({
    address: CONTRACTS.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: 'getPlan',
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
    agent: String(tuple?.agent ?? tuple?.[0] ?? '0x0000000000000000000000000000000000000000'),
    token: String(tuple?.token ?? tuple?.[1] ?? '0x0000000000000000000000000000000000000000'),
    balance: BigInt((tuple?.balance ?? tuple?.[2] ?? 0n) as bigint | number | string),
    totalFunded: BigInt((tuple?.totalFunded ?? tuple?.[3] ?? 0n) as bigint | number | string),
    totalSettled: BigInt((tuple?.totalSettled ?? tuple?.[4] ?? 0n) as bigint | number | string),
    active: Boolean(tuple?.active ?? tuple?.[5] ?? false),
    createdAt: BigInt((tuple?.createdAt ?? tuple?.[6] ?? 0n) as bigint | number | string),
  };
}

// ============================================================
//  Event Listeners — PRD §9.1
// ============================================================

// Watch all subscription events and forward to webhooks
eventListener.on('*', async (event) => {
  console.log(`[Facilitator] Event: ${event.type} tokenId=${event.tokenId}`);

  // Forward to webhook if configured
  if (webhookService) {
    await webhookService.deliverEvent(event);
  }
});

// Specific handlers for each event type
eventListener.on('minted', async (event) => {
  console.log(`[Facilitator] 🎉 New subscriber: ${event.subscriber} (Plan ${event.planId})`);
  if (tablelandService && event.subscriber) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        const snapshot = await getSubscriptionSnapshot(event.tokenId);
        const features = getDefaultFlagsForTier(snapshot.planTier);
        await tablelandService.syncSubscription({
          walletAddress: event.subscriber,
          tokenId: toSafeNumber(event.tokenId, 'tokenId'),
          planTier: snapshot.planTier,
          expiresAt: toSafeNumber(snapshot.expiresAt, 'expiresAt'),
          billingInterval: snapshot.billingInterval,
          features,
        });
      } catch (err) {
        console.error('[Facilitator] Tableland sync failed on minted:', err);
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
        console.log(`[Facilitator] Lit ACC prepared for ${event.subscriber}: ${acc.length} rules`);
      } catch (err) {
        console.error('[Facilitator] Lit ACC generation failed:', err);
      }
    }
  }
  // TODO: Send welcome email if subscriber email is known
});

eventListener.on('renewed', async (event) => {
  console.log(`[Facilitator] 🔄 Renewed: tokenId=${event.tokenId} until ${event.expiration}`);
  if (tablelandService) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        const snapshot = await getSubscriptionSnapshot(event.tokenId);
        await tablelandService.updateEntitlementByTokenId(
          toSafeNumber(event.tokenId, 'tokenId'),
          {
            plan_tier: snapshot.planTier,
            feature_flags: getDefaultFlagsForTier(snapshot.planTier),
            expires_at: toSafeNumber(snapshot.expiresAt, 'expiresAt'),
            last_renewed: Math.floor(Date.now() / 1000),
            billing_interval: snapshot.billingInterval,
          },
        );
      } catch (err) {
        console.error('[Facilitator] Tableland sync failed on renewed:', err);
      }
    }
  }
});

eventListener.on('cancelled', async (event) => {
  console.log(`[Facilitator] ❌ Cancelled: tokenId=${event.tokenId}`);
  if (tablelandService) {
    if (tablelandReady) {
      await tablelandReady;
    }
    if (tablelandService) {
      try {
        await tablelandService.revokeEntitlementByTokenId(
          toSafeNumber(event.tokenId, 'tokenId'),
        );
      } catch (err) {
        console.error('[Facilitator] Tableland revoke failed on cancelled:', err);
      }
    }
  }
  if (litService) {
    console.log(`[Facilitator] Lit access revocation queued for token ${event.tokenId}`);
  }
});

// Watch for settlement events
settlementService.watchSettlements((settlement) => {
  console.log(`[Facilitator] 💰 Settlement: ${settlement.sessionId} — ${settlement.settlementAmount} (${settlement.callCount} calls)`);
});

// Start event listener
eventListener.start(12000).catch(console.error);

// ============================================================
//  Health Check
// ============================================================

app.get('/metrics', async (_req, res) => {
  aggregatorQueueDepth.set(aggregatorService.getStats().pendingSettlements);
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

app.get('/health', async (_req, res) => {
  let blockNumber: string | null = null;
  try {
    blockNumber = (await chainClient.getBlockNumber()).toString();
  } catch {
    blockNumber = null;
  }

  res.json({
    status: 'ok',
    service: 'meap-facilitator',
    version: '0.1.0',
    chainId: CHAIN_ID,
    blockNumber,
    timestamp: new Date().toISOString(),
    services: {
      eventListener: 'active',
      webhook: webhookService ? 'active' : 'not configured',
      email: emailService ? 'active' : 'not configured',
      tableland: tablelandService ? 'active' : 'not configured',
      lit: litService ? 'active' : 'not configured',
      settlementWriter: settlementWriter ? 'active' : 'not configured',
      aggregator: 'active',
      redis: redisUsageStore ? 'active' : 'not configured',
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
  });
});

// ============================================================
//  Protocol Info
// ============================================================

app.get('/info', (_req, res) => {
  res.json({
    protocol: 'MEAP + ZKVUB',
    version: '0.1.0',
    x402Version: '1',
    supportedNetworks: ['base-sepolia', 'base-mainnet'],
    supportedTokens: ['USDC'],
  });
});

// ============================================================
//  x402 Protected Demo Endpoint
// ============================================================

app.use(
  '/api/premium',
  (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const status = String(res.statusCode);
      const endpoint = req.route?.path ? String(req.route.path) : req.path || '/api/premium';
      x402RequestsTotal.inc({
        endpoint,
        method: req.method,
        status,
      });

      if (res.statusCode === 402) {
        const rejectionReason = String(res.getHeader('x-meap-rejection-reason') || 'unknown');
        x402ValidationErrorsTotal.inc({ reason: rejectionReason });
      }

      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      if (!Number.isNaN(durationSeconds) && durationSeconds >= 0) {
        // Keep queue depth fresh on every premium request.
        aggregatorQueueDepth.set(aggregatorService.getStats().pendingSettlements);
      }
    });
    next();
  },
  x402WalletLimiter,
  x402Middleware({
    planId: 'demo',
    ratePerCall: '0.001',
    network: 'base-sepolia',
    failOpenOnBalanceCheck: process.env.X402_FAIL_OPEN_BALANCE_CHECK === 'true',
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
                    'Facilitator signer is not authorized to settle SessionVault funds.',
                  );
                }
              }

              const result = await settlementWriter!.settleForSigner({
                signer,
                amount,
                sessionIdHint: sessionId,
                providerAddress: process.env.X402_PROVIDER_ADDRESS as `0x${string}` | undefined,
              });

              observe({ outcome: 'success' });
              return {
                settledAmount: result.settledAmount,
                settlementTxHash: result.transactionHash,
              };
            } catch (error) {
              observe({ outcome: 'error' });
              throw error;
            }
          },
        }
      : {}),
  }),
);

app.get('/api/premium/data', (req, res) => {
  const payment = (req as express.Request & {
    meapPayment?: X402VerifiedPaymentContext;
  }).meapPayment;
  let aggregation:
    | {
        totalEntries: number;
        thresholdReached: boolean;
      }
    | null = null;

  if (payment) {
    const usageTimestamp = Date.now();
    usageService.logUsage(payment.sessionId || 'default', {
      endpoint: '/api/premium/data',
      method: 'GET',
      timestamp: usageTimestamp,
    });

    aggregation = aggregatorService.addEntry({
      sessionId: payment.sessionId || 'default',
      endpoint: '/api/premium/data',
      method: 'GET',
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
            sessionId: payment.sessionId || 'default',
            signer: payment.signer,
            endpoint: '/api/premium/data',
            method: 'GET',
            timestamp: usageTimestamp,
            amount: payment.settledAmount || payment.amount,
            settlementTxHash: payment.settlementTxHash,
          });

          if (payment.settlementTxHash) {
            await redisUsageStore.setLatestSettlementTx(
              payment.sessionId || 'default',
              payment.settlementTxHash,
            );
          }
        } catch (err) {
          console.error('[Facilitator] Redis usage persist failed:', err);
        }
      })();
    }
  }

  res.json({
    message: 'Premium data accessed successfully',
    data: {
      insights: [
        { metric: 'active_users', value: 15234, change: '+12.5%' },
        { metric: 'revenue_mrr', value: 45000, change: '+8.3%' },
        { metric: 'churn_rate', value: 2.1, change: '-0.4%' },
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

app.get('/api/usage/:sessionId', async (req, res) => {
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
        latestSettlementTxHash = await redisUsageStore.getLatestSettlementTx(sessionId);
      }
    } catch (err) {
      console.error('[Facilitator] Redis usage read failed:', err);
    }
  }

  res.json({
    sessionId,
    callCount: count,
    latestSettlementTxHash,
    source: redisUsageStore ? 'redis' : 'memory',
  });
});

app.get('/api/usage/:sessionId/report', (req, res) => {
  const observe = proofGenerationDurationSeconds.startTimer();
  const { sessionId } = req.params;
  let circuitInputs: ReturnType<AggregatorService['getCircuitInputs']>;
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

app.get('/api/usage/:sessionId/logs', async (req, res) => {
  const { sessionId } = req.params;
  const limitParam = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(Math.trunc(limitParam), 500))
    : 100;

  if (!redisUsageStore) {
    return res.json({
      sessionId,
      source: 'memory',
      entries: [],
      message: 'Redis usage store not configured. Set REDIS_URL to enable durable usage logs.',
    });
  }

  try {
    if (redisReady) {
      await redisReady;
    }
    if (!redisUsageStore) {
      return res.json({ sessionId, source: 'memory', entries: [] });
    }
    const entries = await redisUsageStore.getUsageEntries(sessionId, limit);
    return res.json({
      sessionId,
      source: 'redis',
      limit,
      count: entries.length,
      entries,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Failed to fetch usage logs.',
    });
  }
});

app.get('/api/aggregator/stats', (_req, res) => {
  const stats = aggregatorService.getStats();
  aggregatorQueueDepth.set(stats.pendingSettlements);
  res.json({
    ...stats,
    threshold: Number(process.env.SETTLEMENT_THRESHOLD || 100),
  });
});

app.get('/api/ops/settlement/status', async (_req, res) => {
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

// ============================================================
//  Entitlement Flags Endpoint (Tableland + On-Chain fallback)
// ============================================================

app.get('/api/entitlements/:wallet/flags', async (req, res) => {
  const wallet = String(req.params.wallet || '').trim();
  if (!isValidAddress(wallet)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid wallet address.',
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
            source: 'tableland',
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
      functionName: 'hasActiveSubscription',
      args: [normalizedWallet],
    })) as boolean;

    if (!hasActive) {
      return res.json({
        ok: true,
        source: 'onchain',
        wallet: normalizedWallet,
        flags: {},
        updatedAt: Date.now(),
      });
    }

    const tokenId = (await chainClient.readContract({
      address: CONTRACTS.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: 'getWalletSubscription',
      args: [normalizedWallet],
    })) as bigint;

    if (tokenId <= 0n) {
      return res.json({
        ok: true,
        source: 'onchain',
        wallet: normalizedWallet,
        flags: {},
        updatedAt: Date.now(),
      });
    }

    const snapshot = await getSubscriptionSnapshot(tokenId);
    const flags = getDefaultFlagsForTier(snapshot.planTier);

    return res.json({
      ok: true,
      source: 'onchain',
      wallet: normalizedWallet,
      tokenId: tokenId.toString(),
      planTier: snapshot.planTier,
      flags,
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Failed to resolve entitlement flags.',
    });
  }
});

// ============================================================
//  Session Balance Endpoint
// ============================================================

app.get('/api/session/:agentAddress/balance', async (req, res) => {
  if (!isValidAddress(req.params.agentAddress)) {
    return res.status(400).json({ error: 'Invalid agent address.' });
  }
  try {
    const balance = await settlementService.getSessionBalance(req.params.agentAddress);
    res.json({
      agentAddress: req.params.agentAddress,
      balance: balance.toString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/session/:agentAddress', async (req, res) => {
  const { agentAddress } = req.params;
  if (!isValidAddress(agentAddress)) {
    return res.status(400).json({ error: 'Invalid agent address.' });
  }

  const limitParam = Number(req.query.limit || 20);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(Math.trunc(limitParam), 100))
    : 20;

  try {
    const sessionIds = (await chainClient.readContract({
      address: CONTRACTS.sessionVault as `0x${string}`,
      abi: SessionVaultABI,
      functionName: 'getAgentSessions',
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
    return res.status(500).json({ error: err?.message || 'Failed to fetch sessions.' });
  }
});

app.get('/api/session/details/:sessionId', async (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!isBytes32(sessionId)) {
    return res.status(400).json({ error: 'sessionId must be a bytes32 hex value.' });
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
    return res.status(500).json({ error: err?.message || 'Failed to fetch session details.' });
  }
});

// ============================================================
//  Webhook Delivery Log Endpoint
// ============================================================

app.get('/api/webhooks/log', (_req, res) => {
  if (!webhookService) {
    return res.json({ configured: false, log: [] });
  }
  res.json({
    configured: true,
    log: webhookService.getDeliveryLog(),
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
║   🔔  Webhooks: ${(webhookService ? 'Active' : 'Off').padEnd(28)}║
║   ✉️   Email: ${(emailService ? 'Active' : 'Off').padEnd(30)}║
║   ⛓️   Settlement: ${(settlementWriter ? 'On-chain' : 'Verify-only').padEnd(25)}║
║   🧠  Redis Logs: ${(redisUsageStore ? 'Active' : 'Off').padEnd(27)}║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Facilitator] Shutting down...');
  eventListener.stop();
  settlementService.stop();
  webhookService?.stop();
  void redisUsageStore?.stop();
  process.exit(0);
});

export default app;
