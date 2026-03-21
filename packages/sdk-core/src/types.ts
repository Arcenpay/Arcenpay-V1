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

// --- Billing/Catalog Types ---

export type EnvironmentMode = 'DEVELOPMENT' | 'PRODUCTION';

export interface PaymentToken {
  symbol: string;
  address: string;
  chainId: number;
  decimals: number;
}

export interface BillingTemplate {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  currentVersion: number;
}

export interface InvoiceSummary {
  id: string;
  number?: string | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID' | 'OVERDUE';
  currency: string;
  customerEmail?: string | null;
  customerWallet?: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  issuedAt?: string | null;
  dueAt?: string | null;
  environmentMode: EnvironmentMode;
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  actorType: 'USER' | 'API' | 'SYSTEM';
  actorUserId?: string | null;
  actorAddress?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId: string;
  metadata?: Record<string, unknown> | null;
}

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
  /** Optional ERC-4626 yield vault — set MEAP_CONTRACT_<chainId>_yieldSessionVault to enable */
  yieldSessionVault?: string;
}

export interface ChainServiceEndpoints {
  rpcUrl: string;
  subgraphUrl?: string;
  facilitatorUrl?: string;
}

export interface ChainEnvironmentManifest {
  chainId: number;
  chainName: string;
  isTestnet: boolean;
  contracts: ContractAddresses;
  services: ChainServiceEndpoints;
}

export interface EnvironmentManifest {
  manifestVersion: string;
  chains: Record<number, ChainEnvironmentManifest>;
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

// ─── Web3 SchematicHQ Protocol Types ──────────────────────────────────────────

/** Multi-key identity for a company (Web3-native + Web2 compatible) */
export interface SchematicCompanyKeys {
  id?: string;       // caller's internal company UUID
  wallet?: string;   // wallet address (checksummed or lowercase)
  email?: string;
}

/** Multi-key identity for a user */
export interface SchematicUserKeys {
  id?: string;             // caller's internal user UUID
  clerkUserId?: string;    // Clerk authentication user ID
  wallet?: string;         // wallet address
}

/** Result of a flag check evaluation */
export interface FlagCheckResult {
  flag: string;
  value: boolean;
  reason: string;
  companyId?: string;
  userId?: string;
}

/** Track event payload (usage reporting) */
export interface TrackEventPayload {
  event_type: 'track';
  name: string;
  company: SchematicCompanyKeys;
  user?: SchematicUserKeys;
  traits?: Record<string, unknown>;
}

/** Identify event payload (company/user upsert) */
export interface IdentifyEventPayload {
  event_type: 'identify';
  company?: SchematicCompanyKeys & { name?: string };
  user?: SchematicUserKeys & { name?: string; email?: string };
  traits?: Record<string, unknown>;
}

/** A SchematicHQ-style company with Web3 identity */
export interface SchematicCompany {
  id: string;
  name: string;
  walletAddress: string | null;
  email: string | null;
  externalId: string | null;
  traits: Record<string, unknown>;
  activePlanId: string | null;
  logoUrl: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** A SchematicHQ-style user */
export interface SchematicUser {
  id: string;
  name: string | null;
  email: string | null;
  walletAddress: string | null;
  clerkUserId: string | null;
  externalId: string | null;
  companyId: string;
  traits: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

/** A verified zkTLS proof from Reclaim Protocol */
export interface ZkTlsProof {
  id: string;
  providerId: string;
  providerName: string;
  claims: Record<string, string>;
  verifiedAt: string;
  expiresAt: string | null;
  companyId: string | null;
  userId: string | null;
}

/** Embed access token response */
export interface EmbedAccessTokenResponse {
  token: string;
  expires_at: string;
  company_id: string | null;
  user_id: string | null;
}

/** Component element types for ArcenEmbed */
export type ComponentElementType =
  | 'planManager'
  | 'includedFeatures'
  | 'meteredFeatures'
  | 'plansTable'
  | 'invoices'
  | 'paymentMethod';

export interface ComponentElement {
  type: ComponentElementType;
  config?: Record<string, unknown>;
}

export interface ComponentDesign {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  fontWeight?: 'regular' | 'medium' | 'bold';
  columns?: 1 | 2 | 3;
}

/** Render data returned by /api/v1/components/:id/render */
export interface ComponentRenderData {
  component: {
    id: string;
    name: string;
    elements: ComponentElement[];
    design: ComponentDesign;
  };
  company: { id: string; name: string; walletAddress: string | null } | null;
  activePlan: { id: string; name: string; tier: string; price: string } | null;
  plans: Array<{ id: string; name: string; tier: string; price: string; billingInterval: number }>;
  entitlements: Array<{ featureKey: string; name: string; value: boolean }>;
  usage: Array<{ featureKey: string; name: string; used: number; unitSingular: string | null }>;
  userId: string | null;
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
  /**
   * Optional fallback feature map used by `useEntitlement` when Tableland is not
   * configured. Keys are plan tiers ('starter' | 'pro' | 'enterprise'), values
   * are feature key → value maps. Replaces the SDK's built-in hardcoded defaults.
   *
   * @example
   * tierFeatureFallback: {
   *   starter: { api_access: false, webhooks: true },
   *   pro:     { api_access: true,  webhooks: true },
   *   enterprise: { api_access: true, webhooks: true, sso: true },
   * }
   */
  tierFeatureFallback?: Record<string, Record<string, boolean | string | number>>;
}
