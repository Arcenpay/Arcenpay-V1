export {
  deploySmartAccount,
  getCounterfactualSmartAccountAddress,
  isSmartAccountInfrastructureError,
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
