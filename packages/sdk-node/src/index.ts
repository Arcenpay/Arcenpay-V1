// ============================================================
//  @arcenpay/node — Main Entry Point
// ============================================================
import "./types/express";

// HTTP Client — main SDK entry point for most integrations
export { ArcenClient, ArcenApiError } from "./client";
export type {
  ArcenClientConfig,
  TrackEventInput,
  IdentifyInput,
  ActivateSubscriptionInput,
  ActivateSubscriptionResult,
  PaymentLinkSummary,
  CreatePaymentLinkInput,
  UpdatePaymentLinkInput,
  CheckoutSessionSummary,
  CreateCheckoutSessionInput,
  ChargeCustomerInput,
  ChargeCustomerResult,
  HostedCheckoutInput,
  HostedCheckoutResult,
} from "./client";
export type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  ArcenCompany,
  ArcenUser,
  FlagResult,
  EntitlementResult,
  ConsumeEntitlementResult,
  IdentifyResult,
} from "./sdk";
export {
  ARCENPAY_API_URL,
  ARCENPAY_APP_URL,
  resolveArcenPayAppUrl,
  resolveArcenPayBaseUrl,
} from "./sdk";
export type {
  ResolveArcenPayAppUrlOptions,
  ResolveArcenPayBaseUrlOptions,
} from "./sdk";

// Middleware
export { x402Middleware } from "./middleware/x402";
export type { X402MiddlewareOptions } from "./middleware/x402";

// Public server helpers
export { verifyWebhookSignature } from "./services/webhooks";
export { InMemoryNonceStore, RedisNonceStore } from "./services/nonce-store";
export type { NonceStore, RedisLike } from "./services/nonce-store";
export {
  PROTOCOL_EVENT_SCHEMA_VERSION,
  buildEventIdempotencyKey,
  createProtocolEvent,
  mapProtocolEventToBillingType,
} from "./services/event-contracts";
export type {
  ProtocolEvent,
  ProtocolEventName,
  ProtocolEventSource,
} from "./services/event-contracts";
