// ============================================================
//  MEAP Facilitator Node — Entry Point
//  Validates x402 payments, watches on-chain events,
//  and delivers notifications to providers
// ============================================================

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  x402Middleware,
  UsageService,
  SettlementService,
  EventListenerService,
  WebhookService,
  EmailService,
} from '@meap/node';

const app = express();
const PORT = process.env.PORT || 3402;
const RPC_URL = process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111');

// ============================================================
//  Rate Limiting (PRD §11.2)
// ============================================================

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 req/min for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
//  Global Middleware
// ============================================================

app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '50kb' })); // 50KB body limit (PRD §11.2)
app.use('/api', apiLimiter);

// ============================================================
//  Initialize Services
// ============================================================

const usageService = new UsageService();

const settlementService = new SettlementService({
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
});

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
  // TODO: Update Tableland feature flags
  // TODO: Send welcome email if subscriber email is known
});

eventListener.on('renewed', async (event) => {
  console.log(`[Facilitator] 🔄 Renewed: tokenId=${event.tokenId} until ${event.expiration}`);
});

eventListener.on('cancelled', async (event) => {
  console.log(`[Facilitator] ❌ Cancelled: tokenId=${event.tokenId}`);
  // TODO: Revoke Lit Protocol access
  // TODO: Update Tableland expires_at
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

app.get('/health', async (_req, res) => {
  res.json({
    status: 'ok',
    service: 'meap-facilitator',
    version: '0.1.0',
    chainId: CHAIN_ID,
    timestamp: new Date().toISOString(),
    services: {
      eventListener: 'active',
      webhook: webhookService ? 'active' : 'not configured',
      email: emailService ? 'active' : 'not configured',
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
  x402Middleware({
    planId: 'demo',
    ratePerCall: '0.001',
    network: 'base-sepolia',
  }),
);

app.get('/api/premium/data', (req, res) => {
  const payment = (req as any).meapPayment;
  if (payment) {
    usageService.logUsage(payment.sessionId || 'default', {
      endpoint: '/api/premium/data',
      method: 'GET',
      timestamp: Date.now(),
    });
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
      timestamp: payment?.timestamp,
    },
  });
});

// ============================================================
//  Usage Analytics Endpoint
// ============================================================

app.get('/api/usage/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const count = usageService.getUsageCount(sessionId);

  res.json({ sessionId, callCount: count });
});

// ============================================================
//  Session Balance Endpoint
// ============================================================

app.get('/api/session/:agentAddress/balance', async (req, res) => {
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
  process.exit(0);
});

export default app;
