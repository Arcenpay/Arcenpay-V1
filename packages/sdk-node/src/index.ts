// ============================================================
//  @arcenpay/node — Main Entry Point
// ============================================================

// HTTP Client — main SDK entry point for most integrations
export { ArcenClient, ArcenApiError } from "./client";
export type { ArcenClientConfig, TrackEventInput, IdentifyInput } from "./client";

// Middleware
export { x402Middleware } from "./middleware/x402";
export type { X402MiddlewareOptions } from "./middleware/x402";

// Services
export { UsageService } from "./services/usage";
export type { ProofMode, UsageServiceConfig, UsageProofErrorCode } from "./services/usage";
export { UsageProofError, UsageProofErrorCodes } from "./services/usage";
export { SettlementService } from "./services/settlement";
export { SettlementWriterService } from "./services/settlement-writer";
export type {
  SettlementWriterConfig,
  SettleForSignerInput,
  SettlementWriteResult,
} from "./services/settlement-writer";
export { EventListenerService } from "./services/events";
export type {
  SubscriptionEventData,
  SubscriptionEventType,
} from "./services/events";
export { WebhookService, verifyWebhookSignature } from "./services/webhooks";
export type {
  WebhookConfig,
  WebhookPayload,
  WebhookDeliveryLog,
} from "./services/webhooks";
export { EmailService } from "./services/email";
export type { EmailConfig, EmailTemplate } from "./services/email";
export { TablelandService } from "./services/tableland";
export type { TablelandConfig } from "./services/tableland";
export { LitProtocolService } from "./services/lit";
export type { LitConfig, LitAccessCondition } from "./services/lit";
export { AggregatorService } from "./services/aggregator";
export { RedisUsageStore } from "./services/redis-usage";
export type {
  RedisUsageStoreConfig,
  PersistedUsageEntry,
} from "./services/redis-usage";
export { ProofOrchestrator } from "./services/proof-orchestrator";
export type { ProofOrchestratorConfig } from "./services/proof-orchestrator";
export { AxelarTransport } from "./services/transport-axelar";
export type {
  AxelarTransportConfig,
  DispatchResult,
} from "./services/transport-axelar";
export { CCIPTransport } from "./services/transport-ccip";
export type {
  CCIPTransportConfig,
  CCIPDispatchResult,
} from "./services/transport-ccip";
export { BillingKeeper } from "./services/keeper";
export type { BillingKeeperConfig } from "./services/keeper";
export { InMemoryNonceStore, RedisNonceStore } from "./services/nonce-store";
export type {
  NonceStore,
  RedisLike,
} from "./services/nonce-store";
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
