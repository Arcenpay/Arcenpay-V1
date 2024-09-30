export {
  deploySmartAccount,
  getCounterfactualSmartAccountAddress,
  HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS,
  isHostedSmartAccountUrlForUnsupportedChain,
  isSmartAccountInfrastructureError,
  isSmartAccountProviderUnavailableError,
  isUnsupportedEip7702AuthorizationError,
  isPrefundError,
  isRecoverableSmartAccountFundingError,
  revokeAutopayModule,
  sendSmartAccountTransaction,
  updateAutopayConfig,
  cancelSubscription,
} from "./lib/smart-account";

export type {
  DeploySmartAccountConfig,
  SmartAccountResult,
  RevokeAutopayConfig,
  SmartAccountTransactionConfig,
  UpdateAutopayConfigInput,
  CancelSubscriptionInput,
} from "./lib/smart-account";
