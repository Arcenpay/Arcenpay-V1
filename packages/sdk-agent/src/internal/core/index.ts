// ============================================================
//  ArcenPay Internal Core — Main Entry Point
// ============================================================

// Types
export type {
  Plan,
  PlanTier,
  EnvironmentMode,
  PaymentToken,
  BillingTemplate,
  InvoiceSummary,
  AuditEvent,
  Subscription,
  SubscriptionEvent,
  Entitlement,
  EntitlementSourceStatus,
  EntitlementSources,
  EntitlementFreshness,
  FeatureFlag,
  AutopayConfig,
  SessionVaultInfo,
  UsageProof,
  PublicInputs,
  BillingSettlement,
  X402Response,
  X402PaymentOption,
  X402PaymentHeader,
  X402RejectionReason,
  X402VerifiedPaymentContext,
  ProviderConfig,
  MirroredSubscription,
  NetworkConfig,
  ContractAddresses,
  ChainServiceEndpoints,
  ChainEnvironmentManifest,
  EnvironmentManifest,
  MEAPConfig,
  ArcenPayConfig,
  TablelandEntitlement,
  UsageReport,
  ComponentRenderData,
  ComponentElement,
  ComponentDesign,
  ComponentEntitlement,
  ComponentUsageItem,
  ComponentPlanEntitlement,
  ComponentPlanSummary,
  ComponentInvoiceSummary,
  ComponentPaymentMethod,
  ComponentSubscriptionTransition,
  AutoTopUpConfig,
  AutoTopUpMode,
  DispatchConfig,
  DispatchProvider,
  DispatchProviderType,
  TopUpRequest,
  AgentPermissionConfig,
  PersistentAgentState,
  PersistentStore,
  ArcenCompanyKeys,
  ArcenUserKeys,
  ArcenCompany,
  ArcenUser,
  FlagCheckResult,
  EmbedAccessTokenResponse,
  SchematicCompanyKeys,
  SchematicUserKeys,
  SchematicCompany,
  SchematicUser,
  FlagResult,
  EntitlementResult,
  ConsumeEntitlementResult,
  IdentifyResult,
} from "./types";

// Chain configs
export {
  sepolia,
  baseSepolia,
  baseMainnet,
  arcTestnet,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  TOKENS,
  DEFAULT_CHAIN_ID,
  getTokenAddress,
  getTokenDecimals,
  getTokensForChain,
  getChain,
  getBlockExplorerUrl,
  isSupportedChainId,
} from "./chains";
export type { SupportedChainId, TokenInfo } from "./chains";

// Contract addresses
export { getContractAddresses, setContractAddresses } from "./addresses";
export {
  ENVIRONMENT_MANIFEST_VERSION,
  ZERO_ADDRESS,
  getChainEnvironment,
  getEnvironmentManifest,
  validateChainEnvironment,
  isZeroAddress,
} from "./environment";
export type { ValidateChainEnvironmentOptions } from "./environment";
export {
  PRIMARY_RUNTIME_CHAIN_ID,
  LEGACY_RUNTIME_CHAIN_IDS,
  getConfiguredRuntimeChainId,
  getPrimaryRuntimeChainProfile,
  isPrimaryRuntimeChain,
  formatRuntimeChainMismatch,
} from "./runtime-profile";
export type { RuntimeChainProfile } from "./runtime-profile";
export {
  ARCENPAY_API_URL,
  ARCENPAY_APP_URL,
  resolveArcenPayBaseUrl,
  resolveArcenPayAppUrl,
} from "./app-origin";
export type {
  ResolveArcenPayAppUrlOptions,
  ResolveArcenPayBaseUrlOptions,
} from "./app-origin";

// ABIs
export {
  SubscriptionRegistryABI,
  PlanFactoryABI,
  ERC7579AutopayModuleABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  FeeCollectorABI,
  MirrorRegistryABI,
  YieldSessionVaultABI,
} from "./abis";

// Constants
export {
  SUBSCRIPTION_FEE_BPS,
  SETTLEMENT_FEE_BPS,
  BPS_DENOMINATOR,
  MIN_BILLING_INTERVAL,
  MONTHLY_INTERVAL,
  YEARLY_INTERVAL,
  MODULE_TYPES,
  X402_VERSION,
  X402_SCHEME,
  INTERFACE_VERSIONS,
} from "./constants";

// Error mapping
export {
  CONTRACT_ERRORS,
  parseContractError,
  normalizeError,
  MEAPError,
  ArcenPayError,
  ContractError,
  AuthError,
} from "./errors";
export type { MEAPErrorCode, ArcenPayErrorCode } from "./errors";

// Chain helpers — re-exported from chains.ts above

// Formatting utilities
export {
  toISOCurrencyCode,
  isStablecoinCode,
  formatCurrency,
  formatUsdc,
  formatInvoiceTotal,
} from "./format";
