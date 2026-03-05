// ============================================================
//  @meap/core — Types
//  Protocol-wide TypeScript type definitions
// ============================================================

// --- Plan Types ---

export interface Plan {
  id: bigint;
  provider: string;
  name: string;
  tier: PlanTier;
  price: bigint;
  billingInterval: number;
  acceptedToken: string;
  active: boolean;
  metadataURI: string;
}

export type PlanTier = 'starter' | 'pro' | 'enterprise' | string;

// --- Subscription Types ---

export interface Subscription {
  tokenId: bigint;
  subscriber: string;
  planId: bigint;
  planTier: PlanTier;
  expiration: bigint;
  isValid: boolean;
}

export interface SubscriptionEvent {
  type: 'minted' | 'renewed' | 'cancelled';
  tokenId: bigint;
  planId: bigint;
  timestamp: bigint;
  amount?: bigint;
  expiration: bigint;
}

// --- Entitlement Types ---

export interface EntitlementSourceStatus {
  enabled: boolean;
  lastUpdatedAt: number | null;
}

export interface EntitlementSources {
  onChain: EntitlementSourceStatus;
  tableland: EntitlementSourceStatus;
  lit: EntitlementSourceStatus;
}

export interface EntitlementFreshness {
  resolvedAt: number | null;
  staleAfterMs: number;
}

export interface Entitlement {
  isSubscribed: boolean;
  planTier: PlanTier;
  features: Record<string, boolean | string | number>;
  expiresAt: bigint;
  tokenId: bigint;
  sources: EntitlementSources;
  freshness: EntitlementFreshness;
}

export interface FeatureFlag {
  key: string;
  value: boolean | string | number;
  planTier: PlanTier;
}

// --- Autopay Module Types ---

export interface AutopayConfig {
  merchant: string;
  maxAmount: bigint;
  token: string;
  interval: number;
  startTime: bigint;
  planId: bigint;
}

// --- ZKVUB Types ---

export interface SessionVaultInfo {
  sessionId: string;
  agent: string;
  token: string;
  balance: bigint;
  totalFunded: bigint;
  totalSettled: bigint;
  active: boolean;
  createdAt: bigint;
}

export interface UsageProof {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
}

export interface PublicInputs {
  agentAddress: string;
  sessionId: string;
  callCount: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  merkleRoot: string;
  nullifier: string;
}

export interface BillingSettlement {
  sessionId: string;
  agentAddress: string;
  callCount: bigint;
  settlementAmount: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  transactionHash: string;
}

// --- x402 Types ---

export interface X402Response {
  version: string;
  accepts: X402PaymentOption[];
  error: string;
}

export interface X402PaymentOption {
  scheme: 'exact' | 'streaming';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
}

export interface X402PaymentHeader {
  version: string;
  scheme: string;
  network: string;
  payload: string;
  signature: string;
}

export type X402RejectionReason =
  | 'MISSING_PAYMENT_HEADER'
  | 'INVALID_PAYMENT_HEADER_ENCODING'
  | 'INVALID_PAYMENT_HEADER_FORMAT'
  | 'MALFORMED_PAYMENT_PAYLOAD'
  | 'RESOURCE_MISMATCH'
  | 'PAYMENT_AMOUNT_TOO_LOW'
  | 'PAYMENT_EXPIRED'
  | 'NONCE_ALREADY_USED'
  | 'INVALID_SIGNATURE'
  | 'SIGNER_MISMATCH'
  | 'INSUFFICIENT_SESSION_BALANCE'
  | 'BALANCE_CHECK_FAILED'
  | 'SETTLEMENT_FAILED'
  | 'PAYMENT_PROCESSING_FAILED';

export interface X402VerifiedPaymentContext {
  verified: true;
  signer: string;
  planId: string;
  ratePerCall: string;
  amount: string;
  settledAmount: string;
  settlementTxHash: string | null;
  sessionId: string;
  paymentHeader: string;
  timestamp: number;
  rejectionReason: null;
}

// --- Provider Dashboard Types ---

export interface ProviderConfig {
  address: string;
  plans: Plan[];
  subscribers: number;
  totalRevenue: bigint;
}

// --- Cross-Chain Types ---

export interface MirroredSubscription {
  subscriber: string;
  planId: bigint;
  planTier: PlanTier;
  expiration: bigint;
  sourceChainId: number;
  sourceTokenId: bigint;
  lastUpdated: bigint;
}

// --- Network Config ---

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  contracts: ContractAddresses;
}

export interface ContractAddresses {
  subscriptionRegistry: string;
  autopayModule: string;
  planFactory: string;
  feeCollector: string;
  sessionVault: string;
  zkUsageVerifier: string;
  mirrorRegistry?: string;
}

// --- Tableland Entitlement Types (PRD Section 3.1.2) ---

export interface TablelandEntitlement {
  wallet_address: string;
  nft_token_id: number;
  plan_tier: PlanTier;
  feature_flags: Record<string, boolean | string | number>;
  api_rate_limit: number;
  billing_interval: number;
  last_renewed: number;
  expires_at: number;
  chain_id: number;
}

// --- Usage Report Types ---

export interface UsageReport {
  sessionId: string;
  agentAddress: string;
  totalCalls: bigint;
  totalCost: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  remainingBalance: bigint;
  settled: boolean;
}

// --- SDK Config ---

export interface MEAPConfig {
  network: NetworkConfig;
  litNetwork?: 'manzano' | 'habanero';
  litConfig?: {
    /**
     * Optional Lit decryption endpoint used by FeatureFlagGuard when
     * `requireDecryption` is enabled.
     * Supports `{wallet}` and `{feature}` tokens.
     */
    decryptEndpoint?: string;
  };
  tablelandConfig?: {
    /** Facilitator or backend base URL, used by SDK clients to resolve entitlement endpoints. */
    providerUrl?: string;
    /**
     * Optional explicit feature flags endpoint.
     * If provided, use `{wallet}` token to inject wallet address.
     * Example: `https://facilitator.example.com/api/entitlements/{wallet}/flags`
     */
    featureFlagsEndpoint?: string;
  };
}
