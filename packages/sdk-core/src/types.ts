// ============================================================
//  @arcenpay/sdk — Types
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

export type PlanTier = "starter" | "pro" | "enterprise" | string;

// --- Billing/Catalog Types ---

export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

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
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  currentVersion: number;
}

export interface InvoiceSummary {
  id: string;
  number?: string | null;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
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
  actorType: "USER" | "API" | "SYSTEM";
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
  type: "minted" | "renewed" | "cancelled";
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
  scheme: "exact" | "streaming";
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
  | "MISSING_PAYMENT_HEADER"
  | "INVALID_PAYMENT_HEADER_ENCODING"
  | "INVALID_PAYMENT_HEADER_FORMAT"
  | "MALFORMED_PAYMENT_PAYLOAD"
  | "RESOURCE_MISMATCH"
  | "PAYMENT_AMOUNT_TOO_LOW"
  | "PAYMENT_EXPIRED"
  | "NONCE_ALREADY_USED"
  | "INVALID_SIGNATURE"
  | "SIGNER_MISMATCH"
  | "INSUFFICIENT_SESSION_BALANCE"
  | "BALANCE_CHECK_FAILED"
  | "SETTLEMENT_FAILED"
  | "PAYMENT_PROCESSING_FAILED";

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
  /** Optional ERC-4626 yield vault — set ARCENPAY_CONTRACT_<chainId>_yieldSessionVault to enable */
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

// --- ArcenEmbed Component Render Data ---

export interface ComponentEntitlement {
  featureKey: string;
  name: string;
  value: boolean | string | number;
  featureType?: "boolean" | "event_based" | "trait_based" | "credit";
  limit?: number;
  usage?: number;
  exceeded?: boolean;
  unitSingular?: string;
  unitPlural?: string;
}

export interface ComponentUsageItem {
  featureKey: string;
  name: string;
  used: number;
  limit?: number;
  unitSingular: string | null;
  unitPlural?: string | null;
}

export interface ComponentPlanEntitlement {
  featureName: string;
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  enabled: boolean;
}

export interface ComponentPlanSummary {
  id: string;
  name: string;
  price: string;
  annualPrice?: string | null;
  tier: string;
  billingInterval: number;
  acceptedToken?: string;
  acceptedChainId?: number;
  onChainPlanId?: string | null;
  description?: string;
  metadata?: {
    entitlements?: ComponentPlanEntitlement[];
    [key: string]: unknown;
  } | null;
}

export interface ComponentInvoiceSummary {
  id: string;
  number: string | null;
  total: string;
  currency: string;
  status: string;
  issuedAt: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  customerEmail?: string | null;
  customerWallet?: string | null;
  downloadUrl?: string | null;
}

export interface ComponentPaymentMethod {
  walletAddress: string | null;
  token: string | null;
  chainId: number | null;
}

export interface ComponentElement {
  type:
    | "planManager"
    | "meteredFeatures"
    | "includedFeatures"
    | "plansTable"
    | "nextBillDue"
    | "paymentMethod"
    | "invoices"
    | "unsubscribe"
    | "text"
    | "button"
    | string;
  config?: Record<string, unknown>;
  // Flat props saved directly by the editor (heading, body, label, href, etc.)
  [key: string]: unknown;
}

export interface ComponentDesign {
  // Editor-native fields (saved by dashboard component builder)
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  fontSize?: string | number;
  cardStyle?: "minimal" | "bordered" | "elevated";
  columns?: number;
  sections?: "merged" | "separate";
  // Normalized / alias fields
  fontColor?: string;
  backgroundColor?: string;
  borderRadius?: string | number;
}

export interface ComponentRenderData {
  component: {
    id: string;
    name: string;
    elements: ComponentElement[];
    design: ComponentDesign;
  };
  activePlan: ComponentPlanSummary | null;
  entitlements: ComponentEntitlement[];
  usage: ComponentUsageItem[];
  plans: ComponentPlanSummary[];
  company?: Record<string, unknown> | null;
  userId?: string | null;
  providerWallet?: string | null;
  nextBillingAt?: string | null;
  paymentMethod?: ComponentPaymentMethod | null;
  recentInvoices?: ComponentInvoiceSummary[];
}

// --- SDK Config ---

export interface MEAPConfig {
  network: NetworkConfig;
  litNetwork?: "manzano" | "habanero";
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
  tierFeatureFallback?: Record<
    string,
    Record<string, boolean | string | number>
  >;
}

/** @alias MEAPConfig — ArcenPay-branded alias */
export type ArcenPayConfig = MEAPConfig;

// --- ArcenPay Company/User Key Types ---

/** Keys used to identify a company in API calls */
export interface ArcenCompanyKeys {
  /** Caller's own internal company ID (maps to externalId) */
  id?: string;
  /** Wallet address (checksummed or lowercase) */
  wallet?: string;
  /** Company email address */
  email?: string;
}

/** Keys used to identify a user in API calls */
export interface ArcenUserKeys {
  /** Caller's own internal user ID (maps to externalId) */
  id?: string;
  /** Clerk user ID */
  clerkUserId?: string;
  /** Wallet address */
  wallet?: string;
}

/** A company entity in the entitlement system */
export interface ArcenCompany {
  id: string;
  teamId: string;
  name: string;
  walletAddress?: string | null;
  email?: string | null;
  externalId?: string | null;
  logoUrl?: string | null;
  traits: Record<string, unknown>;
  activePlanId?: string | null;
  activeAddOnIds: string[];
  createdAt: string;
  lastSeenAt: string;
}

/** A user entity linked to a company */
export interface ArcenUser {
  id: string;
  teamId: string;
  companyId: string;
  name?: string | null;
  email?: string | null;
  walletAddress?: string | null;
  clerkUserId?: string | null;
  externalId?: string | null;
  traits: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

/** Result of a feature flag check */
export interface FlagCheckResult {
  flag: string;
  value: boolean;
  reason: string;
  companyId?: string;
  userId?: string;
}

/** Response from the access token creation endpoint */
export interface EmbedAccessTokenResponse {
  token: string;
  expiresAt: string;
}

// --- Backward compatibility aliases ---

/** @deprecated Use ArcenCompanyKeys instead */
export type SchematicCompanyKeys = ArcenCompanyKeys;
/** @deprecated Use ArcenUserKeys instead */
export type SchematicUserKeys = ArcenUserKeys;
/** @deprecated Use ArcenCompany instead */
export type SchematicCompany = ArcenCompany;
/** @deprecated Use ArcenUser instead */
export type SchematicUser = ArcenUser;

// ─── Schematic-style SDK types ────────────────────────────────────────────────

/**
 * Result of checkFlag() — boolean feature gating.
 * Use for "should this feature be visible/enabled?"
 */
export interface FlagResult {
  key: string;
  /** Whether the feature is enabled for this company/user */
  enabled: boolean;
  /** Machine-readable reason: 'override', 'rule:<ruleId>', 'default' */
  reason: string;
}

/**
 * Result of checkEntitlement() — quota-aware feature gating.
 * Use for "can this action still be performed under the customer's plan limits?"
 */
export interface EntitlementResult {
  key: string;
  /** Whether the feature/action is currently allowed */
  enabled: boolean;
  /** Machine-readable reason */
  reason: string;
  /** Maximum allowed usage. null = unlimited */
  allocation: number | null;
  /** Current usage count in the active billing period */
  usage: number;
  /** true when usage >= allocation (and allocation is not null) */
  exceeded: boolean;
}

/**
 * Result of consumeEntitlement() — quota-aware metered action enforcement.
 * `consumed` is true only when a usage unit was actually recorded.
 */
export interface ConsumeEntitlementResult extends EntitlementResult {
  consumed: boolean;
}

/**
 * Result of identify() — creates/updates company+user and returns a session token.
 */
export interface IdentifyResult {
  token: string;
  companyId: string;
  userId?: string;
  expiresAt: number; // unix timestamp
}
