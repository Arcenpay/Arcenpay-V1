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
  AgenticPaymentLinkSpec,
  AgentPaymentReceipt,
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
  MandateIssuerKind,
  MandateSubjectKind,
  MandateIssuer,
  MandateSubject,
  MandateScope,
  MandateRevocationConfig,
  HumanAttestation,
  ArcenPayAgentMandate,
  MandateStatus,
  PolicyEffect,
  PolicyOutcome,
  ArcenPolicy,
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
} from "./types";

// Chain configs
export {
  sepolia,
  baseSepolia,
  baseMainnet,
  arcTestnet,
  botMainnet,
  botTestnet,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  EVM_SUPPORTED_CHAIN_IDS,
  TOKENS,
  DEFAULT_CHAIN_ID,
  getTokenAddress,
  getTokenDecimals,
  getTokensForChain,
  resolveTokenAddress,
  getChain,
  getBlockExplorerUrl,
  isSupportedChainId,
  isEvmSupportedChainId,
} from "./chains";
export type {
  SupportedChainId,
  EvmSupportedChainId,
  TokenInfo,
} from "./chains";

// Chain family + multi-chain registry (EVM, Stellar, Solana)
export {
  CHAIN_FAMILY_METADATA,
  CHAIN_REGISTRY,
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  getChainFamily,
  getChainDescriptor,
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
  getSolanaRpcUrl,
  getSolanaRpcUrls,
  getAllRegisteredChainIds,
  getChainIdsForFamily,
  isEvmChain,
  isStellarChain,
  isStellarChainId,
  isSolanaChain,
  isSolanaChainId,
  isValidAddress,
  isValidTxHash,
  isValidAddressForChain,
  isValidTxHashForChain,
  isValidAnyFamilyAddress,
  isValidAnyFamilyTxHash,
  normalizeAnyFamilyTxHash,
  normalizeWalletForChain,
  unsetAddressForFamily,
  isUnsetAddress,
  isUnsetAddressForChain,
} from "./chain-family";
export type {
  ChainFamily,
  ChainFamilyMetadata,
  ChainDescriptor,
} from "./chain-family";

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
  normalizeX402AmountToDecimal,
} from "./format";

// SVG sanitization
export { sanitizeSvg } from "./svg";
