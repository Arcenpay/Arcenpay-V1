import type { X402VerifiedPaymentContext } from "../sdk";

declare global {
  namespace Express {
    interface Request {
      meapPayment?: X402VerifiedPaymentContext;
    }
  }
}

export {};
