import type { X402VerifiedPaymentContext } from '@meap/core';

declare global {
  namespace Express {
    interface Request {
      meapPayment?: X402VerifiedPaymentContext;
    }
  }
}

export {};
