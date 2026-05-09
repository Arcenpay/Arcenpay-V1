import type { X402VerifiedPaymentContext } from "../sdk";

declare global {
  namespace Express {
    interface Request {
      arcenpayPayment?: X402VerifiedPaymentContext;
    }
  }
}

export {};
