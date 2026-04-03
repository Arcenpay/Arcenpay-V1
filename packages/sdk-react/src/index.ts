// ============================================================
//  @arcenpay/react — Main Entry Point
// ============================================================

// Provider
export { MEAPProvider, useMEAP, ArcenPayProvider, useArcenPay, useArcenSession } from './providers/MEAPProvider';
export type { MEAPContextValue, MEAPProviderProps, ArcenPayContextValue, ArcenPayProviderProps, ArcenSessionContextValue } from './providers/MEAPProvider';

// Components
export { PricingTable } from './components/PricingTable';
export { CheckoutModal } from './components/CheckoutModal';
export type {
  CheckoutModalProps,
  CheckoutResult,
  CheckoutErrorCode,
  SmartAccountDeploymentInput,
  SmartAccountDeploymentResult,
} from './components/CheckoutModal';
export {
  CHECKOUT_ERROR_CODES,
  CheckoutFlowError,
} from './components/CheckoutModal';
export { SubscriptionStatus } from './components/SubscriptionStatus';
export { FeatureFlagGuard } from './components/FeatureFlagGuard';
export { UsageDashboard } from './components/UsageDashboard';
export { BillingHistory } from './components/BillingHistory';
export { TemplateRenderer } from './components/TemplateRenderer';
export type { TemplateRendererProps, TemplateBlock } from './components/TemplateRenderer';
export { InvoiceList } from './components/InvoiceList';
export type { InvoiceListProps } from './components/InvoiceList';
export { ArcenEmbed, ArcenpayEmbed } from './components/ArcenEmbed';
export type { ArcenEmbedProps, ArcenpayEmbedProps } from './components/ArcenEmbed';
export { renderElement, getDesignTokens } from './components/ArcenEmbed';
export type { Tokens } from './components/ArcenEmbed';

// Hooks
export { useEntitlement } from './hooks/useEntitlement';
export {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
} from './hooks/useEntitlement';
export type { EntitlementErrorCode } from './hooks/useEntitlement';

export { useEntitlementCheck } from './hooks/useEntitlementCheck';
export type { UseEntitlementCheckReturn, UseEntitlementCheckOptions } from './hooks/useEntitlementCheck';

export { useFlag, useFlags } from './hooks/useFlag';
export type { UseFlagOptions, UseFlagResult } from './hooks/useFlag';

export { useCompanyEntitlements } from './hooks/useCompanyEntitlements';
export type { UseCompanyEntitlementsOptions, UseCompanyEntitlementsReturn } from './hooks/useCompanyEntitlements';

export { useTrack } from './hooks/useTrack';
export type { TrackOptions, TrackEventInput, UseTrackResult } from './hooks/useTrack';

// Utilities
export { deploySmartAccount } from './lib/zerodev';
export { revokeAutopayModule } from './lib/zerodev';
export { sendSmartAccountTransaction } from './lib/zerodev';
export type {
  DeploySmartAccountConfig,
  SmartAccountResult,
  RevokeAutopayConfig,
  SmartAccountTransactionConfig,
} from './lib/zerodev';
