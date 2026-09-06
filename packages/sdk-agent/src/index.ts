// ============================================================
//  @arcenpay/agent — Main Entry Point
// ============================================================

export { ArcenAgent, ArcenPayAgent, MEAPAgent } from './agent';
export type {
  AgentConfig,
  FetchOptions,
  AutoTopUpConfig,
  AutoTopUpMode,
  DispatchConfig,
  DispatchProvider,
  DispatchProviderType,
  TopUpRequest,
  PersistentAgentState,
  PersistentStore,
  AgenticPaymentLinkSpec,
  AgentPaymentReceipt,
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
} from './agent';
export { FileStore } from './store';
export {
  ARCENPAY_MCP_TOOL_DEFINITIONS,
  createArcenAgentMcpTools,
  type McpToolDefinition,
  type McpToolResponse,
} from './mcp-tools';

// ─── ArcenAuth Mandate (Layer 3) ───────────────────────────
export {
  createAgentMandate,
  signAgentMandate,
  verifyAgentMandate,
  isScopeSubset,
  canonicalJson,
  MANDATE_DOMAIN_NAME,
  MANDATE_DOMAIN_VERSION,
  STELLAR_MANDATE_SIGNING_PREFIX,
  MANDATE_EIP712_TYPES,
  type CreateMandateParams,
} from './auth/mandate';

// ─── ArcenAuth Policy Engine (Layer 2) ─────────────────────
export {
  ArcenPolicyEvaluator,
  evaluateCondition,
  matchDomain,
} from './auth/policy';

// ─── Verify-Then-Settle Escrow (Section 11) ─────────────────
export {
  computeExactHash,
  checkSchemaConformance,
  verifyCommitment,
  createProviderCommitment,
} from './escrow/verifier';

// ─── Shared Protocol Types ──────────────────────────────────
export type {
  ArcenPayAgentMandate,
  MandateScope,
  MandateIssuer,
  MandateSubject,
  MandateRevocationConfig,
  HumanAttestation,
  MandateStatus,
  ArcenPolicy,
  PolicyEffect,
  PolicyOutcome,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  EscrowMode,
  DisputeReason,
  EscrowTerms,
  ProviderCommitment,
  SettlementConfirmation,
  DisputeClaim,
  DisputeReceipt,
  EscrowReservationStatus,
  EscrowReservation,
} from './internal/core';

