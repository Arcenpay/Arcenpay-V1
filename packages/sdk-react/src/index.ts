// ============================================================
//  @arcenpay/react — Public API
// ============================================================

// Provider — the single entry point
export { ArcenPayProvider, useArcenPay } from "./providers/ArcenPayProvider";
export type {
  ArcenPayProviderProps,
  ArcenPayContextValue,
  ArcenSessionValue,
  ArcenCompanyIdentity,
  ArcenUserIdentity,
  ArcenIdentifyInput,
} from "./providers/ArcenPayProvider";

// Components — the main embed surface
export { ArcenEmbed, ArcenpayEmbed } from "./components/ArcenEmbed";
export type {
  ArcenEmbedProps,
  ArcenpayEmbedProps,
} from "./components/ArcenEmbed";
export { FeatureFlagGuard } from "./components/FeatureFlagGuard";
export { TemplateRenderer } from "./components/TemplateRenderer";
export type {
  TemplateRendererProps,
  TemplateBlock,
} from "./components/TemplateRenderer";

// Utility called once for convenience
export { renderElement, getDesignTokens } from "./components/ArcenEmbed";
export type { Tokens } from "./components/ArcenEmbed";

// Hooks — for programmatic usage beyond embed components
export { useFlag, useFlags } from "./hooks/useFlag";
export { useCompanyEntitlements } from "./hooks/useCompanyEntitlements";
export type {
  UseCompanyEntitlementsOptions,
  UseCompanyEntitlementsReturn,
} from "./hooks/useCompanyEntitlements";
export { useEntitlement } from "./hooks/useEntitlement";
export {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
} from "./hooks/useEntitlement";
export type { EntitlementErrorCode } from "./hooks/useEntitlement";
export { useConsumeEntitlement } from "./hooks/useConsumeEntitlement";
export { useTrack } from "./hooks/useTrack";
export type { TrackEventInput } from "./hooks/useTrack";
export { useStellarEmbedWallet } from "./hooks/useStellarEmbedWallet";

// Shared public types — re-exported so app developers only need this package
export type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  FlagResult,
  EntitlementResult,
  ConsumeEntitlementResult,
  IdentifyResult,
  Plan,
  InvoiceSummary,
  ComponentRenderData,
  ComponentElement,
  ComponentDesign,
} from "./sdk";
