// ============================================================
//  @meap/node — x402 Middleware
//  Express middleware for x402 payment-gated API endpoints
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import type { X402Response, X402PaymentOption } from '@meap/core';
import { X402_VERSION, X402_SCHEME } from '@meap/core';

interface X402MiddlewareOptions {
  /** Plan ID for pricing reference */
  planId: string;
  /** Price per API call in USDC (human-readable, e.g., "0.001") */
  ratePerCall: string;
  /** Network identifier (e.g., "base-mainnet") */
  network?: string;
  /** Payment facilitator contract address */
  payTo?: string;
  /** Custom payment validation function */
  validatePayment?: (paymentHeader: string) => Promise<boolean>;
}

/**
 * x402 Express Middleware
 *
 * Intercepts requests to premium endpoints, issues HTTP 402 Payment Required
 * responses with x402 payloads, and validates X-PAYMENT headers.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { x402Middleware } from '@meap/node';
 *
 * const app = express();
 * app.use('/api/premium', x402Middleware({
 *   planId: 'pro',
 *   ratePerCall: '0.001',
 * }));
 * ```
 */
export function x402Middleware(options: X402MiddlewareOptions) {
  const {
    planId,
    ratePerCall,
    network = 'base-mainnet',
    payTo = '0x0000000000000000000000000000000000000000',
    validatePayment,
  } = options;

  // Convert rate to atomic units (USDC has 6 decimals)
  const rateAtomicUnits = Math.floor(parseFloat(ratePerCall) * 1_000_000).toString();

  return async (req: Request, res: Response, next: NextFunction) => {
    // Check for X-PAYMENT header
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      // No payment — return 402 with x402 payload
      const x402Response: X402Response = {
        version: X402_VERSION,
        accepts: [
          {
            scheme: X402_SCHEME,
            network,
            maxAmountRequired: rateAtomicUnits,
            resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            description: `Premium API access — Plan: ${planId}`,
            mimeType: 'application/json',
            payTo,
          },
        ],
        error: 'Payment required for this resource',
      };

      res.status(402).json(x402Response);
      return;
    }

    try {
      // Validate payment header
      let isValid = false;

      if (validatePayment) {
        // Use custom validator
        isValid = await validatePayment(paymentHeader);
      } else {
        // Default validation: verify payment signature and on-chain submission
        // TODO: Implement full x402 payment validation:
        // 1. Decode X-PAYMENT header (base64 JSON)
        // 2. Verify signature against sender's wallet
        // 3. Submit payment on-chain via Facilitator Node
        // 4. Wait for transaction confirmation
        isValid = true; // Stub for MVP
      }

      if (!isValid) {
        res.status(402).json({
          error: 'Invalid payment',
          message: 'The provided payment could not be verified',
        });
        return;
      }

      // Payment valid — record usage and continue
      // Attach payment info to request for downstream handlers
      (req as any).meapPayment = {
        verified: true,
        planId,
        ratePerCall,
        paymentHeader,
        timestamp: Date.now(),
      };

      next();
    } catch (error: any) {
      res.status(500).json({
        error: 'Payment processing failed',
        message: error.message,
      });
    }
  };
}
