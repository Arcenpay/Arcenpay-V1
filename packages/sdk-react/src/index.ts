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
  SmartAccountDeploymentInput,
  SmartAccountDeploymentResult,
} from './components/CheckoutModal';
export { SubscriptionStatus } from './components/SubscriptionStatus';
export { FeatureFlagGuard } from './components/FeatureFlagGuard';
export { UsageDashboard } from './components/UsageDashboard';
export { BillingHistory } from './components/BillingHistory';

// Hooks
export { useEntitlement } from './hooks/useEntitlement';
