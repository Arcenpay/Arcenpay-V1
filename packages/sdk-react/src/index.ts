// ============================================================
//  @meap/react — Main Entry Point
// ============================================================

// Provider
export { MEAPProvider, useMEAP } from './providers/MEAPProvider';

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

// Web3 SchematicHQ Protocol — Embeddable component
export { ArcenEmbed } from './components/ArcenEmbed';

// Web3 SchematicHQ Protocol — Hooks
export { useFlag, useFlags } from './hooks/useFlag';
export type { UseFlagOptions } from './hooks/useFlag';
export { useTrack } from './hooks/useTrack';
export type { TrackEventInput, TrackOptions } from './hooks/useTrack';

// Hooks
export { useEntitlement } from './hooks/useEntitlement';
export {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
} from './hooks/useEntitlement';
export type { EntitlementErrorCode } from './hooks/useEntitlement';

// Utilities
export { deploySmartAccount } from './lib/zerodev';
export { revokeAutopayModule } from './lib/zerodev';
export type {
  DeploySmartAccountConfig,
  SmartAccountResult,
  RevokeAutopayConfig,
} from './lib/zerodev';
