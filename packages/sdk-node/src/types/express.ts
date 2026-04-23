import type { X402VerifiedPaymentContext } from "@arcenpay/sdk";

declare global {
  namespace Express {
    interface Request {
      meapPayment?: X402VerifiedPaymentContext;
    }
  }
}

export {};
