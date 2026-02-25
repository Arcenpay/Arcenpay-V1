// ============================================================
//  MEAP Facilitator Node — Entry Point
//  Validates x402 payments and manages billing sessions
// ============================================================

import express from 'express';
import cors from 'cors';
import { x402Middleware, UsageService } from '@meap/node';

const app = express();
const PORT = process.env.PORT || 3402;

// Global middleware
app.use(cors());
app.use(express.json());

// Initialize usage service
const usageService = new UsageService();

// ============================================================
//  Health Check
// ============================================================

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'meap-facilitator',
    version: '0.0.1',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
//  Protocol Info
// ============================================================

app.get('/info', (_req, res) => {
  res.json({
    protocol: 'MEAP + ZKVUB',
    version: '0.0.1',
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
  // Log usage for the session
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

  res.json({
    sessionId,
    callCount: count,
  });
});

// ============================================================
//  Start Server
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   🚀  MEAP Facilitator Node                 ║
║   📡  Port: ${String(PORT).padEnd(33)}║
║   🔗  Network: Base Sepolia                 ║
║   💰  x402 Protocol: Active                 ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});

export default app;
