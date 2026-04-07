// ============================================================
//  @arcenpay/sdk — Main Entry Point
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
  ComponentPlanSummary,
  ComponentInvoiceSummary,
  ComponentPaymentMethod,
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
} from './types';

// Chain configs
export {
  sepolia,
  baseSepolia,
  baseMainnet,
  SUPPORTED_CHAINS,
  TOKENS,
  DEFAULT_CHAIN_ID,
} from './chains';
export type { SupportedChainId } from './chains';

// Contract addresses
export { getContractAddresses, setContractAddresses } from './addresses';
export {
  ENVIRONMENT_MANIFEST_VERSION,
  ZERO_ADDRESS,
  getChainEnvironment,
  getEnvironmentManifest,
  validateChainEnvironment,
  isZeroAddress,
} from './environment';
export type { ValidateChainEnvironmentOptions } from './environment';

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
} from './abis';

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
} from './constants';

// Error mapping
export {
  CONTRACT_ERRORS,
  parseContractError,
  normalizeError,
  MEAPError,
  ArcenPayError,
  ContractError,
  AuthError,
} from './errors';
export type { MEAPErrorCode, ArcenPayErrorCode } from './errors';

// Smart Account helpers (ZeroDev ERC-7579)
export { createSmartAccount } from './accounts';
export type { SmartAccountInput, SmartAccountResult } from './accounts';

// Chain helpers
export { getChain, getBlockExplorerUrl } from './chains';
