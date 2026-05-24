/**
 * ArcenEmbed — Self-contained customer billing portal.
 *
 * Handles the full billing lifecycle internally via inline view navigation:
 * portal → checkout → payment → success
 * portal → unsubscribe → portal
 *
 * @example
 * <ArcenEmbed
 *   accessToken={token}
 *   componentId="cmn_xxx"
 * />
 */
"use client";

import React, {
  useEffect,
  useReducer,
  useCallback,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import type {
  ComponentRenderData,
  ComponentElement,
  ComponentUsageItem,
  ComponentEntitlement,
  ComponentPlanSummary,
  ComponentDesign,
  ComponentInvoiceSummary,
  ComponentPaymentMethod,
  ComponentSubscriptionTransition,
} from "../sdk";
import {
  ERC7579AutopayModuleABI,
  getBlockExplorerUrl,
  getChain,
  getConfiguredRuntimeChainId,
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "../sdk";
import {
  getCounterfactualSmartAccountAddress,
  hasSmartAccountInfrastructure,
  isUnsupportedEip7702AuthorizationError,
  sendSmartAccountTransaction,
} from "../lib/smart-account";
import type { SubscriptionCancellationIntent } from "../lib/subscription-lifecycle";
import {
  buildCancellationFeedback,
  buildCancellationRequestBody,
  buildPlanChangeSuccessMessage,
} from "../lib/subscription-lifecycle";
import {
  hasAnnualBillingOption,
  isCurrentBillingSelection,
  matchesPlanBillingPeriod,
  resolveActiveBillingPeriod,
} from "../lib/billing-period";
import {
  encodeAbiParameters,
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  parseAbiParameters,
  type WalletClient,
} from "viem";
import { resolveDashboardBaseUrl } from "../lib/api";
import { useArcenPay } from "../providers/ArcenPayProvider";

export interface ArcenEmbedProps {
  /** Short-lived access token. When omitted, auto-reads from NEXT_PUBLIC_ARCENPAY_ACCESS_TOKEN env var. */
  accessToken?: string;
  /** Component ID from the dashboard. Reads NEXT_PUBLIC_ARCENPAY_COMPONENT_ID env var by default. */
  componentId?: string;
  /** @deprecated Use componentId */
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  mockData?: ComponentRenderData;
  initialView?: PortalView;
  onViewChange?: (view: PortalView) => void;
  onPlanChange?: (planId: string) => void;
  mode?: "inline" | "modal";
}

function isSvgFeatureIcon(icon: string | null | undefined) {
  return Boolean(icon?.trim().startsWith("<svg"));
}

function isNamedFeatureIconToken(icon: string | null | undefined) {
  return Boolean(icon?.startsWith("lucide:") || icon?.startsWith("icon:"));
}

function extractNamedFeatureIconName(token: string): string {
  return token.replace(/^(lucide|icon):/, "");
}

function normalizeNamedFeatureIconName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const aliasMap: Record<string, string> = {
    thunder: "zap",
    lightning: "zap",
    bolt: "zap",
    coin: "circle-dollar-sign",
    coins: "circle-dollar-sign",
    dollar: "circle-dollar-sign",
    money: "circle-dollar-sign",
    bag: "shopping-bag",
    chatbot: "bot",
    ai: "brain",
    doc: "file-text",
    document: "file-text",
    file: "file-text",
    payment: "credit-card",
    billing: "credit-card",
  };

  return aliasMap[normalized] ?? normalized;
}

function renderNamedFeatureIcon(name: string, size: number) {
  const stroke = "currentColor";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (normalizeNamedFeatureIconName(name)) {
    case "rocket":
      return (
        <svg {...common}>
          <path d="M4 20c1.5-3.5 4-5.5 7-6 3-.5 5.5-2.5 7-6l1-3-3 1c-3.5 1.5-5.5 4-6 7-.5 3-2.5 5.5-6 7Z" />
          <path d="M9 15 4 20" />
          <path d="m14 10 0 0" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="m12 3 1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5Z" />
          <path d="m5 14 .8 1.7L7.5 16l-1.7.8L5 18.5l-.8-1.7L2.5 16l1.7-.3Z" />
          <path d="m19 13 .9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9Z" />
        </svg>
      );
    case "brain":
      return (
        <svg {...common}>
          <path d="M9.5 4.5a3 3 0 0 0-5 2.2 3 3 0 0 0 0 5.6A3 3 0 0 0 7.5 17H10V5.5a3 3 0 0 0-.5-1Z" />
          <path d="M14.5 4.5a3 3 0 0 1 5 2.2 3 3 0 0 1 0 5.6 3 3 0 0 1-3 4.7H14V5.5a3 3 0 0 1 .5-1Z" />
          <path d="M10 9H7.5" />
          <path d="M14 9h2.5" />
          <path d="M10 13H8.5" />
          <path d="M14 13h1.5" />
        </svg>
      );
    case "bot":
      return (
        <svg {...common}>
          <rect x="5" y="7" width="14" height="10" rx="3" />
          <path d="M12 4v3" />
          <path d="M9 20v-3" />
          <path d="M15 20v-3" />
          <circle cx="10" cy="12" r="1" />
          <circle cx="14" cy="12" r="1" />
          <path d="M9 15h6" />
        </svg>
      );
    case "shield-check":
      return (
        <svg {...common}>
          <path d="M12 3 6 5.5V11c0 4 2.5 7.2 6 8.5 3.5-1.3 6-4.5 6-8.5V5.5Z" />
          <path d="m9.5 11.5 1.8 1.8 3.2-3.3" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...common}>
          <path d="M4.5 15a7.5 7.5 0 1 1 15 0" />
          <path d="M12 12 16 8" />
          <path d="M12 12 9.5 14.5" />
        </svg>
      );
    case "circle-dollar-sign":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v9" />
          <path d="M14.5 9.5c0-1-1-2-2.5-2s-2.5.8-2.5 2 1 1.8 2.5 2 2.5.9 2.5 2-1 2-2.5 2-2.5-1-2.5-2" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 15.5Z" />
          <path d="M4 9h12" />
          <path d="M16 13h2" />
        </svg>
      );
    case "shopping-bag":
      return (
        <svg {...common}>
          <path d="M6 8h12l-1 10H7L6 8Z" />
          <path d="M9 9V7a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "package":
      return (
        <svg {...common}>
          <path d="m12 3 7 4-7 4-7-4 7-4Z" />
          <path d="M5 7v10l7 4 7-4V7" />
          <path d="M12 11v10" />
        </svg>
      );
    case "gift":
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M12 10v10" />
          <path d="M4 14h16" />
          <path d="M8.5 10c-1.7 0-2.5-.8-2.5-2 0-1.1.8-2 2-2 2 0 4 4 4 4" />
          <path d="M15.5 10c1.7 0 2.5-.8 2.5-2 0-1.1-.8-2-2-2-2 0-4 4-4 4" />
        </svg>
      );
    case "megaphone":
      return (
        <svg {...common}>
          <path d="M4 12v-2l9-4v10l-9-4Z" />
          <path d="M13 8h3a3 3 0 0 1 0 6h-3" />
          <path d="m6 15 1.5 4" />
        </svg>
      );
    case "message-square":
      return (
        <svg {...common}>
          <path d="M6 6h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3v-3H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        </svg>
      );
    case "panel-left":
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      );
    case "server-cog":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="12" height="5" rx="1.5" />
          <rect x="4" y="14" width="12" height="5" rx="1.5" />
          <circle cx="18" cy="9" r="2" />
          <circle cx="18" cy="16" r="2" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.5 2.5 4 5.3 4 8.5s-1.5 6-4 8.5c-2.5-2.5-4-5.3-4-8.5s1.5-6 4-8.5Z" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <path d="M6 8h2l1.5-2h5L16 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <rect x="4" y="7" width="11" height="10" rx="2" />
          <path d="m15 10 5-2.5v9L15 14" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.2-4.2" />
        </svg>
      );
    case "link-2":
      return (
        <svg {...common}>
          <path d="M10 13a3 3 0 0 0 4.2 0l2.8-2.8a3 3 0 1 0-4.2-4.2L11 7" />
          <path d="M14 11a3 3 0 0 0-4.2 0L7 13.8A3 3 0 0 0 11.2 18L13 16.2" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="m12 4 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </svg>
      );
    case "zap":
      return (
        <svg {...common}>
          <path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="m7 4-4 6 9 10 9-10-4-6Z" />
          <path d="M7 4h10" />
          <path d="m9.5 4 2.5 16 2.5-16" />
        </svg>
      );
    case "puzzle":
      return (
        <svg {...common}>
          <path d="M9 5a2 2 0 1 1 4 0v1h3a2 2 0 0 1 2 2v3h-1a2 2 0 1 0 0 4h1v3a2 2 0 0 1-2 2h-3v-1a2 2 0 1 0-4 0v1H6a2 2 0 0 1-2-2v-3h1a2 2 0 1 0 0-4H4V8a2 2 0 0 1 2-2h3Z" />
        </svg>
      );
    case "file-text":
      return (
        <svg {...common}>
          <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
          <path d="M14 3.5V8h4" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "credit-card":
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="M3.5 10h17" />
          <path d="M7 14h3" />
        </svg>
      );
    default:
      return null;
  }
}

function NamedFeatureIcon({
  iconToken,
  size,
}: {
  iconToken: string;
  size: number;
}) {
  const [IconComponent, setIconComponent] =
    useState<React.ElementType | null>(null);
  const normalizedName = normalizeNamedFeatureIconName(
    extractNamedFeatureIconName(iconToken),
  );

  useEffect(() => {
    let active = true;
    const loader =
      dynamicIconImports[
        normalizedName as keyof typeof dynamicIconImports
      ];

    if (!loader) {
      setIconComponent(null);
      return () => {
        active = false;
      };
    }

    void loader()
      .then((mod) => {
        if (active) setIconComponent(() => mod.default);
      })
      .catch(() => {
        if (active) setIconComponent(null);
      });

    return () => {
      active = false;
    };
  }, [normalizedName]);

  if (IconComponent) {
    return (
      <IconComponent
        width={size}
        height={size}
        strokeWidth={1.8}
        aria-hidden
      />
    );
  }

  const fallback = renderNamedFeatureIcon(normalizedName, size);
  if (fallback) return fallback;

  const initial = normalizedName.charAt(0).toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#e5e7eb",
        color: "#6b7280",
        fontSize: size * 0.45,
        fontWeight: 700,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  );
}

/**
 * Lightweight feature icon renderer.
 * SVG icons rendered raw, icon-name tokens render internal lightweight SVGs,
 * and emoji/custom glyphs render as text.
 */
function renderFeatureIconNode(
  icon: string | null | undefined,
  size: number = 16,
) {
  if (!icon) return null;

  if (isNamedFeatureIconToken(icon)) {
    return <NamedFeatureIcon iconToken={icon} size={size} />;
  }

  if (isSvgFeatureIcon(icon)) {
    return (
      <span
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
        }}
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    );
  }

  return <span style={{ fontSize: size }}>{icon}</span>;
}

type PortalView = "portal" | "checkout" | "payment" | "unsubscribe" | "success";

type AppliedCouponQuote = {
  code: string;
  description: string | null;
  discount: number;
  planId: string;
  billingPeriod: "monthly" | "annual";
  baseAmountMicros: number;
  discountedAmountMicros: number;
};

type PlanChangeConfirmation = {
  txHash?: string;
  autopayConfigTxHash?: string;
  accessChangeTxHash?: string;
  paymentTxHash?: string;
  prorationEffectiveAt?: string;
};

type CancellationConfirmation = {
  intent: SubscriptionCancellationIntent;
  txHash?: string;
};

type PlanChangeProrationSummary = {
  currency: string;
  currentPlanName: string;
  targetPlanName: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  effectiveAt: string;
  totalPeriodSeconds: number;
  remainingSeconds: number;
  remainingRatio: number;
  newPlanRemainingCharge: string;
  unusedOldPlanCredit: string;
  amountDueBeforeCredits?: string;
  availableBillingCredit?: string;
  billingCreditApplied?: string;
  remainingBillingCredit?: string;
  creditCreated?: string;
  amountDue: string;
  amountPaid: string;
  amountRemaining: string;
};

type PlanChangePreviewResponse = {
  data?: {
    mode?: string;
    proration?: PlanChangeProrationSummary;
  };
  error?: string;
};

const AUTOPAY_START_TIME_BUFFER_SECONDS = 20;

interface PortalState {
  data: ComponentRenderData | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  view: PortalView;
  selectedPlanId: string | null;
  billingPeriod: "monthly" | "annual";
  processing: boolean;
  flashMsg: string | null;
  successMsg: string | null;
  successTxHash: string | null;
}

type PortalAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_OK"; data: ComponentRenderData }
  | { type: "FETCH_ERR"; error: string }
  | { type: "OPEN_CHECKOUT" }
  | { type: "OPEN_UNSUBSCRIBE" }
  | { type: "OPEN_PAYMENT" }
  | { type: "GOTO_PORTAL"; flashMsg?: string }
  | { type: "GOTO_SUCCESS"; successMsg: string; txHash?: string }
  | { type: "SELECT_PLAN"; planId: string }
  | { type: "SET_BILLING_PERIOD"; period: "monthly" | "annual" }
  | { type: "PROCESSING_START" }
  | { type: "PROCESSING_DONE"; flashMsg?: string }
  | { type: "PROCESSING_ERR"; error: string };

const initialState: PortalState = {
  data: null,
  loading: true,
  error: null,
  actionError: null,
  view: "portal",
  selectedPlanId: null,
  billingPeriod: "monthly",
  processing: false,
  flashMsg: null,
  successMsg: null,
  successTxHash: null,
};

function reducer(state: PortalState, action: PortalAction): PortalState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, loading: true, error: null, actionError: null };
    case "FETCH_OK":
      return {
        ...state,
        error: null,
        actionError: null,
        loading: false,
        data: action.data,
        view: "portal",
        billingPeriod: resolveActiveBillingPeriod({
          billingPeriod: action.data.billingPeriod,
          activePlan: action.data.activePlan,
        }),
        processing: false,
        flashMsg: null,
      };
    case "FETCH_ERR":
      return { ...state, loading: false, error: action.error, actionError: null };
    case "OPEN_CHECKOUT":
      return {
        ...state,
        actionError: null,
        view: "checkout",
        selectedPlanId: state.data?.activePlan?.id ?? null,
        billingPeriod: resolveActiveBillingPeriod({
          billingPeriod: state.data?.billingPeriod,
          activePlan: state.data?.activePlan,
        }),
      };
    case "OPEN_UNSUBSCRIBE":
      return { ...state, view: "unsubscribe", actionError: null };
    case "OPEN_PAYMENT":
      return { ...state, view: "payment", actionError: null };
    case "GOTO_PORTAL":
      return {
        ...state,
        view: "portal",
        selectedPlanId: null,
        flashMsg: action.flashMsg ?? null,
        actionError: null,
      };
    case "GOTO_SUCCESS":
      return {
        ...state,
        view: "success",
        processing: false,
        actionError: null,
        successMsg: action.successMsg,
        successTxHash: action.txHash ?? null,
      };
    case "SELECT_PLAN":
      return { ...state, selectedPlanId: action.planId, actionError: null };
    case "SET_BILLING_PERIOD":
      return {
        ...state,
        actionError: null,
        billingPeriod: action.period,
        selectedPlanId: state.data
          ? resolvePlanSelectionForBillingPeriod({
              plans: state.data.plans,
              selectedPlanId: state.selectedPlanId,
              billingPeriod: action.period,
            })
          : state.selectedPlanId,
      };
    case "PROCESSING_START":
      return { ...state, processing: true, actionError: null };
    case "PROCESSING_DONE":
      return {
        ...state,
        processing: false,
        view: "portal",
        flashMsg: action.flashMsg ?? null,
        actionError: null,
      };
    case "PROCESSING_ERR":
      return { ...state, processing: false, actionError: action.error };
    default:
      return state;
  }
}

// ─── Design helpers ───────────────────────────────────────────────────────────

export function getDesignTokens(design: ComponentDesign) {
  const primary = design.primaryColor ?? "#000000";
  const font = design.fontFamily ?? "system-ui, -apple-system, sans-serif";
  const parsedSize = parseFloat(String(design.fontSize ?? "14"));
  const size =
    typeof design.fontSize === "number"
      ? design.fontSize
      : Number.isNaN(parsedSize)
        ? 14
        : parsedSize;
  const textColor = design.fontColor ?? "#111827";
  const bg = design.backgroundColor ?? "#ffffff";
  const parsedRadius = parseFloat(String(design.borderRadius ?? "8"));
  const radius =
    typeof design.borderRadius === "number"
      ? design.borderRadius
      : Number.isNaN(parsedRadius)
        ? 8
        : parsedRadius;
  const cardStyle =
    ((design as Record<string, unknown>).cardStyle as string | undefined) ??
    "minimal";
  const cardBorder =
    cardStyle === "bordered"
      ? `1px solid #e5e7eb`
      : cardStyle === "elevated"
        ? "none"
        : `1px solid #f0f0f0`;
  const cardShadow =
    cardStyle === "elevated" ? "0 2px 12px rgba(0,0,0,0.08)" : "none";
  const mutedColor = blendToward(textColor, bg, 0.55);
  const columns = typeof design.columns === "number" ? design.columns : 1;
  const sections: "merged" | "separate" =
    design.sections === "merged" ? "merged" : "separate";
  return {
    primary,
    font,
    size,
    textColor,
    bg,
    radius,
    cardBorder,
    cardShadow,
    mutedColor,
    columns,
    sections,
  };
}

type Tokens = ReturnType<typeof getDesignTokens>;

function blendToward(hex1: string, hex2: string, ratio: number): string {
  try {
    const parse = (h: string) => {
      const c = h.replace("#", "");
      const full =
        c.length === 3
          ? c
              .split("")
              .map((x) => x + x)
              .join("")
          : c;
      return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
      ];
    };
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    return `rgb(${Math.round(r1 + (r2 - r1) * ratio)},${Math.round(g1 + (g2 - g1) * ratio)},${Math.round(b1 + (b2 - b1) * ratio)})`;
  } catch {
    return hex1;
  }
}

function isLightColor(hex: string): boolean {
  try {
    const c = hex.replace("#", "");
    const full =
      c.length === 3
        ? c
            .split("")
            .map((x) => x + x)
            .join("")
        : c;
    const [r, g, b] = [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  } catch {
    return false;
  }
}

function intervalLabel(billingInterval: number): string {
  if (billingInterval === 2592000) return "/mo";
  if (billingInterval === 7776000) return "/qtr";
  if (billingInterval === 31536000) return "/yr";
  return "";
}

function billingPeriodUnit(billingPeriod: "monthly" | "annual"): "mo" | "yr" {
  return billingPeriod === "annual" ? "yr" : "mo";
}

function billingPeriodWord(
  billingPeriod: "monthly" | "annual",
): "month" | "year" {
  return billingPeriod === "annual" ? "year" : "month";
}

function normalizeCustomerEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isValidCustomerEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeCustomerEmail(value));
}

function fmtPrice(price: string | number, billingInterval?: number): string {
  const p = parseFloat(String(price));
  if (p === 0) return "Free";
  const interval =
    billingInterval !== undefined ? intervalLabel(billingInterval) : "";
  return `$${p.toFixed(2)}${interval}`;
}

function parseDecimalToAtomicUnits(value: string, decimals = 6): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = `${fraction}${"0".repeat(decimals)}`.slice(
    0,
    decimals,
  );
  return (
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0")
  );
}

function formatUsdFromDecimalString(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatDateLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1) return `in ${diffDays} days`;
  if (diffDays === -1) return "yesterday";
  return `${Math.abs(diffDays)} days ago`;
}

function truncateWallet(wallet?: string | null): string | null {
  if (!wallet) return null;
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

const STABLECOIN_TO_ISO: Record<string, string> = {
  USDC: "USD",
  USDT: "USD",
  DAI: "USD",
  BUSD: "USD",
  GUSD: "USD",
  USDP: "USD",
  TUSD: "USD",
  FRAX: "USD",
  LUSD: "USD",
  SUSD: "USD",
  EURC: "EUR",
  EURT: "EUR",
};

function toISOCurrencyCode(currency: string | undefined | null): string {
  if (!currency) return "USD";
  return STABLECOIN_TO_ISO[currency.toUpperCase()] ?? currency.toUpperCase();
}

function formatMoney(amount: string | number, currency = "USD"): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return String(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: toISOCurrencyCode(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatChainLabel(chainId?: number | null): string | null {
  if (!chainId) return null;
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  if (chainId === 5042002) return "Arc Testnet";
  return `Chain ${chainId}`;
}

function getUsageItems(data: ComponentRenderData): ComponentUsageItem[] {
  const usageMap = new Map<string, ComponentUsageItem>();

  data.usage.forEach((item) => {
    usageMap.set(item.featureKey, item);
  });

  data.entitlements
    .filter((entitlement) => entitlement.featureType === "event_based")
    .forEach((entitlement) => {
      const existing = usageMap.get(entitlement.featureKey);
      usageMap.set(entitlement.featureKey, {
        featureKey: entitlement.featureKey,
        name: existing?.name ?? entitlement.name,
        used: existing?.used ?? entitlement.usage ?? 0,
        limit: existing?.limit ?? entitlement.limit,
        unitSingular:
          existing?.unitSingular ?? entitlement.unitSingular ?? null,
        unitPlural: existing?.unitPlural ?? entitlement.unitPlural ?? null,
        icon: existing?.icon ?? entitlement.icon ?? null,
      });
    });

  return Array.from(usageMap.values());
}

function getSubscriptionTransition(
  data: ComponentRenderData,
): ComponentSubscriptionTransition | null {
  const transition = data.subscriptionTransition;
  if (!transition || typeof transition !== "object") return null;
  return transition;
}

function getScheduledCancellationTransition(
  data: ComponentRenderData,
): ComponentSubscriptionTransition | null {
  const transition = getSubscriptionTransition(data);
  const isCancellation =
    transition?.changeType === "cancellation" ||
    transition?.mode === "cancel_at_period_end" ||
    transition?.mode === "cancel_at_period_end_pending_verification";
  if (
    !isCancellation ||
    transition?.stage === "applied" ||
    transition?.stage === "failed" ||
    transition?.stage === "reverted"
  ) {
    return null;
  }
  return transition;
}

function isOpenTransitionStage(
  transition: ComponentSubscriptionTransition | null | undefined,
): boolean {
  if (!transition) return false;
  return (
    transition.stage === "requested" ||
    transition.stage === "pending_verification" ||
    transition.stage === "pending_recovery"
  );
}

function matchesTransitionTarget(input: {
  transition: ComponentSubscriptionTransition | null | undefined;
  planId: string | null;
  billingPeriod: "monthly" | "annual";
}): boolean {
  if (!input.transition || !input.planId) return false;
  if (!isOpenTransitionStage(input.transition)) return false;
  if (input.transition.changeType === "cancellation") return false;
  if (input.transition.targetPlanId !== input.planId) return false;
  return (
    !input.transition.targetBillingPeriod ||
    input.transition.targetBillingPeriod === input.billingPeriod
  );
}

function isBillingPeriodOnlyTransition(input: {
  transition: ComponentSubscriptionTransition | null | undefined;
  activePlanId?: string | null;
}): boolean {
  const transition = input.transition;
  if (!transition || !isOpenTransitionStage(transition)) return false;
  const previousBillingPeriod = transition.previousBillingPeriod ?? null;
  const targetBillingPeriod = transition.targetBillingPeriod ?? null;
  if (
    !previousBillingPeriod ||
    !targetBillingPeriod ||
    previousBillingPeriod === targetBillingPeriod
  ) {
    return false;
  }

  const activePlanId = input.activePlanId ?? null;
  return (
    transition.changeType === "billing_period_change" ||
    (Boolean(activePlanId) && transition.targetPlanId === activePlanId)
  );
}

function billingPeriodDisplayName(
  billingPeriod: "monthly" | "annual" | null | undefined,
): string {
  return billingPeriod === "annual" ? "yearly" : "monthly";
}

function getLifecycleNote(
  data: ComponentRenderData,
): string | null {
  const transition = getSubscriptionTransition(data);
  if (!transition || !isOpenTransitionStage(transition)) return null;

  const effectiveAtLabel = formatDateLabel(transition.effectiveAt);
  const isBillingScheduleChange = isBillingPeriodOnlyTransition({
    transition,
    activePlanId: data.activePlan?.id ?? null,
  });

  if (transition.pendingRecovery || transition.stage === "pending_recovery") {
    return "The subscription change has been submitted, and ArcenPay is finishing the recovery steps now.";
  }

  if (isBillingScheduleChange) {
    const targetBillingLabel = billingPeriodDisplayName(
      transition.targetBillingPeriod,
    );
    if (
      transition.pendingVerification ||
      transition.stage === "pending_verification"
    ) {
      return effectiveAtLabel
        ? `Billing schedule change submitted. We are still waiting for on-chain confirmation before renewals switch to ${targetBillingLabel} billing on ${effectiveAtLabel}.`
        : `Billing schedule change submitted. We are still waiting for on-chain confirmation before renewals switch to ${targetBillingLabel} billing.`;
    }
    return effectiveAtLabel
      ? `Your current billing cycle stays active until ${effectiveAtLabel}. Renewals switch to ${targetBillingLabel} billing on that date.`
      : `Your current billing cycle stays active until the current period ends. Renewals switch to ${targetBillingLabel} billing after that.`;
  }

  if (transition.changeType === "downgrade") {
    if (transition.pendingVerification || transition.stage === "pending_verification") {
      return effectiveAtLabel
        ? `Downgrade is scheduled for ${effectiveAtLabel}. We are still waiting for the chain confirmation that locks in the next renewal settings.`
        : "Downgrade is scheduled. We are still waiting for the chain confirmation that locks in the next renewal settings.";
    }
    return effectiveAtLabel
      ? `Your current plan stays active until ${effectiveAtLabel}. After that, renewals switch automatically to the lower plan and price.`
      : "Your current plan stays active until the current billing period ends. After that, renewals switch automatically to the lower plan and price.";
  }

  if (transition.changeType === "cancellation") {
    return effectiveAtLabel
      ? `Cancellation is scheduled for ${effectiveAtLabel}. Your current plan stays active until then.`
      : "Cancellation is scheduled. Your current plan stays active until the current billing period ends.";
  }

  if (transition.pendingVerification || transition.stage === "pending_verification") {
    return "We are waiting for on-chain confirmations before finalizing this subscription change.";
  }

  return null;
}

function getLifecycleBadge(
  data: ComponentRenderData,
): { label: string; background: string; color: string } {
  const transition = getSubscriptionTransition(data);
  if (!transition) {
    return {
      label: "Active",
      background: "#dcfce7",
      color: "#15803d",
    };
  }

  if (
    isBillingPeriodOnlyTransition({
      transition,
      activePlanId: data.activePlan?.id ?? null,
    }) &&
    transition.stage !== "pending_recovery"
  ) {
    return {
      label: "Billing change scheduled",
      background: "#dbeafe",
      color: "#1d4ed8",
    };
  }

  if (
    transition.changeType === "downgrade" &&
    isOpenTransitionStage(transition) &&
    transition.stage !== "pending_recovery"
  ) {
    return {
      label: "Downgrade scheduled",
      background: "#fef3c7",
      color: "#a16207",
    };
  }

  if (
    transition.changeType === "cancellation" &&
    isOpenTransitionStage(transition) &&
    transition.stage !== "pending_recovery"
  ) {
    return {
      label: "Cancellation scheduled",
      background: "#fff7ed",
      color: "#c2410c",
    };
  }

  if (transition.pendingRecovery || transition.stage === "pending_recovery") {
    return {
      label: "Pending recovery",
      background: "#dbeafe",
      color: "#1d4ed8",
    };
  }

  if (
    transition.pendingVerification ||
    transition.stage === "pending_verification"
  ) {
    return {
      label: "Pending verification",
      background: "#fff7ed",
      color: "#c2410c",
    };
  }

  return {
    label: "Active",
    background: "#dcfce7",
    color: "#15803d",
  };
}

type ResolvedBooleanFeature = {
  featureKey: string;
  name: string;
  value: true;
  featureType: "boolean";
  icon?: string | null;
};

function getActivePlanBooleanFeatures(
  data: ComponentRenderData,
): ResolvedBooleanFeature[] {
  const entitlements = data.entitlements as Array<
    ComponentEntitlement & { featureType?: string }
  >;
  const activePlanId =
    typeof data.activePlan?.id === "string" ? data.activePlan.id : null;
  const matchedPlan = activePlanId
    ? data.plans.find((plan) => plan.id === activePlanId)
    : null;
  const metadataSource = ((
    matchedPlan as { metadata?: unknown } | null | undefined
  )?.metadata ??
    (data.activePlan as { metadata?: unknown } | null | undefined)?.metadata ??
    null) as Record<string, unknown> | null;

  if (metadataSource && typeof metadataSource === "object") {
    const rawEntitlements = Array.isArray(metadataSource.entitlements)
      ? metadataSource.entitlements
      : [];

    const metadataBooleanFeatures = rawEntitlements
      .filter(
        (
          entry,
        ): entry is {
          featureKey: string;
          featureName?: string;
          type?: string;
          enabled?: boolean;
          icon?: string | null;
        } =>
          Boolean(
            entry &&
            typeof entry === "object" &&
            typeof (entry as { featureKey?: unknown }).featureKey === "string",
          ),
      )
      .filter(
        (entry) =>
          entry.enabled === true && (!entry.type || entry.type === "BOOLEAN"),
      )
      .map((entry) => ({
        featureKey: entry.featureKey,
        name: entry.featureName ?? entry.featureKey,
        value: true as const,
        featureType: "boolean" as const,
        icon: entry.icon ?? null,
      }));

    return metadataBooleanFeatures;
  }

  return entitlements
    .filter(
      (entry) =>
        (!entry.featureType || entry.featureType === "boolean") &&
        (entry.value === true || entry.value === "true"),
    )
    .map((entry) => ({
      featureKey: entry.featureKey,
      name: entry.name ?? entry.featureKey,
      value: true as const,
      featureType: "boolean" as const,
      icon: entry.icon ?? null,
    }));
}

function formatUsageSummary(item: ComponentUsageItem): string {
  const unitLabel = item.unitPlural ?? item.unitSingular ?? "uses";
  if (typeof item.limit === "number") {
    return `${item.used.toLocaleString()} / ${item.limit.toLocaleString()} ${unitLabel}`;
  }
  return `${item.used.toLocaleString()} ${unitLabel}`;
}

function renderUsageCards(
  data: ComponentRenderData,
  tokens: Tokens,
): React.ReactNode {
  const usageItems = getUsageItems(data);

  if (usageItems.length === 0) {
    return (
      <div style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}>
        No usage limits have been configured for this plan yet.
      </div>
    );
  }

  return usageItems.map((item, index) => {
    const pct =
      typeof item.limit === "number" && item.limit > 0
        ? Math.min((item.used / item.limit) * 100, 100)
        : 0;
    const barColor =
      pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : tokens.primary;

    return (
      <div
        key={item.featureKey}
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: tokens.radius,
          padding: 16,
          marginBottom: index < usageItems.length - 1 ? 10 : 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <FeatureIcon size={36}>
            {renderFeatureIconNode(item.icon, 18) || CHART_ICON}
          </FeatureIcon>
          <div>
            <div
              style={{
                fontSize: tokens.size,
                fontWeight: 600,
                color: tokens.textColor,
              }}
            >
              {item.name}
            </div>
            <div
              style={{
                fontSize: tokens.size - 2,
                color: tokens.mutedColor,
              }}
            >
              {formatUsageSummary(item)}
            </div>
          </div>
        </div>
        {typeof item.limit === "number" && (
          <div
            style={{
              height: 6,
              background: "#f3f4f6",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                height: 6,
                width: `${pct}%`,
                background: barColor,
                borderRadius: 999,
                transition: "width 0.4s",
              }}
            />
          </div>
        )}
      </div>
    );
  });
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

// Tokens type alias re-exported for dashboard use
export type { Tokens };

function SectionHeading({
  children,
  tokens,
}: {
  children: React.ReactNode;
  tokens: Tokens;
}) {
  return (
    <h3
      style={{
        margin: "0 0 12px 0",
        fontSize: tokens.size + 2,
        fontWeight: 700,
        color: tokens.textColor,
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h3>
  );
}

function Card({
  children,
  tokens,
  style,
}: {
  children: React.ReactNode;
  tokens: Tokens;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        background: tokens.bg,
        border: tokens.cardBorder,
        borderRadius: tokens.radius,
        boxShadow: tokens.cardShadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  fullWidth,
  tokens,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  tokens: Tokens;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: fullWidth ? "100%" : "auto",
        padding: "9px 20px",
        background: disabled ? "#d1d5db" : tokens.primary,
        color: disabled
          ? "#9ca3af"
          : isLightColor(tokens.primary)
            ? "#000"
            : "#fff",
        border: "none",
        borderRadius: tokens.radius / 1.5,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: tokens.size - 1,
        fontWeight: 600,
        transition: "opacity 0.15s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  tokens,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tokens: Tokens;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "9px 20px",
        background: "transparent",
        color: tokens.textColor,
        border: `1px solid #d1d5db`,
        borderRadius: tokens.radius / 1.5,
        cursor: "pointer",
        fontSize: tokens.size - 1,
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function WalletSelector({
  tokens,
  connecting,
  onConnectMetaMask,
  onConnectBase,
}: {
  tokens: Tokens;
  connecting: boolean;
  onConnectMetaMask: () => void;
  onConnectBase: () => void;
}) {
  if (connecting) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <PrimaryButton tokens={tokens} fullWidth disabled>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 14,
                border: "2px solid #9ca3af",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "arcenSpin 0.6s linear infinite",
              }}
            />
            Connecting…
          </div>
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        onClick={onConnectMetaMask}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "12px 16px",
          background: "#fff",
          border: "2px solid #e5e7eb",
          borderRadius: 10,
          cursor: "pointer",
          transition: "border-color 0.15s, box-shadow 0.15s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#f5841f";
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(245,132,31,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#e5e7eb";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "#fff7ed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
            alt="MetaMask"
            style={{ width: 28, height: 28 }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: tokens.size - 1,
              color: tokens.textColor,
            }}
          >
            MetaMask
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.mutedColor,
              marginTop: 2,
            }}
          >
            Brave, Rabby, and any Ethereum-compatible wallet
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ flexShrink: 0, opacity: 0.4 }}
        >
          <path
            d="M6 4L10 8L6 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        onClick={onConnectBase}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "12px 16px",
          background: "#fff",
          border: "2px solid #e5e7eb",
          borderRadius: 10,
          cursor: "pointer",
          transition: "border-color 0.15s, box-shadow 0.15s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#0052ff";
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,82,255,0.12)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#e5e7eb";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "#eff6ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src="https://raw.githubusercontent.com/base/brand-kit/refs/heads/main/logo/Logotype/Digital/Base_lockup_2color.svg"
            alt="Base"
            style={{ width: 32, height: 18 }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: tokens.size - 1,
              color: tokens.textColor,
            }}
          >
            Base
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.mutedColor,
              marginTop: 2,
            }}
          >
            Coinbase Wallet & Base chain
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ flexShrink: 0, opacity: 0.4 }}
        >
          <path
            d="M6 4L10 8L6 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function NoWalletSelector({ tokens }: { tokens: Tokens }) {
  const cbWalletDeepLink =
    typeof window !== "undefined"
      ? "https://go.cb-w.com/dapp?cb_url=" +
        encodeURIComponent(window.location.href)
      : "https://www.coinbase.com/wallet";

  return (
    <div
      style={{
        padding: "14px 16px",
        background: "#fef9c3",
        border: "1px solid #fde68a",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: tokens.size - 1,
          color: "#92400e",
          marginBottom: 8,
        }}
      >
        No wallet found
      </div>
      <div
        style={{
          fontSize: tokens.size - 2,
          color: "#78350f",
          lineHeight: 1.6,
          marginBottom: 10,
        }}
      >
        Install one of these wallets to connect:
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#fff",
            border: "1px solid #fde68a",
            borderRadius: 8,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
            alt="MetaMask"
            style={{ width: 22, height: 22 }}
          />
          <span
            style={{
              fontSize: tokens.size - 2,
              fontWeight: 600,
              color: "#92400e",
            }}
          >
            Install MetaMask
          </span>
        </a>
        <a
          href="https://chromewebstore.google.com/detail/coinbase-wallet-extension/hnfanknocfeofbddgcijnmhnfnkdnaad"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#fff",
            border: "1px solid #fde68a",
            borderRadius: 8,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          <img
            src="https://raw.githubusercontent.com/base/brand-kit/refs/heads/main/logo/Logotype/Digital/Base_lockup_2color.svg"
            alt="Base"
            style={{ width: 26, height: 14 }}
          />
          <span
            style={{
              fontSize: tokens.size - 2,
              fontWeight: 600,
              color: "#92400e",
            }}
          >
            Install Coinbase Wallet
          </span>
        </a>
        <a
          href={cbWalletDeepLink}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#fff",
            border: "1px solid #fde68a",
            borderRadius: 8,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="6"
              width="16"
              height="10"
              rx="2"
              stroke="#0052ff"
              strokeWidth="1.5"
            />
            <rect
              x="7"
              y="2"
              width="8"
              height="5"
              rx="1.5"
              stroke="#0052ff"
              strokeWidth="1.5"
            />
          </svg>
          <span
            style={{
              fontSize: tokens.size - 2,
              fontWeight: 600,
              color: "#0052ff",
            }}
          >
            Open Coinbase Wallet app
          </span>
        </a>
      </div>
    </div>
  );
}

function MeteredBar({
  item,
  tokens,
}: {
  item: ComponentUsageItem;
  tokens: Tokens;
}) {
  const pct = item.limit ? Math.min((item.used / item.limit) * 100, 100) : 0;
  const barColor =
    pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : tokens.primary;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 5,
          fontSize: tokens.size - 1,
        }}
      >
        <span style={{ fontWeight: 500, color: tokens.textColor }}>
          {item.name}
        </span>
        <span style={{ color: tokens.mutedColor }}>
          {item.used.toLocaleString()}
          {item.limit ? ` / ${item.limit.toLocaleString()}` : ""}{" "}
          {item.unitPlural ?? item.unitSingular ?? "uses"}
        </span>
      </div>
      {item.limit ? (
        <div style={{ height: 6, background: "#f3f4f6", borderRadius: 999 }}>
          <div
            style={{
              height: 6,
              width: `${pct}%`,
              background: barColor,
              borderRadius: 999,
              transition: "width 0.4s ease",
            }}
          />
        </div>
      ) : (
        <div style={{ fontSize: tokens.size - 2, color: tokens.mutedColor }}>
          Unlimited
        </div>
      )}
    </div>
  );
}

// ─── Step dot for navigation header ──────────────────────────────────────────

function StepDot({
  active,
  done,
  label,
  tokens,
}: {
  active: boolean;
  done: boolean;
  label: string;
  tokens: Tokens;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: done ? "#16a34a" : active ? tokens.primary : "#e5e7eb",
          color:
            done || active
              ? isLightColor(done ? "#16a34a" : tokens.primary)
                ? "#000"
                : "#fff"
              : "#9ca3af",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {done ? "✓" : active ? "●" : "○"}
      </div>
      <span
        style={{
          fontSize: 10,
          color: active ? tokens.textColor : tokens.mutedColor,
          fontWeight: active ? 600 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── View navigation header ───────────────────────────────────────────────────

function ViewHeader({
  title,
  onBack,
  step,
  tokens,
}: {
  title: string;
  onBack: () => void;
  step?: number;
  tokens: Tokens;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 24,
        paddingBottom: 16,
        borderBottom: `1px solid #f0f0f0`,
      }}
    >
      <button
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: tokens.mutedColor,
          fontSize: 22,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ←
      </button>
      <span
        style={{
          fontWeight: 700,
          fontSize: tokens.size + 2,
          color: tokens.textColor,
        }}
      >
        {title}
      </span>
      {step !== undefined && (
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <StepDot
            active={step >= 1}
            done={step > 1}
            label="Plan"
            tokens={tokens}
          />
          <div style={{ width: 20, height: 1, background: "#e5e7eb" }} />
          <StepDot
            active={step >= 2}
            done={false}
            label="Payment"
            tokens={tokens}
          />
        </div>
      )}
    </div>
  );
}

// ─── Safe wagmi hooks (avoids crash if wagmi not installed) ───────────────────

function useSafeAccount(): {
  address: string | undefined;
  isConnected: boolean;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wagmi = require("wagmi");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return wagmi.useAccount();
  } catch {
    return { address: undefined, isConnected: false };
  }
}

function useSafeWalletClient(): { walletClient: WalletClient | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wagmi = require("wagmi");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = wagmi.useWalletClient();
    return { walletClient: (data as WalletClient | undefined) ?? null };
  } catch {
    return { walletClient: null };
  }
}

function useRuntimeChainId(): number {
  try {
    return useArcenPay().network.chainId;
  } catch {
    return getConfiguredRuntimeChainId();
  }
}

function getPlanDisplayPrice(
  plan: ComponentPlanSummary | null | undefined,
  billingPeriod: "monthly" | "annual",
): number {
  if (!plan) return 0;
  const monthly = parseFloat(String(plan.price));
  const annual = plan.annualPrice ? parseFloat(String(plan.annualPrice)) : 0;
  if (
    billingPeriod === "annual" &&
    annual <= 0 &&
    plan.billingInterval >= 31_536_000
  ) {
    return monthly;
  }
  return billingPeriod === "annual" && annual > 0 ? annual : monthly;
}

function getPlanDisplayIntervalLabel(
  plan: ComponentPlanSummary | null | undefined,
  billingPeriod: "monthly" | "annual",
): string {
  if (!plan) return "";
  if (billingPeriod === "annual") return "/yr";
  return intervalLabel(plan.billingInterval);
}

function findSiblingPlanForBillingPeriod(input: {
  plans: ComponentPlanSummary[];
  plan: ComponentPlanSummary | null | undefined;
  billingPeriod: "monthly" | "annual";
}): ComponentPlanSummary | null {
  const { plans, plan, billingPeriod } = input;
  if (!plan) return null;
  if (matchesPlanBillingPeriod(plan, billingPeriod)) {
    return plan;
  }

  const normalizedName = plan.name.trim().toLowerCase();
  const normalizedTier = plan.tier.trim().toLowerCase();

  return (
    plans.find(
      (candidate) =>
        candidate.id !== plan.id &&
        candidate.name.trim().toLowerCase() === normalizedName &&
        candidate.tier.trim().toLowerCase() === normalizedTier &&
        matchesPlanBillingPeriod(candidate, billingPeriod),
    ) ?? null
  );
}

function resolvePlanSelectionForBillingPeriod(input: {
  plans: ComponentPlanSummary[];
  selectedPlanId: string | null;
  billingPeriod: "monthly" | "annual";
}): string | null {
  if (!input.selectedPlanId) return null;
  const selectedPlan =
    input.plans.find((plan) => plan.id === input.selectedPlanId) ?? null;
  const sibling = findSiblingPlanForBillingPeriod({
    plans: input.plans,
    plan: selectedPlan,
    billingPeriod: input.billingPeriod,
  });
  return sibling?.id ?? input.selectedPlanId;
}

function isUnsupportedOnChainAnnualSelection(
  plan: ComponentPlanSummary | null | undefined,
  billingPeriod: "monthly" | "annual",
): boolean {
  if (!plan?.onChainPlanId || billingPeriod !== "annual") {
    return false;
  }

  // Allow annual billing if the plan has an annualPrice configured
  // OR if its native billingInterval is already annual.
  if (hasAnnualBillingOption(plan)) return false;

  return typeof plan.billingInterval === "number"
    ? plan.billingInterval < 31_536_000
    : true;
}

function resolveOnChainAutopayConfigForBillingPeriod(input: {
  selectedPlan: ComponentPlanSummary | null | undefined;
  targetPlan: {
    price?: bigint;
    billingInterval?: number;
  };
  billingPeriod: "monthly" | "annual";
}): { chargeAmount: bigint; interval: number } {
  const selectedAnnualPrice = input.selectedPlan?.annualPrice
    ? parseFloat(String(input.selectedPlan.annualPrice))
    : 0;
  const selectedMonthlyPrice = input.selectedPlan
    ? parseFloat(String(input.selectedPlan.price))
    : 0;
  const nativeIntervalSeconds = Number(input.targetPlan.billingInterval ?? 0);
  const usesAnnualBillingConfig =
    input.billingPeriod === "annual" &&
    (selectedAnnualPrice > 0 || nativeIntervalSeconds >= 31_536_000);

  const chargeAmount =
    usesAnnualBillingConfig && selectedAnnualPrice > 0
      ? parseDecimalToAtomicUnits(selectedAnnualPrice.toFixed(6))
      : BigInt(
          Math.round(
            Math.max(
              usesAnnualBillingConfig
                ? selectedAnnualPrice || Number(input.targetPlan.price ?? 0n) / 1_000_000
                : selectedMonthlyPrice || Number(input.targetPlan.price ?? 0n) / 1_000_000,
              0,
            ) * 1_000_000,
          ),
        );
  const interval =
    usesAnnualBillingConfig && nativeIntervalSeconds < 31_536_000
      ? 31_536_000
      : nativeIntervalSeconds;

  return { chargeAmount, interval };
}

function formatAtomicUsdcAmount(value: bigint): string {
  return `$${(Number(value) / 1_000_000).toFixed(2)}`;
}

function assertOnChainPlanSupportsConfiguredCharge(input: {
  selectedPlan: ComponentPlanSummary | null | undefined;
  targetPlan: {
    price?: bigint;
  };
  billingPeriod: "monthly" | "annual";
  chargeAmount: bigint;
}) {
  const onChainPriceCap = BigInt(input.targetPlan.price ?? 0n);
  if (input.chargeAmount <= onChainPriceCap) {
    return;
  }

  const selectedPlanName = input.selectedPlan?.name?.trim() || "This plan";
  const planLabel =
    input.billingPeriod === "annual" ? "yearly" : "monthly";

  throw new Error(
    `${selectedPlanName} is not synced on-chain for ${planLabel} billing yet. ` +
      `The plan currently allows up to ${formatAtomicUsdcAmount(onChainPriceCap)} ` +
      `on-chain, but this checkout needs ${formatAtomicUsdcAmount(input.chargeAmount)}. ` +
      `Update the plan with the dashboard's on-chain sync action, then try again.`,
  );
}

type WindowEthereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: Array<
    WindowEthereum & { isMetaMask?: boolean; isCoinbaseWallet?: boolean }
  >;
};

type WalletKind = "metamask" | "coinbase";

let preferredWindowEthereum: WindowEthereum | null = null;

function setPreferredWindowEthereum(provider: WindowEthereum | null) {
  preferredWindowEthereum = provider;
}

function openCoinbaseWalletDeepLink() {
  if (typeof window === "undefined") return;
  const link = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(window.location.href)}`;
  window.open(link, "_blank", "noopener,noreferrer");
  setTimeout(() => {
    window.location.href = link;
  }, 500);
}

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isInAppBrowser(): boolean {
  if (typeof window === "undefined") return true;
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("wv") ||
    ua.includes("metamask") ||
    ua.includes("trust") ||
    ua.includes("rainbow") ||
    ua.includes("coinbase")
  );
}

function openMetaMaskDeepLink() {
  if (typeof window === "undefined") return;
  const dappPath = `${window.location.host}${window.location.pathname}`;
  const link = `https://metamask.app.link/dapp/${dappPath}`;
  window.open(link, "_blank", "noopener,noreferrer");
  const fullLink = `https://metamask.app.link/dapp/${dappPath}${window.location.search}`;
  setTimeout(() => {
    window.location.href = fullLink;
  }, 500);
}

function detectCoinbaseWalletExtension(): WindowEthereum | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as { coinbaseWalletExtension?: WindowEthereum };
  return win.coinbaseWalletExtension ?? null;
}

function getProvider(wallet: WalletKind): WindowEthereum | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as { ethereum?: WindowEthereum };
  const ethereum = win.ethereum;
  if (!ethereum) return null;

  if (ethereum.providers?.length) {
    if (wallet === "coinbase") {
      return ethereum.providers.find((p) => p.isCoinbaseWallet) ?? null;
    }
    if (wallet === "metamask") {
      return ethereum.providers.find((p) => p.isMetaMask) ?? null;
    }
  }

  if (wallet === "coinbase" && ethereum.isCoinbaseWallet) return ethereum;
  if (wallet === "metamask" && ethereum.isMetaMask) return ethereum;

  if (wallet === "metamask") return ethereum;
  return null;
}

function getCoinbaseProvider(): WindowEthereum | null {
  return detectCoinbaseWalletExtension() ?? getProvider("coinbase");
}

function getWindowEthereum(): WindowEthereum | null {
  if (preferredWindowEthereum) return preferredWindowEthereum;
  if (typeof window === "undefined") return null;
  return (
    (
      window as unknown as {
        ethereum?: WindowEthereum;
      }
    ).ethereum ?? null
  );
}

const WALLET_CONNECT_TIMEOUT_MS = 20_000;

function getWalletConnectionErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 4001
  ) {
    return "Wallet connection was cancelled.";
  }

  const message = error instanceof Error ? error.message : "";
  if (!message) {
    return "Wallet connection failed. Please try again.";
  }

  const normalized = message.toLowerCase();
  if (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("cancelled")
  ) {
    return "Wallet connection was cancelled.";
  }

  return message;
}

function isUserRejectedWalletAction(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number((error as { code?: number | string }).code) === 4001
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (!message) return false;

  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("transaction cancelled") ||
    message.includes("wallet connection was cancelled")
  );
}

async function requestWindowEthereumAccounts(
  preferredWallet?: WalletKind,
): Promise<{ accounts: string[]; provider: WindowEthereum }> {
  let eth: WindowEthereum | null;
  let installName: string;

  if (preferredWallet === "coinbase") {
    eth = getCoinbaseProvider();
    installName = "Coinbase Wallet";
  } else {
    eth = preferredWallet
      ? (getProvider(preferredWallet) ?? getWindowEthereum())
      : getWindowEthereum();
    installName = "a Web3 wallet like MetaMask";
  }

  if (!eth) {
    throw new Error(
      `No ${installName} found. Please install ${installName} to continue.`,
    );
  }

  const existingAccounts = await eth
    .request({ method: "eth_accounts" })
    .catch(() => []);

  if (
    Array.isArray(existingAccounts) &&
    typeof existingAccounts[0] === "string" &&
    existingAccounts[0]
  ) {
    return { accounts: existingAccounts as string[], provider: eth };
  }

  let timeoutId: number | undefined;
  try {
    const requestedAccounts = await Promise.race([
      eth.request({ method: "eth_requestAccounts" }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(
            new Error(
              "Wallet connection timed out. Open your wallet and approve the request, then try again.",
            ),
          );
        }, WALLET_CONNECT_TIMEOUT_MS);
      }),
    ]);

    if (
      !Array.isArray(requestedAccounts) ||
      typeof requestedAccounts[0] !== "string" ||
      !requestedAccounts[0]
    ) {
      throw new Error("No wallet account was returned.");
    }

    return { accounts: requestedAccounts as string[], provider: eth };
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function createBrowserWalletClient(params: {
  chainId: number;
  account: string | null | undefined;
  provider?: WindowEthereum | null;
}): WalletClient | null {
  const ethereum = params.provider ?? getWindowEthereum();
  if (!ethereum || !params.account || !isAddress(params.account)) return null;

  return createWalletClient({
    account: params.account as `0x${string}`,
    chain: getChain(params.chainId),
    transport: custom(ethereum),
  }) as WalletClient;
}

async function getCurrentWalletChainId(
  walletClient: WalletClient,
): Promise<number | null> {
  try {
    const chainId = await walletClient.getChainId();
    return Number.isFinite(chainId) ? chainId : null;
  } catch {
    const ethereum = getWindowEthereum();
    if (!ethereum) return null;
    try {
      const chainHex = await ethereum.request({ method: "eth_chainId" });
      if (typeof chainHex !== "string") return null;
      const parsed = Number.parseInt(chainHex, 16);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

async function ensureWalletOnTargetChain(
  walletClient: WalletClient,
  chainId: number,
): Promise<void> {
  const currentChainId = await getCurrentWalletChainId(walletClient);
  if (currentChainId === chainId) return;

  const targetChain = getChain(chainId);
  const ethereum = getWindowEthereum();
  const chainHex = `0x${chainId.toString(16)}`;

  const addChain = async () => {
    if (!ethereum) {
      throw new Error(
        `Switch your wallet to ${targetChain.name} (Chain ID: ${chainId}) and try again.`,
      );
    }

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainHex,
          chainName: targetChain.name,
          nativeCurrency: targetChain.nativeCurrency,
          rpcUrls: Array.from(
            new Set([
              ...(targetChain.rpcUrls.default.http ?? []),
              ...(targetChain.rpcUrls.public?.http ?? []),
            ]),
          ),
          blockExplorerUrls: targetChain.blockExplorers?.default?.url
            ? [targetChain.blockExplorers.default.url]
            : [],
        },
      ],
    });
  };

  try {
    if (typeof walletClient.switchChain === "function") {
      await walletClient.switchChain({ id: chainId });
      return;
    }

    if (!ethereum) {
      throw new Error(
        `Switch your wallet to ${targetChain.name} (Chain ID: ${chainId}) and try again.`,
      );
    }

    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number((error as { code?: number | string }).code)
        : null;
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (code === 4902 || message.includes("unrecognized chain")) {
      await addChain();
      return;
    }

    if (code === 4001 || message.includes("user rejected")) {
      throw new Error(
        `Switch to ${targetChain.name} in your wallet to continue.`,
      );
    }

    throw new Error(
      `Unable to switch the wallet to ${targetChain.name}. Open your wallet and change to Chain ID ${chainId}.`,
    );
  }

  const confirmedChainId = await getCurrentWalletChainId(walletClient);
  if (confirmedChainId !== chainId) {
    throw new Error(
      `Wallet is still on the wrong network. Switch to ${targetChain.name} (Chain ID: ${chainId}) and try again.`,
    );
  }
}

async function readOnChainPlan(
  chainId: number,
  onChainPlanId: string,
): Promise<{
  provider?: string;
  price?: bigint;
  billingInterval?: number;
  acceptedToken?: string;
  active?: boolean;
}> {
  const chain = getChain(chainId);
  const contracts = getContractAddresses(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  return (await publicClient.readContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getPlan",
    args: [BigInt(onChainPlanId)],
  })) as {
    provider?: string;
    price?: bigint;
    billingInterval?: number;
    acceptedToken?: string;
    active?: boolean;
  };
}

async function readAutopayConfig(chainId: number, paymentAccount: string) {
  const chain = getChain(chainId);
  const contracts = getContractAddresses(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  return (await publicClient.readContract({
    address: contracts.autopayModule as `0x${string}`,
    abi: [
      {
        type: "function",
        name: "getConfig",
        inputs: [{ name: "account", type: "address" }],
        outputs: [
          {
            components: [
              { name: "merchant", type: "address" },
              { name: "maxAmount", type: "uint256" },
              { name: "token", type: "address" },
              { name: "interval", type: "uint32" },
              { name: "startTime", type: "uint64" },
              { name: "planId", type: "uint256" },
              { name: "maxTotalAmount", type: "uint256" },
            ],
            name: "config",
            type: "tuple",
          },
        ],
        stateMutability: "view",
      },
    ],
    functionName: "getConfig",
    args: [paymentAccount as `0x${string}`],
  })) as {
    merchant?: string;
    maxAmount?: bigint;
    token?: string;
    interval?: number;
    startTime?: bigint;
    planId?: bigint;
    maxTotalAmount?: bigint;
  };
}

async function readAutopayInitialized(
  chainId: number,
  paymentAccount: string,
): Promise<boolean> {
  const chain = getChain(chainId);
  const contracts = getContractAddresses(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  return (await publicClient.readContract({
    address: contracts.autopayModule as `0x${string}`,
    abi: ERC7579AutopayModuleABI,
    functionName: "isInitialized",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;
}

async function readAutopayPaused(
  chainId: number,
  paymentAccount: string,
): Promise<boolean> {
  const chain = getChain(chainId);
  const contracts = getContractAddresses(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  return (await publicClient.readContract({
    address: contracts.autopayModule as `0x${string}`,
    abi: ERC7579AutopayModuleABI,
    functionName: "isAccountPaused",
    args: [paymentAccount as `0x${string}`],
  })) as boolean;
}

async function readChainTimestampSeconds(chainId: number): Promise<bigint> {
  const chain = getChain(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  return latestBlock.timestamp;
}

function encodeAutopayInstallData(params: {
  merchant: `0x${string}`;
  maxAmount: bigint;
  token: `0x${string}`;
  interval: number;
  startTime: bigint;
  planId: bigint;
}): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters(
      "(address merchant,uint256 maxAmount,address token,uint32 interval,uint64 startTime,uint256 planId,uint256 maxTotalAmount)",
    ),
    [
      {
        merchant: params.merchant,
        maxAmount: params.maxAmount,
        token: params.token,
        interval: params.interval,
        startTime: params.startTime,
        planId: params.planId,
        maxTotalAmount: 0n,
      },
    ],
  );
}

async function submitWalletTransaction(params: {
  chainId: number;
  walletClient: WalletClient;
  account: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}): Promise<{ txHash: `0x${string}` }> {
  await ensureWalletOnTargetChain(params.walletClient, params.chainId);
  const publicClient = createPublicClient({
    chain: getChain(params.chainId),
    transport: http(),
  });
  const txHash = await params.walletClient.sendTransaction({
    account: params.account,
    chain: getChain(params.chainId),
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error("Wallet transaction did not complete successfully.");
  }
  return { txHash };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Responsive container width hook ─────────────────────────────────────────

function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
): number {
  const [width, setWidth] = useState(360);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ─── Portal element renderers ─────────────────────────────────────────────────

export function renderElement(
  el: ComponentElement & Record<string, unknown>,
  index: number,
  data: ComponentRenderData,
  tokens: Tokens,
  onChangePlan: () => void,
  onUnsubscribe: () => void,
  onResumeSubscription: () => void,
  allowPlanChanges = true,
  allowCancellation = true,
): React.ReactNode {
  const prop = (key: string) =>
    el[key] ?? (el.config as Record<string, unknown> | undefined)?.[key];

  const activePlan = data.activePlan;
  const activeBillingPeriod = resolveActiveBillingPeriod({
    billingPeriod: data.billingPeriod,
    activePlan,
  });
  const activePlanDisplayPrice = getPlanDisplayPrice(
    activePlan,
    activeBillingPeriod,
  );
  const activePlanDisplayIntervalLabel = getPlanDisplayIntervalLabel(
    activePlan,
    activeBillingPeriod,
  );

  const iconMap = new Map<string, string>();
  (data.entitlements as any[])?.forEach((ent: any) => {
    if (ent.icon && ent.featureKey) iconMap.set(ent.featureKey, ent.icon);
  });

  const featureIconNode = (
    entry: { featureKey?: string; icon?: string | null },
    size = 14,
  ) => {
    const resolved = entry.icon || iconMap.get(entry.featureKey ?? "") || null;
    return resolved ? renderFeatureIconNode(resolved, size) : null;
  };

  switch (el.type) {
    case "planManager": {
      const plan = activePlan;
      const priceNum = activePlanDisplayPrice;
      const lifecycleBadge = getLifecycleBadge(data);
      const lifecycleNote = getLifecycleNote(data);
      return (
        <div
          key={index}
          style={{
            background: tokens.bg,
            border: tokens.cardBorder,
            borderRadius: tokens.radius,
            boxShadow: tokens.cardShadow,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div style={{ padding: "24px 24px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 16,
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: tokens.size + 18,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    color: tokens.textColor,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {plan?.name ?? "Free"}
                </div>
                <div
                  style={{
                    fontSize: tokens.size - 1,
                    color: tokens.mutedColor,
                    marginTop: 4,
                  }}
                >
                  {plan?.description ?? "Included with your subscription"}
                </div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 8,
                    background: lifecycleBadge.background,
                    color: lifecycleBadge.color,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                  }}
                >
                  ✓ {lifecycleBadge.label}
                </div>
                {lifecycleNote ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.mutedColor,
                      marginTop: 8,
                      maxWidth: 420,
                      lineHeight: 1.5,
                    }}
                  >
                    {lifecycleNote}
                  </div>
                ) : null}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div
                  style={{
                    fontSize: tokens.size + 10,
                    fontWeight: 800,
                    color: tokens.textColor,
                  }}
                >
                  {priceNum === 0 ? "Free" : `$${priceNum.toFixed(2)}`}
                </div>
                {priceNum > 0 && (
                  <div
                    style={{
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                    }}
                  >
                    {activePlanDisplayIntervalLabel}
                  </div>
                )}
              </div>
            </div>
            {allowPlanChanges ? (
              <PrimaryButton tokens={tokens} onClick={onChangePlan} fullWidth>
                Change plan
              </PrimaryButton>
            ) : null}
          </div>
        </div>
      );
    }

    case "includedFeatures": {
      const ents = data.entitlements as Array<
        ComponentEntitlement & { featureType?: string }
      >;
      const boolFeats = getActivePlanBooleanFeatures(data);
      const creditFeats = ents.filter((e) => e.featureType === "credit");
      const traitFeats = ents.filter((e) => e.featureType === "trait_based");
      const hasAny =
        boolFeats.length > 0 || creditFeats.length > 0 || traitFeats.length > 0;

      return (
        <div
          key={index}
          style={{
            background: tokens.bg,
            border: tokens.cardBorder,
            borderRadius: tokens.radius,
            boxShadow: tokens.cardShadow,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div style={{ padding: "20px 24px" }}>
            <div
              style={{
                fontSize: tokens.size,
                fontWeight: 700,
                color: tokens.textColor,
                marginBottom: 12,
              }}
            >
              Included features
            </div>
            {!hasAny ? (
              <div
                style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
              >
                No features on this plan.
              </div>
            ) : (
              <>
                {boolFeats.map((e, i) => (
                  <div
                    key={e.featureKey}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom:
                        i < boolFeats.length - 1
                          ? "1px solid #f5f5f5"
                          : undefined,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <FeatureIcon>
                        {featureIconNode(e) || DOC_ICON}
                      </FeatureIcon>
                      <span
                        style={{
                          fontSize: tokens.size,
                          fontWeight: 500,
                          color: tokens.textColor,
                        }}
                      >
                        {e.name ?? e.featureKey}
                      </span>
                    </div>
                    <span style={{ fontWeight: 700, color: "#16a34a" }}>✓</span>
                  </div>
                ))}
                {creditFeats.map((e) => {
                  const val =
                    typeof e.value === "number"
                      ? e.value
                      : parseFloat(String(e.value)) || 0;
                  return (
                    <div
                      key={e.featureKey}
                      style={{
                        padding: "10px 0",
                        borderBottom: "1px solid #f5f5f5",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <FeatureIcon>
                            {featureIconNode(e) || DOC_ICON}
                          </FeatureIcon>
                          <span
                            style={{
                              fontSize: tokens.size,
                              fontWeight: 500,
                              color: tokens.textColor,
                            }}
                          >
                            {e.name ?? e.featureKey}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: tokens.size - 1,
                            color: tokens.mutedColor,
                          }}
                        >
                          {val.toLocaleString()}
                          {e.limit ? `/${e.limit.toLocaleString()}` : ""}{" "}
                          {e.unitPlural ?? "credits"}
                        </span>
                      </div>
                      {e.limit && (
                        <div
                          style={{
                            height: 4,
                            background: "#f3f4f6",
                            borderRadius: 999,
                          }}
                        >
                          <div
                            style={{
                              height: 4,
                              width: `${Math.min((val / e.limit) * 100, 100)}%`,
                              background: tokens.primary,
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {traitFeats.map((e) => (
                  <div
                    key={e.featureKey}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <FeatureIcon>
                        {featureIconNode(e) || DOC_ICON}
                      </FeatureIcon>
                      <span
                        style={{
                          fontSize: tokens.size,
                          fontWeight: 500,
                          color: tokens.textColor,
                        }}
                      >
                        {e.name ?? e.featureKey}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: tokens.size - 1,
                        color: tokens.mutedColor,
                        background: "#f3f4f6",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {String(e.value)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      );
    }

    case "meteredFeatures": {
      return (
        <div
          key={index}
          style={{
            background: tokens.bg,
            border: tokens.cardBorder,
            borderRadius: tokens.radius,
            boxShadow: tokens.cardShadow,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div style={{ padding: "20px 24px" }}>
            <div
              style={{
                fontSize: tokens.size,
                fontWeight: 700,
                color: tokens.textColor,
                marginBottom: 14,
              }}
            >
              Usage
            </div>
            {renderUsageCards(data, tokens)}
          </div>
        </div>
      );
    }

    case "plansTable": {
      const pendingTransition = getSubscriptionTransition(data);
      const scheduledCancellation = getScheduledCancellationTransition(data);
      const isBillingScheduleChange = isBillingPeriodOnlyTransition({
        transition: pendingTransition,
        activePlanId: data.activePlan?.id ?? null,
      });
      return (
        <div key={index} style={{ marginBottom: 24 }}>
          <SectionHeading tokens={tokens}>Available Plans</SectionHeading>
          {scheduledCancellation ? (
            <div
              style={{
                marginBottom: 12,
                padding: "12px 14px",
                borderRadius: tokens.radius / 1.5,
                background: "#fff7ed",
                border: "1px solid #fdba74",
                color: "#9a3412",
                fontSize: tokens.size - 2,
                lineHeight: 1.6,
              }}
            >
              Cancellation scheduled: your current plan stays active until{" "}
              <strong>
                {formatDateLabel(scheduledCancellation.effectiveAt) ??
                  "the end of the current billing period"}
              </strong>
              . After that, the subscription moves to Free.
              {allowPlanChanges ? (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={onResumeSubscription}
                    style={{
                      padding: "6px 10px",
                      background: "#fff",
                      color: "#9a3412",
                      border: "1px solid #fdba74",
                      borderRadius: tokens.radius / 1.5,
                      cursor: "pointer",
                      fontSize: tokens.size - 2,
                      fontWeight: 700,
                    }}
                  >
                    Keep subscription active
                  </button>
                </div>
              ) : null}
            </div>
          ) : pendingTransition?.targetPlanName ? (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: tokens.radius / 1.5,
                background: "#fff7ed",
                border: "1px solid #fdba74",
                color: "#9a3412",
                fontSize: tokens.size - 2,
                lineHeight: 1.6,
              }}
            >
              {isBillingScheduleChange ? (
                <>
                  Billing schedule pending: your current cycle stays active
                  until{" "}
                  <strong>
                    {formatDateLabel(pendingTransition.effectiveAt) ??
                      "the next renewal"}
                  </strong>
                  . Renewals switch to{" "}
                  <strong>
                    {billingPeriodDisplayName(
                      pendingTransition.targetBillingPeriod,
                    )}
                  </strong>{" "}
                  billing after that.
                </>
              ) : (
                <>
                  Plan change pending: your subscription will move to{" "}
                  <strong>{pendingTransition.targetPlanName}</strong>
                  {pendingTransition.effectiveAt
                    ? ` on ${formatDateLabel(pendingTransition.effectiveAt) ?? "the next renewal"}.`
                    : " on the next renewal."}
                </>
              )}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {data.plans.map((p: ComponentPlanSummary) => {
              const isActive = p.id === data.activePlan?.id;
              const isPendingTarget = p.id === pendingTransition?.targetPlanId;
              const isCompact = data.plans.length > 2;
              const cardBillingPeriod =
                isActive
                  ? activeBillingPeriod
                  : isPendingTarget &&
                      pendingTransition?.targetBillingPeriod === "annual"
                    ? "annual"
                    : "monthly";
              const cardPrice = getPlanDisplayPrice(p, cardBillingPeriod);
              const cardIntervalLabel = getPlanDisplayIntervalLabel(
                p,
                cardBillingPeriod,
              );
              return (
                <div
                  key={p.id}
                  style={{
                    flex: isCompact ? "1 1 130px" : "1 1 160px",
                    minWidth: isCompact ? 120 : 140,
                    maxWidth: isCompact ? 180 : 220,
                    padding: 16,
                    borderRadius: tokens.radius,
                    border: isActive
                      ? `2px solid ${tokens.primary}`
                      : `1px solid #e5e7eb`,
                    background: isActive ? `${tokens.primary}08` : tokens.bg,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size,
                      color: tokens.textColor,
                      marginBottom: 4,
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontSize: tokens.size + 4,
                      fontWeight: 800,
                      color: tokens.textColor,
                      marginBottom: 12,
                    }}
                  >
                    {cardPrice === 0
                      ? "Free"
                      : `$${cardPrice.toFixed(2)}`}
                    {cardPrice > 0 ? (
                      <span
                        style={{
                          fontSize: tokens.size - 2,
                          fontWeight: 400,
                          color: tokens.mutedColor,
                        }}
                      >
                        {cardIntervalLabel}
                      </span>
                    ) : null}
                  </div>
                  {isActive ? (
                    <div
                      style={{
                        fontSize: tokens.size - 1,
                        color: tokens.mutedColor,
                      }}
                    >
                      ✓ Current plan
                    </div>
                  ) : isPendingTarget ? (
                    <div
                      style={{
                        fontSize: tokens.size - 1,
                        color: "#9a3412",
                        fontWeight: 600,
                      }}
                    >
                      Pending next renewal
                    </div>
                  ) : (
                    <button
                      onClick={onChangePlan}
                      style={{
                        width: "100%",
                        padding: "6px 0",
                        background: tokens.primary,
                        color: isLightColor(tokens.primary) ? "#000" : "#fff",
                        border: "none",
                        borderRadius: tokens.radius / 1.5,
                        cursor: "pointer",
                        fontSize: tokens.size - 1,
                        fontWeight: 600,
                      }}
                    >
                      Select plan
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "nextBillDue": {
      const plan = activePlan;
      const pendingTransition = getSubscriptionTransition(data);
      const isBillingScheduleChange = isBillingPeriodOnlyTransition({
        transition: pendingTransition,
        activePlanId: data.activePlan?.id ?? null,
      });
      const scheduledCancellation = getScheduledCancellationTransition(data);
      const priceVal = activePlanDisplayPrice;
      const nextBillingLabel = formatDateLabel(data.nextBillingAt);
      const nextBillingRelative =
        activeBillingPeriod === "annual"
          ? null
          : formatRelativeDate(data.nextBillingAt);
      const nextBillingDescriptor =
        activeBillingPeriod === "annual"
          ? "Next yearly billing date"
          : "Scheduled billing date";
      const annualRenewalNote =
        activeBillingPeriod === "annual" &&
        !scheduledCancellation &&
        !pendingTransition?.targetPlanName &&
        nextBillingLabel
          ? `Your subscription is set to yearly billing. The next yearly charge is scheduled for ${nextBillingLabel}.`
          : null;
      return (
        <Card key={index} tokens={tokens} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: tokens.size + 2,
              fontWeight: 700,
              color: tokens.textColor,
              marginBottom: 12,
            }}
          >
            Next Bill
          </div>
          {priceVal === 0 ? (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              {plan ? `${plan.name} — no charges` : "No active plan."}
            </div>
          ) : !nextBillingLabel ? (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              Next billing date will appear after the subscription is active.
            </div>
          ) : (
            <div>
              {scheduledCancellation ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: tokens.radius / 1.5,
                    background: "#fff7ed",
                    border: "1px solid #fdba74",
                    color: "#9a3412",
                    fontSize: tokens.size - 2,
                    lineHeight: 1.6,
                  }}
                >
                  Cancellation scheduled. Your current plan will stay active
                  until{" "}
                  <strong>
                    {formatDateLabel(scheduledCancellation.effectiveAt) ??
                      "the end of the current billing period"}
                  </strong>
                  .
                </div>
              ) : pendingTransition?.targetPlanName ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: tokens.radius / 1.5,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    color: "#1d4ed8",
                    fontSize: tokens.size - 2,
                    lineHeight: 1.6,
                  }}
                >
                  {isBillingScheduleChange ? (
                    <>
                      Your current{" "}
                      <strong>
                        {billingPeriodDisplayName(activeBillingPeriod)}
                      </strong>{" "}
                      cycle stays active until{" "}
                      <strong>
                        {formatDateLabel(pendingTransition.effectiveAt) ??
                          "the next renewal"}
                      </strong>
                      . Renewals switch to{" "}
                      <strong>
                        {billingPeriodDisplayName(
                          pendingTransition.targetBillingPeriod,
                        )}
                      </strong>{" "}
                      billing after that.
                    </>
                  ) : (
                    <>
                      Future renewals are configured for{" "}
                      <strong>{pendingTransition.targetPlanName}</strong>.
                      {pendingTransition.effectiveAt
                        ? ` The change takes effect on ${formatDateLabel(pendingTransition.effectiveAt) ?? "the next renewal"}.`
                        : " The change takes effect on the next renewal."}
                    </>
                  )}
                </div>
              ) : annualRenewalNote ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    borderRadius: tokens.radius / 1.5,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    color: "#1d4ed8",
                    fontSize: tokens.size - 2,
                    lineHeight: 1.6,
                  }}
                >
                  {annualRenewalNote}
                </div>
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    fontSize: tokens.size + 10,
                    fontWeight: 800,
                    color: tokens.textColor,
                  }}
                >
                  ${priceVal.toFixed(2)}
                  <span
                    style={{
                      fontSize: tokens.size - 1,
                      fontWeight: 500,
                      color: tokens.mutedColor,
                      marginLeft: 4,
                    }}
                  >
                    {activePlanDisplayIntervalLabel}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: tokens.mutedColor,
                    paddingBottom: 2,
                  }}
                >
                  {activeBillingPeriod === "annual"
                    ? "renews yearly"
                    : nextBillingRelative ?? nextBillingLabel}
                </div>
              </div>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 10,
                }}
              >
                {nextBillingDescriptor} · {nextBillingLabel}
              </div>
            </div>
          )}
        </Card>
      );
    }

    case "paymentMethod": {
      const isPaidPlan = activePlanDisplayPrice > 0;
      const method = data.paymentMethod as
        | ComponentPaymentMethod
        | null
        | undefined;
      const walletLabel = truncateWallet(method?.walletAddress);
      const chainLabel = formatChainLabel(method?.chainId);
      return (
        <Card key={index} tokens={tokens} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: tokens.size + 2,
              fontWeight: 700,
              color: tokens.textColor,
              marginBottom: 12,
            }}
          >
            Payment Method
          </div>
          {isPaidPlan && method?.walletAddress ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "#f9fafb",
                borderRadius: tokens.radius / 1.5,
                border: "1px solid #f0f0f0",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>
                  ⬡
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: tokens.size - 1,
                    fontFamily: "monospace",
                    fontWeight: 600,
                    color: tokens.textColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {walletLabel}
                </div>
                <div
                  style={{
                    fontSize: tokens.size - 3,
                    color: tokens.mutedColor,
                    marginTop: 1,
                  }}
                >
                  {[chainLabel, method?.token].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              {isPaidPlan
                ? "No payment method is on file yet."
                : "Free plan — no payment method required."}
            </div>
          )}
        </Card>
      );
    }

    case "invoices": {
      const isPaidPlan = activePlanDisplayPrice > 0;
      const invoices = data.recentInvoices as
        | ComponentInvoiceSummary[]
        | undefined;
      return (
        <Card key={index} tokens={tokens} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: tokens.size + 2,
              fontWeight: 700,
              color: tokens.textColor,
              marginBottom: 12,
            }}
          >
            Invoices
          </div>
          {isPaidPlan && invoices && invoices.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {invoices.slice(0, 3).map((invoice) => (
                <div
                  key={invoice.id}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: tokens.radius / 1.5,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: tokens.size - 1,
                        fontWeight: 600,
                        color: tokens.textColor,
                      }}
                    >
                      {invoice.number ?? "Invoice"}
                    </div>
                    {invoice.customerName ? (
                      <div
                        style={{
                          fontSize: tokens.size - 3,
                          color: tokens.textColor,
                          marginTop: 2,
                        }}
                      >
                        {invoice.customerName}
                      </div>
                    ) : null}
                    <div
                      style={{
                        fontSize: tokens.size - 3,
                        color: tokens.mutedColor,
                        marginTop: 2,
                      }}
                    >
                      {formatDateLabel(invoice.issuedAt) ??
                        "Pending issue date"}{" "}
                      · {invoice.status}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexShrink: 0,
                    }}
                  >
                    {invoice.downloadUrl ? (
                      <a
                        href={invoice.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: tokens.size - 3,
                          fontWeight: 600,
                          color: tokens.primary,
                          textDecoration: "none",
                        }}
                      >
                        Download PDF
                      </a>
                    ) : null}
                    <span
                      style={{
                        fontSize: tokens.size - 1,
                        fontWeight: 700,
                        color: tokens.textColor,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatMoney(invoice.total, invoice.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : isPaidPlan ? (
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size - 1,
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              No invoices yet. They will appear after the first successful
              charge.
            </div>
          ) : (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              No invoices on the free plan.
            </div>
          )}
        </Card>
      );
    }

    case "unsubscribe": {
      const isPaidPlan = activePlanDisplayPrice > 0;
      if (!isPaidPlan || !allowCancellation) return null;
      if (getScheduledCancellationTransition(data)) return null;
      // Rendered inside left card by PortalContent — standalone fallback:
      return (
        <div key={index} style={{ marginBottom: 12 }}>
          <button
            onClick={onUnsubscribe}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid #ef4444",
              color: "#ef4444",
              borderRadius: tokens.radius / 1.5,
              cursor: "pointer",
              fontSize: tokens.size - 1,
              fontWeight: 500,
            }}
          >
            Cancel subscription
          </button>
        </div>
      );
    }

    case "billingHistory":
    case "billing-history": {
      const isPaidPlan = activePlanDisplayPrice > 0;
      const invoices = data.recentInvoices as
        | ComponentInvoiceSummary[]
        | undefined;
      return (
        <Card key={index} tokens={tokens} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: tokens.size + 2,
              fontWeight: 700,
              color: tokens.textColor,
              marginBottom: 12,
            }}
          >
            Billing History
          </div>
          {isPaidPlan && invoices && invoices.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {invoices.slice(0, 5).map((invoice) => {
                const statusDate =
                  invoice.paidAt ?? invoice.dueAt ?? invoice.issuedAt;
                return (
                  <div
                    key={invoice.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: tokens.size - 1,
                          fontWeight: 600,
                          color: tokens.textColor,
                        }}
                      >
                        {invoice.number ?? "Invoice"}
                      </div>
                      {invoice.customerName ? (
                        <div
                          style={{
                            fontSize: tokens.size - 3,
                            color: tokens.textColor,
                            marginTop: 2,
                          }}
                        >
                          {invoice.customerName}
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontSize: tokens.size - 3,
                          color: tokens.mutedColor,
                          marginTop: 2,
                        }}
                      >
                        {invoice.status} ·{" "}
                        {formatDateLabel(statusDate) ?? "Pending"}
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      {invoice.downloadUrl ? (
                        <a
                          href={invoice.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: tokens.size - 3,
                            fontWeight: 600,
                            color: tokens.primary,
                            textDecoration: "none",
                          }}
                        >
                          PDF
                        </a>
                      ) : null}
                      <div
                        style={{
                          fontSize: tokens.size - 1,
                          fontWeight: 700,
                          color: tokens.textColor,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatMoney(invoice.total, invoice.currency)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : isPaidPlan ? (
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size - 1,
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              No billing history yet.
            </div>
          ) : (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              No billing history on the free plan.
            </div>
          )}
        </Card>
      );
    }

    case "text": {
      const heading = prop("heading") as string | undefined;
      const body = prop("body") as string | undefined;
      const alignment = (prop("alignment") as string | undefined) ?? "left";
      return (
        <div
          key={index}
          style={{
            marginBottom: 20,
            textAlign: alignment as React.CSSProperties["textAlign"],
          }}
        >
          {heading ? (
            <div
              style={{
                fontWeight: 600,
                fontSize: tokens.size + 2,
                color: tokens.textColor,
                marginBottom: 6,
              }}
            >
              {heading}
            </div>
          ) : null}
          {body ? (
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size,
                lineHeight: 1.6,
              }}
            >
              {body}
            </div>
          ) : null}
        </div>
      );
    }

    case "button": {
      const label = (prop("label") as string | undefined) ?? "Click here";
      const href = prop("href") as string | undefined;
      const variant = (prop("variant") as string | undefined) ?? "primary";
      const fullWidth = (prop("fullWidth") as boolean | undefined) ?? false;
      const isPrimary = variant === "primary";
      const btnStyle: React.CSSProperties = {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "9px 20px",
        width: fullWidth ? "100%" : "auto",
        background: isPrimary ? tokens.primary : "transparent",
        color: isPrimary
          ? isLightColor(tokens.primary)
            ? "#000"
            : "#fff"
          : tokens.textColor,
        border: isPrimary ? "none" : `1px solid #d1d5db`,
        borderRadius: tokens.radius / 1.5,
        cursor: "pointer",
        fontSize: tokens.size - 1,
        fontWeight: 600,
        textDecoration: "none",
      };
      return (
        <div key={index} style={{ marginBottom: 20 }}>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={btnStyle}
            >
              {label}
            </a>
          ) : (
            <button style={btnStyle}>{label}</button>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

// ─── Portal content ───────────────────────────────────────────────────────────

const DOC_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const CHART_ICON = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function FeatureIcon({
  size = 32,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#f9fafb",
        border: "1px solid #efefef",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#6b7280",
      }}
    >
      {children}
    </div>
  );
}

function PortalContent({
  data,
  tokens,
  flashMsg,
  onChangePlan,
  onUnsubscribe,
  onResumeSubscription,
  allowPlanChanges,
  allowCancellation,
  containerWidth,
}: {
  data: ComponentRenderData;
  tokens: Tokens;
  flashMsg: string | null;
  onChangePlan: () => void;
  onUnsubscribe: () => void;
  onResumeSubscription: () => void;
  allowPlanChanges: boolean;
  allowCancellation: boolean;
  containerWidth: number;
}) {
  const elements = data.component.elements as Array<
    ComponentElement & Record<string, unknown>
  >;

  // Icon map built from entitlements for feature icon rendering
  const iconMap = new Map<string, string>();
  (data.entitlements as any[])?.forEach((ent: any) => {
    if (ent.icon && ent.featureKey) iconMap.set(ent.featureKey, ent.icon);
  });

  const featIcon = (
    entry: { featureKey?: string; icon?: string | null },
    size = 14,
  ) => {
    const resolved = entry.icon || iconMap.get(entry.featureKey ?? "") || null;
    return resolved ? renderFeatureIconNode(resolved, size) : null;
  };

  // Categorise elements by role
  const plan = data.activePlan;
  const activeBillingPeriod = resolveActiveBillingPeriod({
    billingPeriod: data.billingPeriod,
    activePlan: plan,
  });
  const isPaid = getPlanDisplayPrice(plan, activeBillingPeriod) > 0;
  const price = getPlanDisplayPrice(plan, activeBillingPeriod);
  const activePlanIntervalLabel = getPlanDisplayIntervalLabel(
    plan,
    activeBillingPeriod,
  );

  const hasPlanManager = elements.some((e) => e.type === "planManager");
  const hasIncluded = elements.some((e) => e.type === "includedFeatures");
  const hasMetered = elements.some((e) => e.type === "meteredFeatures");
  const billingTypes = [
    "nextBillDue",
    "paymentMethod",
    "invoices",
    "billingHistory",
    "billing-history",
  ];
  const billingEls = elements.filter((e) => billingTypes.includes(e.type));
  const hasLeftCard = hasPlanManager || hasIncluded || hasMetered;
  const shouldRenderCardUnsubscribe = allowCancellation && isPaid && hasLeftCard;
  const shouldRenderStandaloneUnsubscribe =
    allowCancellation && isPaid && !hasLeftCard;
  const customEls = elements.filter((e) => {
    if (["text", "button", "plansTable"].includes(e.type)) return true;
    if (e.type !== "unsubscribe") return false;
    return shouldRenderStandaloneUnsubscribe;
  });

  const scheduledCancellation = getScheduledCancellationTransition(data);
  const lifecycleBadge = getLifecycleBadge(data);
  const lifecycleNote = getLifecycleNote(data);
  const scheduledCancellationDate = formatDateLabel(
    scheduledCancellation?.effectiveAt ?? null,
  );

  const boolFeats = getActivePlanBooleanFeatures(data);

  // Respect the designer's columns + sections settings
  const designColumns = tokens.columns ?? 1;
  const designSections = tokens.sections ?? "separate";

  // Decide column layout:
  // - If sections=merged → all content in one unified card, no columns
  // - If sections=separate → use designColumns to split elements
  //   - columns=1 → everything stacked
  //   - columns=2 → left (plan/features/usage) + right (billing), matches integrated layout
  //   - columns=3+ → plan card | features/usage | billing (each group separate)
  const hasRightCol = billingEls.length > 0;

  const isNarrowPortal = containerWidth > 0 && containerWidth < 640;

  // Adjusted token sizes for narrow viewports
  const responsiveTokens = isNarrowPortal
    ? { ...tokens, size: Math.max(tokens.size - 1, 11) }
    : tokens;
  const cardPad = isNarrowPortal ? "16px 16px 14px" : "24px 24px 20px";
  const sectionPad = isNarrowPortal ? "14px 16px" : "20px 24px";
  const headingSize = responsiveTokens.size + (isNarrowPortal ? 10 : 18);
  const priceSize = responsiveTokens.size + (isNarrowPortal ? 6 : 10);

  // In merged mode, ignore columns and put everything in one card
  const isMerged = designSections === "merged";

  // In separate mode with columns >= 2, use grid for left/right split
  const useGrid =
    !isMerged &&
    !isNarrowPortal &&
    designColumns >= 2 &&
    hasLeftCard &&
    hasRightCol;

  // For columns=1 (single column), stack everything vertically even when separate
  const singleColumn = !isMerged && (isNarrowPortal || designColumns === 1);

  // Card base style
  const leftCard: React.CSSProperties = {
    background: tokens.bg,
    border: tokens.cardBorder,
    borderRadius: tokens.radius,
    boxShadow: tokens.cardShadow,
    overflow: "hidden",
  };

  const divider = <div style={{ height: 1, background: "#f0f0f0" }} />;

  return (
    <div>
      {/* Flash message */}
      {flashMsg ? (
        <div
          style={{
            background: "#dcfce7",
            color: "#166534",
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: tokens.size - 1,
            fontWeight: 500,
          }}
        >
          ✓ {flashMsg}
        </div>
      ) : null}

      {scheduledCancellation ? (
        <div
          style={{
            background: "#fff7ed",
            color: "#9a3412",
            padding: "14px 16px",
            borderRadius: 10,
            marginBottom: 16,
            border: "1px solid #fdba74",
          }}
        >
          <div
            style={{
              fontSize: tokens.size - 1,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            Cancellation scheduled
          </div>
          <div
            style={{
              fontSize: tokens.size - 1,
              lineHeight: 1.6,
            }}
          >
            Your current plan stays active until{" "}
            <strong>
              {scheduledCancellationDate ??
                "the end of the current billing period"}
            </strong>
            . Future renewals are turned off unless you reactivate the
            subscription before then.
          </div>
          {allowPlanChanges ? (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={onResumeSubscription}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #fdba74",
                  background: "#fff",
                  color: "#9a3412",
                  cursor: "pointer",
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                  fontFamily: tokens.font,
                }}
              >
                Keep subscription active
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Custom / full-width elements (text, button, plansTable) */}
      {customEls.map((el, i) =>
        renderElement(
          el,
          i,
          data,
          tokens,
          onChangePlan,
          onUnsubscribe,
          onResumeSubscription,
          allowPlanChanges,
          allowCancellation,
        ),
      )}

      {/* Main layout */}
      {(hasLeftCard || hasRightCol || isMerged) &&
        (isMerged ? (
          /* ── MERGED mode: all elements inside one unified card ── */
          <div style={{ ...leftCard, marginBottom: 12 }}>
            {hasPlanManager && (
              <div style={{ padding: cardPad }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    marginBottom: 16,
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: headingSize,
                        fontWeight: 800,
                        lineHeight: 1.05,
                        color: responsiveTokens.textColor,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {plan?.name ?? "Free"}
                    </div>
                    <div
                      style={{
                        fontSize: responsiveTokens.size - 1,
                        color: responsiveTokens.mutedColor,
                        marginTop: 4,
                      }}
                    >
                      {plan?.description ?? "Included with your subscription"}
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 8,
                        background: lifecycleBadge.background,
                        color: lifecycleBadge.color,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      ✓ {lifecycleBadge.label}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: priceSize,
                        fontWeight: 800,
                        color: responsiveTokens.textColor,
                      }}
                    >
                      {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                    </div>
                    {isPaid && (
                      <div
                        style={{
                          fontSize: responsiveTokens.size - 2,
                          color: responsiveTokens.mutedColor,
                        }}
                      >
                        {activePlanIntervalLabel}
                      </div>
                    )}
                  </div>
                </div>
                {allowPlanChanges ? (
                  <PrimaryButton
                    tokens={responsiveTokens}
                    onClick={onChangePlan}
                    fullWidth
                  >
                    Change plan
                  </PrimaryButton>
                ) : null}
              </div>
            )}
            {hasIncluded && (
              <>
                {hasPlanManager && divider}
                <div style={{ padding: sectionPad }}>
                  <div
                    style={{
                      fontSize: responsiveTokens.size,
                      fontWeight: 700,
                      color: responsiveTokens.textColor,
                      marginBottom: 12,
                    }}
                  >
                    Included features
                  </div>
                  {boolFeats.length === 0 ? (
                    <div
                      style={{
                        color: responsiveTokens.mutedColor,
                        fontSize: responsiveTokens.size - 1,
                      }}
                    >
                      No features configured.
                    </div>
                  ) : (
                    boolFeats.map((f, i) => (
                      <div
                        key={f.featureKey}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 0",
                          borderBottom:
                            i < boolFeats.length - 1
                              ? "1px solid #f5f5f5"
                              : undefined,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <FeatureIcon>{featIcon(f) || DOC_ICON}</FeatureIcon>
                          <span
                            style={{
                              fontSize: responsiveTokens.size,
                              fontWeight: 500,
                              color: responsiveTokens.textColor,
                            }}
                          >
                            {f.name ?? f.featureKey}
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, color: "#16a34a" }}>
                          ✓
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            {hasMetered && (
              <>
                {(hasPlanManager || hasIncluded) && divider}
                <div style={{ padding: sectionPad }}>
                  <div
                    style={{
                      fontSize: responsiveTokens.size,
                      fontWeight: 700,
                      color: responsiveTokens.textColor,
                      marginBottom: 14,
                    }}
                  >
                    Usage
                  </div>
                  {renderUsageCards(data, responsiveTokens)}
                </div>
              </>
            )}
            {[...billingEls].map((el, i) =>
              renderElement(
                el as ComponentElement & Record<string, unknown>,
                i + 200,
                data,
                responsiveTokens,
                onChangePlan,
                onUnsubscribe,
                onResumeSubscription,
                allowPlanChanges,
                allowCancellation,
              ),
            )}
            {shouldRenderCardUnsubscribe && !scheduledCancellation && (
              <>
                {divider}
                <div style={{ padding: "14px 24px" }}>
                  <button
                    onClick={onUnsubscribe}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: responsiveTokens.size - 1,
                      color: responsiveTokens.mutedColor,
                      padding: 0,
                      fontFamily: responsiveTokens.font,
                    }}
                  >
                    Cancel subscription
                  </button>
                </div>
              </>
            )}
          </div>
        ) : singleColumn ? (
          /* ── SINGLE COLUMN: all elements stacked vertically as separate cards ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hasLeftCard && (
              <div style={leftCard}>
                {hasPlanManager && (
                  <div style={{ padding: cardPad }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        marginBottom: 16,
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: headingSize,
                            fontWeight: 800,
                            lineHeight: 1.05,
                            color: responsiveTokens.textColor,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {plan?.name ?? "Free"}
                        </div>
                        <div
                          style={{
                            fontSize: responsiveTokens.size - 1,
                            color: responsiveTokens.mutedColor,
                            marginTop: 4,
                          }}
                        >
                          {plan?.description ??
                            "Included with your subscription"}
                        </div>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 8,
                            background: lifecycleBadge.background,
                            color: lifecycleBadge.color,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          ✓ {lifecycleBadge.label}
                        </div>
                        {lifecycleNote ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: responsiveTokens.mutedColor,
                              marginTop: 8,
                              maxWidth: 420,
                              lineHeight: 1.5,
                            }}
                          >
                            {lifecycleNote}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: priceSize,
                            fontWeight: 800,
                            color: responsiveTokens.textColor,
                          }}
                        >
                          {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                        </div>
                        {isPaid && (
                          <div
                            style={{
                              fontSize: responsiveTokens.size - 2,
                              color: responsiveTokens.mutedColor,
                            }}
                          >
                            {activePlanIntervalLabel}
                          </div>
                        )}
                      </div>
                    </div>
                    {allowPlanChanges ? (
                      <PrimaryButton
                        tokens={responsiveTokens}
                        onClick={onChangePlan}
                        fullWidth
                      >
                        Change plan
                      </PrimaryButton>
                    ) : null}
                  </div>
                )}
                {hasIncluded && (
                  <>
                    {hasPlanManager && divider}
                    <div style={{ padding: sectionPad }}>
                      <div
                        style={{
                          fontSize: responsiveTokens.size,
                          fontWeight: 700,
                          color: responsiveTokens.textColor,
                          marginBottom: 12,
                        }}
                      >
                        Included features
                      </div>
                      {boolFeats.length === 0 ? (
                        <div
                          style={{
                            color: responsiveTokens.mutedColor,
                            fontSize: responsiveTokens.size - 1,
                          }}
                        >
                          No features configured.
                        </div>
                      ) : (
                        boolFeats.map((f, i) => (
                          <div
                            key={f.featureKey}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 0",
                              borderBottom:
                                i < boolFeats.length - 1
                                  ? "1px solid #f5f5f5"
                                  : undefined,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <FeatureIcon>
                                {featIcon(f) || DOC_ICON}
                              </FeatureIcon>
                              <span
                                style={{
                                  fontSize: responsiveTokens.size,
                                  fontWeight: 500,
                                  color: responsiveTokens.textColor,
                                }}
                              >
                                {f.name ?? f.featureKey}
                              </span>
                            </div>
                            <span style={{ fontWeight: 700, color: "#16a34a" }}>
                              ✓
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
                {hasMetered && (
                  <>
                    {(hasPlanManager || hasIncluded) && divider}
                    <div style={{ padding: sectionPad }}>
                      <div
                        style={{
                          fontSize: responsiveTokens.size,
                          fontWeight: 700,
                          color: responsiveTokens.textColor,
                          marginBottom: 14,
                        }}
                      >
                        Usage
                      </div>
                      {renderUsageCards(data, responsiveTokens)}
                    </div>
                  </>
                )}
                {shouldRenderCardUnsubscribe && !scheduledCancellation && (
                  <>
                    {divider}
                    <div style={{ padding: "14px 24px" }}>
                      <button
                        onClick={onUnsubscribe}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: responsiveTokens.size - 1,
                          color: responsiveTokens.mutedColor,
                          padding: 0,
                          fontFamily: responsiveTokens.font,
                        }}
                      >
                        Cancel subscription
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {billingEls.map((el, i) =>
              renderElement(
                el as ComponentElement & Record<string, unknown>,
                i + 200,
                data,
                responsiveTokens,
                onChangePlan,
                onUnsubscribe,
                onResumeSubscription,
                allowPlanChanges,
                allowCancellation,
              ),
            )}
          </div>
        ) : (
          /* ── GRID (2+ columns): left card + right billing column ── */
          <div
            style={{
              display: "grid",
              gridTemplateColumns: useGrid ? "1.4fr 1fr" : "1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* ── Left card: plan + features + usage ── */}
            {hasLeftCard && (
              <div style={leftCard}>
                {/* Plan manager section */}
                {hasPlanManager && (
                  <div style={{ padding: "24px 24px 20px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        marginBottom: 16,
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: tokens.size + 18,
                            fontWeight: 800,
                            lineHeight: 1.05,
                            color: tokens.textColor,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {plan?.name ?? "Free"}
                        </div>
                        <div
                          style={{
                            fontSize: tokens.size - 1,
                            color: tokens.mutedColor,
                            marginTop: 4,
                          }}
                        >
                          {plan?.description ??
                            "Included with your subscription"}
                        </div>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 8,
                            background: lifecycleBadge.background,
                            color: lifecycleBadge.color,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          ✓ {lifecycleBadge.label}
                        </div>
                        {lifecycleNote ? (
                          <div
                            style={{
                              fontSize: 11,
                              color: tokens.mutedColor,
                              marginTop: 8,
                              maxWidth: 420,
                              lineHeight: 1.5,
                            }}
                          >
                            {lifecycleNote}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: tokens.size + 10,
                            fontWeight: 800,
                            color: tokens.textColor,
                          }}
                        >
                          {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                        </div>
                        {isPaid && (
                          <div
                            style={{
                              fontSize: tokens.size - 2,
                              color: tokens.mutedColor,
                            }}
                          >
                            {activePlanIntervalLabel}
                          </div>
                        )}
                      </div>
                    </div>
                    {allowPlanChanges ? (
                      <PrimaryButton
                        tokens={tokens}
                        onClick={onChangePlan}
                        fullWidth
                      >
                        Change plan
                      </PrimaryButton>
                    ) : null}
                  </div>
                )}

                {/* Included features */}
                {hasIncluded && (
                  <>
                    {hasPlanManager && divider}
                    <div style={{ padding: "20px 24px" }}>
                      <div
                        style={{
                          fontSize: tokens.size,
                          fontWeight: 700,
                          color: tokens.textColor,
                          marginBottom: 12,
                        }}
                      >
                        Included features
                      </div>
                      {boolFeats.length === 0
                        ? /* Demo placeholders */
                          [
                            { name: "API Access", limit: "Unlimited" },
                            { name: "Webhooks", limit: "Unlimited" },
                          ].map((f, i, arr) => (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 0",
                                borderBottom:
                                  i < arr.length - 1
                                    ? "1px solid #f5f5f5"
                                    : undefined,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                }}
                              >
                                <FeatureIcon>{DOC_ICON}</FeatureIcon>
                                <span
                                  style={{
                                    fontSize: tokens.size,
                                    fontWeight: 500,
                                    color: tokens.textColor,
                                  }}
                                >
                                  {f.name}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: tokens.size - 1,
                                  fontWeight: 600,
                                  color: tokens.textColor,
                                }}
                              >
                                {f.limit}
                              </span>
                            </div>
                          ))
                        : boolFeats.map((f, i) => (
                            <div
                              key={f.featureKey}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 0",
                                borderBottom:
                                  i < boolFeats.length - 1
                                    ? "1px solid #f5f5f5"
                                    : undefined,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                }}
                              >
                                <FeatureIcon>
                                  {featIcon(f) || DOC_ICON}
                                </FeatureIcon>
                                <span
                                  style={{
                                    fontSize: tokens.size,
                                    fontWeight: 500,
                                    color: tokens.textColor,
                                  }}
                                >
                                  {f.name ?? f.featureKey}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: tokens.size - 1,
                                  fontWeight: 700,
                                  color: "#16a34a",
                                }}
                              >
                                ✓
                              </span>
                            </div>
                          ))}
                    </div>
                  </>
                )}

                {/* Metered / usage features */}
                {hasMetered && (
                  <>
                    {(hasPlanManager || hasIncluded) && divider}
                    <div style={{ padding: "20px 24px" }}>
                      <div
                        style={{
                          fontSize: tokens.size,
                          fontWeight: 700,
                          color: tokens.textColor,
                          marginBottom: 14,
                        }}
                      >
                        Usage
                      </div>
                      {renderUsageCards(data, tokens)}
                    </div>
                  </>
                )}

                {/* Unsubscribe link at bottom of left card */}
                {shouldRenderCardUnsubscribe && !scheduledCancellation && (
                  <>
                    {divider}
                    <div style={{ padding: "14px 24px" }}>
                      <button
                        onClick={onUnsubscribe}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: tokens.size - 1,
                          color: tokens.mutedColor,
                          padding: 0,
                          fontFamily: tokens.font,
                        }}
                      >
                        Cancel subscription
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Right column: billing elements ── */}
            {hasRightCol && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                {billingEls.map((el, i) =>
                  renderElement(
                    el as ComponentElement & Record<string, unknown>,
                    i + 200,
                    data,
                    tokens,
                    onChangePlan,
                    onUnsubscribe,
                    onResumeSubscription,
                    allowPlanChanges,
                    allowCancellation,
                  ),
                )}
                {/* Branding */}
                <div style={{ textAlign: "center", paddingTop: 4 }}>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    Secured by{" "}
                    <strong
                      style={{ fontWeight: 700, color: tokens.textColor }}
                    >
                      ArcenPay
                    </strong>{" "}
                    · On-chain payments
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

      {/* Branding when no billing column (grid/single layouts) */}
      {!isMerged && !hasRightCol && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: tokens.mutedColor }}>
            Secured by{" "}
            <strong style={{ fontWeight: 700, color: tokens.textColor }}>
              ArcenPay
            </strong>{" "}
            · On-chain payments
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Checkout content (inline) ────────────────────────────────────────────────

function CheckoutContent({
  data,
  selectedPlanId,
  billingPeriod,
  apiBaseUrl,
  accessToken,
  couponQuote,
  processing,
  tokens,
  customerName,
  customerEmail,
  onSelectPlan,
  onBillingPeriodChange,
  onCustomerNameChange,
  onCustomerEmailChange,
  onCouponQuoteChange,
  onSubscribeClose,
  onNextPayment,
  onBack,
  containerWidth,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  billingPeriod: "monthly" | "annual";
  apiBaseUrl: string;
  accessToken: string;
  couponQuote: AppliedCouponQuote | null;
  processing: boolean;
  tokens: Tokens;
  customerName: string;
  customerEmail: string;
  onSelectPlan: (id: string) => void;
  onBillingPeriodChange: (p: "monthly" | "annual") => void;
  onCustomerNameChange: (value: string) => void;
  onCustomerEmailChange: (value: string) => void;
  onCouponQuoteChange: (quote: AppliedCouponQuote | null) => void;
  onSubscribeClose: () => void;
  onNextPayment: () => void;
  onBack: () => void;
  containerWidth: number;
}) {
  const effectiveSelectedPlanId = resolvePlanSelectionForBillingPeriod({
    plans: data.plans,
    selectedPlanId,
    billingPeriod,
  });
  const [coupon, setCoupon] = useState("");
  const [couponApplied, setCouponApplied] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const didInitializeCouponScope = useRef(false);

  // Show toggle whenever ANY plan has annual pricing configured; also always render it
  // so users can switch even if only some plans have annual prices.
  const hasAnyAnnualPrice = data.plans.some(
    (p: ComponentPlanSummary) =>
      p.annualPrice && parseFloat(String(p.annualPrice)) > 0,
  );

  const isMobile = containerWidth < 640;
  const isNarrow = containerWidth < 820;

  const currentPlan = data.activePlan;
  const currentPlanId = currentPlan?.id;
  const activeTransition = getSubscriptionTransition(data);
  const scheduledCancellation = getScheduledCancellationTransition(data);
  const currentBillingPeriod = resolveActiveBillingPeriod({
    billingPeriod: data.billingPeriod,
    activePlan: currentPlan,
  });
  const selectedPlan = data.plans.find(
    (p: ComponentPlanSummary) => p.id === effectiveSelectedPlanId,
  );
  const isCurrentPlanSelected = isCurrentBillingSelection({
    activePlanId: currentPlanId,
    selectedPlanId: effectiveSelectedPlanId,
    activeBillingPeriod: currentBillingPeriod,
    selectedBillingPeriod: billingPeriod,
  });
  const isScheduledCancellationResume = Boolean(
    scheduledCancellation &&
    selectedPlan?.onChainPlanId &&
    isCurrentPlanSelected,
  );
  const isFreePlanSelected = selectedPlan
    ? parseFloat(String(selectedPlan.price)) === 0
    : false;
  const isAuthoritativeOnChainPlanChange = Boolean(
    selectedPlan?.onChainPlanId &&
    currentPlan?.onChainPlanId &&
    !isCurrentPlanSelected,
  );
  const requiresHostedActivation = Boolean(
    selectedPlan?.onChainPlanId &&
    !currentPlan?.onChainPlanId &&
    !isCurrentPlanSelected,
  );
  const isCancellationRequiredFirst = Boolean(
    currentPlan?.onChainPlanId &&
    !selectedPlan?.onChainPlanId &&
    !isCurrentPlanSelected,
  );
  const couponsSupported = !(
    isAuthoritativeOnChainPlanChange ||
    requiresHostedActivation ||
    isCancellationRequiredFirst
  );
  const needsPayment =
    selectedPlanId &&
    (!isCurrentPlanSelected || isScheduledCancellationResume) &&
    !isFreePlanSelected;

  // Compute displayed price based on billing period
  const getDisplayPrice = (plan: ComponentPlanSummary) => {
    const monthly = parseFloat(String(plan.price));
    const annual = plan.annualPrice ? parseFloat(String(plan.annualPrice)) : 0;
    return billingPeriod === "annual" && annual > 0 ? annual : monthly;
  };
  const getDisplayPriceForPeriod = (
    plan: ComponentPlanSummary,
    period: "monthly" | "annual",
  ) => {
    const monthly = parseFloat(String(plan.price));
    const annual = plan.annualPrice ? parseFloat(String(plan.annualPrice)) : 0;
    return period === "annual" && annual > 0 ? annual : monthly;
  };

  const selectedDisplayPrice = selectedPlan ? getDisplayPrice(selectedPlan) : 0;
  const activeDisplayPrice = currentPlan
    ? getDisplayPriceForPeriod(currentPlan, currentBillingPeriod)
    : 0;
  const activeCouponQuote =
    couponQuote &&
    couponQuote.planId === effectiveSelectedPlanId &&
    couponQuote.billingPeriod === billingPeriod
      ? couponQuote
      : null;
  const discountedPrice = activeCouponQuote
    ? activeCouponQuote.discountedAmountMicros / 1_000_000
    : selectedDisplayPrice;
  const immediateAmountDue =
    isAuthoritativeOnChainPlanChange &&
    discountedPrice <= activeDisplayPrice
      ? 0
      : discountedPrice;
  const selectedPlanAlreadyScheduled = matchesTransitionTarget({
    transition: activeTransition,
    planId: effectiveSelectedPlanId,
    billingPeriod,
  });
  const unsupportedOnChainAnnualSelection = isUnsupportedOnChainAnnualSelection(
    selectedPlan,
    billingPeriod,
  );
  const dueTodayAmount = selectedPlanAlreadyScheduled ? 0 : immediateAmountDue;
  const scheduledDowngradeWillBeReplaced = Boolean(
    activeTransition?.changeType === "downgrade" &&
      isOpenTransitionStage(activeTransition) &&
      !selectedPlanAlreadyScheduled &&
      !isCurrentPlanSelected &&
      discountedPrice >= activeDisplayPrice,
  );
  const scheduledSelectionNote =
    selectedPlanAlreadyScheduled && selectedPlan
      ? activeTransition?.changeType === "downgrade"
        ? activeTransition.effectiveAt
          ? `${selectedPlan.name} is already scheduled for ${formatDateLabel(activeTransition.effectiveAt)}. Your current plan stays active until then.`
          : `${selectedPlan.name} is already scheduled as the next renewal plan.`
        : activeTransition?.pendingVerification
          ? `${selectedPlan.name} is already waiting for on-chain confirmation.`
          : `${selectedPlan.name} is already queued as the next subscription change.`
      : null;
  const normalizedCustomerName = normalizeCustomerName(customerName);
  const missingCustomerName = normalizedCustomerName.length === 0;
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const hasCustomerEmail = normalizedCustomerEmail.length > 0;
  const hasInvalidCustomerEmail =
    hasCustomerEmail && !isValidCustomerEmail(normalizedCustomerEmail);
  const requiresBillingIdentity = needsPayment || requiresHostedActivation;

  useEffect(() => {
    setCouponApplied(
      activeCouponQuote
        ? {
            code: activeCouponQuote.code,
            discount: activeCouponQuote.discount,
          }
        : null,
    );
    if (!activeCouponQuote) {
      setCouponError("");
    }
  }, [activeCouponQuote]);

  useEffect(() => {
    if (!didInitializeCouponScope.current) {
      didInitializeCouponScope.current = true;
      return;
    }
    onCouponQuoteChange(null);
    setCouponApplied(null);
    setCouponError("");
  }, [billingPeriod, effectiveSelectedPlanId, onCouponQuoteChange]);

  const nextBill =
    formatDateLabel(data.nextBillingAt) ??
    (selectedPlan && discountedPrice > 0 ? "After activation" : null);

  async function applyCoupon() {
    if (!coupon.trim() || !effectiveSelectedPlanId) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/v1/coupons/validate?code=${encodeURIComponent(coupon.trim())}&planId=${encodeURIComponent(effectiveSelectedPlanId)}&billingPeriod=${encodeURIComponent(billingPeriod)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      if (res.ok) {
        const d = await res.json();
        const nextQuote: AppliedCouponQuote = {
          code: String(d.code ?? coupon.trim().toUpperCase()),
          description: typeof d.description === "string" ? d.description : null,
          discount: Number(d.discount ?? 0),
          planId: String(d.planId ?? effectiveSelectedPlanId),
          billingPeriod: d.billingPeriod === "annual" ? "annual" : "monthly",
          baseAmountMicros: Number(d.baseAmountMicros ?? 0),
          discountedAmountMicros: Number(d.discountedAmountMicros ?? 0),
        };
        setCouponApplied({
          code: nextQuote.code,
          discount: nextQuote.discount,
        });
        onCouponQuoteChange(nextQuote);
      } else {
        const errorData = await res.json().catch(() => ({}));
        onCouponQuoteChange(null);
        setCouponApplied(null);
        setCouponError(
          typeof (errorData as { error?: unknown }).error === "string"
            ? (errorData as { error: string }).error
            : "Invalid or expired coupon",
        );
      }
    } catch {
      // offline fallback — treat as invalid
      onCouponQuoteChange(null);
      setCouponApplied(null);
      setCouponError("Could not validate coupon");
    } finally {
      setCouponLoading(false);
    }
  }

  const S = {
    label: {
      fontSize: tokens.size - 2,
      color: tokens.mutedColor,
      marginBottom: 2,
    } as React.CSSProperties,
    value: {
      fontSize: tokens.size,
      fontWeight: 600,
      color: tokens.textColor,
    } as React.CSSProperties,
    divider: {
      height: 1,
      background: "#e5e7eb",
      margin: "12px 0",
    } as React.CSSProperties,
  };

  return (
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }}>
      {/* Step header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: `2px solid ${tokens.mutedColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: tokens.mutedColor,
              }}
            />
          </div>
          <span
            style={{
              fontSize: tokens.size - 1,
              color: tokens.mutedColor,
              fontWeight: 500,
            }}
          >
            1. Plan
          </span>
        </div>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: tokens.mutedColor,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: tokens.size + 4,
            fontWeight: 700,
            color: tokens.textColor,
            marginBottom: 2,
          }}
        >
          Select plan
        </div>
        <div style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}>
          Choose your base plan
        </div>
      </div>

      {/* Billing period toggle — always shown so users know annual billing is available */}
      <div
        style={{
          display: "flex",
          justifyContent: isMobile ? "flex-start" : "flex-end",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            background: "#f0f0f0",
            borderRadius: 999,
            padding: 3,
          }}
        >
          {(() => {
            const hasAnnualVariant = data.plans.some((p) =>
              hasAnnualBillingOption(p),
            );
            const periods = (["monthly", "annual"] as const).filter(
              (p) => p === "monthly" || hasAnnualVariant,
            );
            return <>{
              periods.map((period) => (
            <button
              key={period}
              onClick={() => onBillingPeriodChange(period)}
              style={{
                padding: isMobile ? "5px 10px" : "6px 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: isMobile ? tokens.size - 2 : tokens.size - 1,
                fontWeight: 600,
                background: billingPeriod === period ? "#fff" : "transparent",
                color:
                  billingPeriod === period
                    ? tokens.textColor
                    : tokens.mutedColor,
                boxShadow:
                  billingPeriod === period
                    ? "0 1px 4px rgba(0,0,0,0.12)"
                    : "none",
                transition: "all 0.15s",
                position: "relative",
                whiteSpace: "nowrap",
              }}
            >
              {isMobile
                ? period === "monthly"
                  ? "Monthly"
                  : "Yearly"
                : period === "monthly"
                  ? "Billed monthly"
                  : "Billed yearly"}
              {period === "annual" && hasAnyAnnualPrice && (
                <span
                  style={{
                    marginLeft: 5,
                    fontSize: tokens.size - 3,
                    fontWeight: 700,
                    color: billingPeriod === "annual" ? "#16a34a" : "#16a34a",
                    background: "#dcfce7",
                    padding: "1px 5px",
                    borderRadius: 4,
                  }}
                >
                  Save
                </span>
              )}
            </button>
          ))}</>;
          })()}
        </div>
      </div>

      {/* Main grid: plan cards + sidebar */}
      <div
        style={{
          display: "flex",
          flexDirection: isNarrow ? "column" : "row",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Left: plan cards */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: isMobile
              ? "1fr"
              : `repeat(${Math.min(data.plans.length, 3)}, 1fr)`,
            gap: 12,
            minWidth: 0,
            width: isNarrow ? "100%" : undefined,
          }}
        >
          {data.plans.map((plan: ComponentPlanSummary) => {
            const isActive = plan.id === currentPlanId;
            const isSelected = plan.id === effectiveSelectedPlanId;
            const price = getDisplayPrice(plan);
            const monthlyPrice = parseFloat(String(plan.price));
            const annualVal = plan.annualPrice
              ? parseFloat(String(plan.annualPrice))
              : 0;

            return (
              <div
                key={plan.id}
                onClick={() => onSelectPlan(plan.id)}
                style={{
                  padding: isMobile ? "18px 14px" : "24px 20px",
                  borderRadius: tokens.radius,
                  border: isSelected
                    ? `2px solid ${tokens.primary}`
                    : `1px solid #e5e7eb`,
                  background: tokens.bg,
                  cursor: "pointer",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: isMobile ? 140 : 180,
                  boxSizing: "border-box",
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      background: tokens.primary,
                      color: isLightColor(tokens.primary) ? "#000" : "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "3px 10px",
                      borderRadius: 999,
                      letterSpacing: "0.03em",
                    }}
                  >
                    Active
                  </div>
                )}
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: tokens.size + 6,
                    color: tokens.textColor,
                    marginBottom: 4,
                  }}
                >
                  {plan.name}
                </div>
                {plan.description && (
                  <div
                    style={{
                      fontSize: tokens.size - 1,
                      color: tokens.mutedColor,
                      marginBottom: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    {plan.description}
                  </div>
                )}
                <div style={{ marginBottom: 20 }}>
                  <span
                    style={{
                      fontSize: tokens.size + 14,
                      fontWeight: 800,
                      color: tokens.textColor,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {price === 0 ? "$0.00" : `$${price.toFixed(2)}`}
                  </span>
                  {price > 0 && (
                    <span
                      style={{
                        fontSize: tokens.size,
                        color: tokens.mutedColor,
                      }}
                    >
                      /
                      {billingPeriod === "annual" && annualVal > 0
                        ? "year"
                        : "month"}
                    </span>
                  )}
                  {billingPeriod === "annual" &&
                    annualVal > 0 &&
                    monthlyPrice > 0 && (
                      <div
                        style={{
                          fontSize: tokens.size - 1,
                          color: "#16a34a",
                          marginTop: 4,
                          fontWeight: 500,
                        }}
                      >
                        Save{" "}
                        {Math.round(
                          (1 - annualVal / (monthlyPrice * 12)) * 100,
                        )}
                        % vs monthly
                      </div>
                    )}
                </div>
                <div style={{ flex: 1 }}>
                  {(() => {
                    const planEntitlements: any[] =
                      (plan.metadata as any)?.entitlements ?? [];
                    const features = planEntitlements.filter(
                      (e: any) => e.enabled === true,
                    );
                    if (features.length === 0) return null;

                    const iconMap = new Map<string | any, string | null>();
                    (data.entitlements as any[])?.forEach((ent: any) => {
                      if (ent.icon && ent.featureKey) {
                        iconMap.set(ent.featureKey, ent.icon);
                      }
                    });

                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          paddingBottom: 14,
                        }}
                      >
                        {features.slice(0, 8).map(
                          (
                            ent: {
                              featureName: string;
                              featureKey: string;
                              type: string;
                              value: boolean | number | null;
                              icon?: string | null;
                            },
                            i: number,
                          ) => {
                            const featureIcon =
                              ent.icon || iconMap.get(ent.featureKey) || null;
                            const renderedFeatureIcon = renderFeatureIconNode(
                              featureIcon,
                              16,
                            );

                            return (
                              <div
                                key={ent.featureKey || i}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                  fontSize: tokens.size - 1,
                                  color: tokens.mutedColor,
                                  lineHeight: 1.35,
                                }}
                              >
                                <span
                                  style={{
                                    flexShrink: 0,
                                    width: featureIcon ? 20 : 16,
                                    fontWeight: 700,
                                    textAlign: "center",
                                    marginTop: 1,
                                    fontSize:
                                      featureIcon &&
                                      !isSvgFeatureIcon(featureIcon) &&
                                      featureIcon.length <= 2
                                        ? tokens.size
                                        : tokens.size - 2,
                                    color: tokens.mutedColor,
                                  }}
                                >
                                  {renderedFeatureIcon ? (
                                    renderedFeatureIcon
                                  ) : ent.type === "BOOLEAN" ? (
                                    ent.value === true ? (
                                      <span style={{ color: "#16a34a" }}>
                                        ✓
                                      </span>
                                    ) : (
                                      <span style={{ color: "#d1d5db" }}>
                                        —
                                      </span>
                                    )
                                  ) : ent.type === "UNLIMITED" ? (
                                    <span
                                      style={{
                                        color: tokens.primary,
                                        fontWeight: 600,
                                      }}
                                    >
                                      ∞
                                    </span>
                                  ) : (
                                    <span style={{ color: tokens.primary }}>
                                      •
                                    </span>
                                  )}
                                </span>
                                <span>
                                  {ent.type === "NUMERIC" && ent.value != null
                                    ? `${ent.value} ${ent.featureName || ent.featureKey}`
                                    : ent.featureName || ent.featureKey}
                                </span>
                              </div>
                            );
                          },
                        )}
                        {features.length > 8 && (
                          <div
                            style={{
                              fontSize: 11,
                              color: tokens.mutedColor,
                              fontStyle: "italic",
                            }}
                          >
                            +{features.length - 8} more
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {isActive ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: tokens.size - 1,
                      color: tokens.mutedColor,
                      paddingTop: 12,
                      borderTop: "1px solid #f0f0f0",
                    }}
                  >
                    <span>✓</span> Current plan
                  </div>
                ) : (
                  <button
                    style={{
                      width: "100%",
                      padding: "11px 0",
                      borderRadius: tokens.radius / 1.5,
                      background: isSelected
                        ? `${tokens.primary}14`
                        : tokens.primary,
                      color: isSelected
                        ? tokens.primary
                        : isLightColor(tokens.primary)
                          ? "#000"
                          : "#fff",
                      border: isSelected
                        ? `1px solid ${tokens.primary}`
                        : "none",
                      cursor: "pointer",
                      fontSize: tokens.size,
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    {isSelected ? "Selected plan" : "Choose plan"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: subscription summary */}
        <div
          style={{
            width: isNarrow ? "100%" : 300,
            flexShrink: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: tokens.radius,
            overflow: "hidden",
          }}
        >
          <div
            style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0" }}
          >
            <div
              style={{
                fontSize: tokens.size - 1,
                color: tokens.mutedColor,
                fontWeight: 500,
              }}
            >
              Subscription
            </div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {/* Plan row */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 2,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                    }}
                  >
                    Plan
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size,
                      color: tokens.textColor,
                    }}
                  >
                    {selectedPlan?.name ?? currentPlan?.name ?? "Free"}
                  </div>
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: tokens.size,
                    color: tokens.textColor,
                  }}
                >
                  {selectedDisplayPrice === 0
                    ? `$0.00/${billingPeriodUnit(billingPeriod)}`
                    : `$${selectedDisplayPrice.toFixed(2)}/${billingPeriodUnit(billingPeriod)}`}
                </div>
              </div>
            </div>

            <div style={S.divider} />

            {/* Coupon code */}
            <div style={{ marginBottom: 12 }}>
              {couponApplied ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      fontSize: tokens.size - 1,
                      color: "#16a34a",
                      fontWeight: 500,
                    }}
                  >
                    {couponApplied.code} — {couponApplied.discount}% off
                  </div>
                  <button
                    onClick={() => {
                      setCouponApplied(null);
                      setCoupon("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={coupon}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setCoupon(e.target.value);
                        setCouponError("");
                      }}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter" && couponsSupported)
                          applyCoupon();
                      }}
                      placeholder="Coupon code"
                      disabled={!couponsSupported}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #e5e7eb",
                        fontSize: tokens.size - 1,
                        outline: "none",
                        fontFamily: tokens.font,
                        opacity: couponsSupported ? 1 : 0.6,
                        background: couponsSupported ? "#fff" : "#f9fafb",
                        cursor: couponsSupported ? "text" : "not-allowed",
                      }}
                    />
                    <button
                      onClick={applyCoupon}
                      disabled={
                        couponLoading || !coupon.trim() || !couponsSupported
                      }
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        cursor:
                          couponLoading || !coupon.trim() || !couponsSupported
                            ? "not-allowed"
                            : "pointer",
                        fontSize: tokens.size - 1,
                        fontWeight: 500,
                        color: tokens.textColor,
                        opacity: couponLoading || !couponsSupported ? 0.6 : 1,
                      }}
                    >
                      {couponLoading ? "…" : "Apply"}
                    </button>
                  </div>
                  {!couponsSupported && (
                    <div
                      style={{
                        fontSize: tokens.size - 2,
                        color: tokens.mutedColor,
                        marginTop: 4,
                      }}
                    >
                      Coupons are not supported for this subscription lifecycle
                      flow.
                    </div>
                  )}
                </>
              )}
              {couponError && (
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: "#ef4444",
                    marginTop: 4,
                  }}
                >
                  {couponError}
                </div>
              )}
            </div>

            <div style={S.divider} />

            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 6,
                }}
              >
                Full name
              </div>
              <input
                value={customerName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onCustomerNameChange(e.target.value)
                }
                placeholder="Jane Doe"
                autoComplete="name"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: `1px solid ${missingCustomerName && requiresBillingIdentity ? "#fecaca" : "#e5e7eb"}`,
                  fontSize: tokens.size - 1,
                  outline: "none",
                  fontFamily: tokens.font,
                  boxSizing: "border-box",
                }}
              />
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color:
                    missingCustomerName && requiresBillingIdentity
                      ? "#dc2626"
                      : tokens.mutedColor,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {missingCustomerName && requiresBillingIdentity
                  ? "Enter the customer's full name so invoices and receipts show the correct billing identity."
                  : "This name appears on invoices, receipts, and billing records for the customer."}
              </div>
            </div>

            <div style={S.divider} />

            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 6,
                }}
              >
                Billing email
              </div>
              <input
                value={customerEmail}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onCustomerEmailChange(e.target.value)
                }
                placeholder="you@company.com"
                type="email"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: `1px solid ${hasInvalidCustomerEmail ? "#fecaca" : "#e5e7eb"}`,
                  fontSize: tokens.size - 1,
                  outline: "none",
                  fontFamily: tokens.font,
                  boxSizing: "border-box",
                }}
              />
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: hasInvalidCustomerEmail
                    ? "#dc2626"
                    : tokens.mutedColor,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {hasInvalidCustomerEmail
                  ? "Enter a valid email address so invoices and billing notices reach the customer."
                  : "Billing email is required for paid subscriptions so we can send receipts, invoices, and subscription notices."}
              </div>
            </div>

            <div style={S.divider} />

            {/* Totals */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span
                style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}
              >
                {billingPeriod === "annual"
                  ? "Annual total:"
                  : "Monthly total:"}
              </span>
              <span
                style={{
                  fontSize: tokens.size - 1,
                  fontWeight: 600,
                  color: tokens.textColor,
                }}
              >
                ${discountedPrice.toFixed(2)}/{billingPeriodUnit(billingPeriod)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <span
                style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}
              >
                Due today:
              </span>
              <span
                style={{
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                  color: tokens.textColor,
                }}
              >
                $
                {isCurrentPlanSelected ? "0.00" : dueTodayAmount.toFixed(2)}
              </span>
            </div>

            {/* CTA */}
            {selectedPlanAlreadyScheduled ? (
              <button
                onClick={onBack}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: tokens.radius / 1.5,
                  background: tokens.primary,
                  color: isLightColor(tokens.primary) ? "#000" : "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                }}
              >
                Back to portal
              </button>
            ) : isCurrentPlanSelected && !isScheduledCancellationResume ? (
              <button
                onClick={onBack}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: tokens.radius / 1.5,
                  background: tokens.primary,
                  color: isLightColor(tokens.primary) ? "#000" : "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                }}
              >
                Close
              </button>
            ) : needsPayment ? (
              <button
                onClick={onNextPayment}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: tokens.radius / 1.5,
                  background: tokens.primary,
                  color: isLightColor(tokens.primary) ? "#000" : "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                  opacity:
                    (requiresBillingIdentity && missingCustomerName) ||
                    hasInvalidCustomerEmail ||
                    (requiresHostedActivation && !hasCustomerEmail) ||
                    unsupportedOnChainAnnualSelection
                      ? 0.6
                      : 1,
                }}
                disabled={
                  (requiresBillingIdentity && missingCustomerName) ||
                  hasInvalidCustomerEmail ||
                  (requiresHostedActivation && !hasCustomerEmail) ||
                  unsupportedOnChainAnnualSelection
                }
              >
                {isScheduledCancellationResume
                  ? "Next: Keep subscription active"
                  : isAuthoritativeOnChainPlanChange
                    ? "Next: Confirm plan change"
                    : requiresHostedActivation
                      ? "Next: Activation instructions"
                      : isCancellationRequiredFirst
                        ? "Next: Cancellation instructions"
                        : "Next: Payment"}
              </button>
            ) : (
              <button
                onClick={onSubscribeClose}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: tokens.radius / 1.5,
                  background: tokens.primary,
                  color: isLightColor(tokens.primary) ? "#000" : "#fff",
                  border: "none",
                  cursor: processing ? "not-allowed" : "pointer",
                  fontSize: tokens.size - 1,
                  fontWeight: 700,
                  opacity: processing || hasInvalidCustomerEmail ? 0.7 : 1,
                }}
                disabled={processing || hasInvalidCustomerEmail}
              >
                {processing ? "Processing…" : "Subscribe and close"}
              </button>
            )}

            {scheduledSelectionNote ? (
              <div
                style={{
                  fontSize: 11,
                  color: tokens.mutedColor,
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                {scheduledSelectionNote}
              </div>
            ) : null}

            {scheduledDowngradeWillBeReplaced ? (
              <div
                style={{
                  fontSize: 11,
                  color: "#1d4ed8",
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                Continuing with this change will replace the scheduled downgrade
                and keep your current subscription active with the new renewal
                settings.
              </div>
            ) : null}

            {unsupportedOnChainAnnualSelection ? (
              <div
                style={{
                  fontSize: 11,
                  color: "#c2410c",
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                This plan does not have yearly billing configured yet.
              </div>
            ) : null}

            {/* Billing fine print */}
            {isScheduledCancellationResume ? (
              <div
                style={{
                  fontSize: 11,
                  color: tokens.mutedColor,
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                No charge is due today. This will re-enable future renewals for
                your current subscription before the scheduled end date.
              </div>
            ) : selectedPlan &&
              !isCurrentPlanSelected &&
              discountedPrice > 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: tokens.mutedColor,
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                You will be billed ${discountedPrice.toFixed(2)}/
                {billingPeriodUnit(billingPeriod)} every{" "}
                {billingPeriodWord(billingPeriod)} while the subscription
                remains active.
              </div>
            ) : null}
          </div>

          {/* Next bill info */}
          {nextBill ? (
            <div
              style={{
                padding: "10px 20px",
                borderTop: "1px solid #f0f0f0",
                background: "#fafafa",
              }}
            >
              <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                Next bill due{" "}
                <strong style={{ color: tokens.textColor }}>{nextBill}</strong>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Payment content (inline) — authoritative on-chain flow ──────────────────

function PaymentContent({
  data,
  selectedPlanId,
  billingPeriod,
  apiBaseUrl,
  accessToken,
  couponQuote,
  processing,
  actionError,
  tokens,
  customerName,
  customerEmail,
  onCustomerNameChange,
  onCustomerEmailChange,
  onConfirm,
  onActivationComplete,
  onBack,
  containerWidth,
  smartAccountConfig,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  billingPeriod: "monthly" | "annual";
  apiBaseUrl: string;
  accessToken: string;
  couponQuote: AppliedCouponQuote | null;
  processing: boolean;
  actionError?: string | null;
  tokens: Tokens;
  customerName: string;
  customerEmail: string;
  onCustomerNameChange: (value: string) => void;
  onCustomerEmailChange: (value: string) => void;
  onConfirm: (result?: PlanChangeConfirmation) => void;
  onActivationComplete: (result: {
    txHash?: string;
    pending?: boolean;
    successMsg?: string;
  }) => Promise<void> | void;
  onBack: () => void;
  containerWidth: number;
  smartAccountConfig?: {
    provider?: "pimlico";
    bundlerUrl: string;
    paymasterUrl: string;
    isReady: boolean;
    selfFunded?: boolean;
  } | null;
}) {
  const effectiveSelectedPlanId = resolvePlanSelectionForBillingPeriod({
    plans: data.plans,
    selectedPlanId,
    billingPeriod,
  });
  const selectedPlan = data.plans.find(
    (p: ComponentPlanSummary) => p.id === effectiveSelectedPlanId,
  );
  const activePlan = data.activePlan;
  const activeTransition = getSubscriptionTransition(data);
  const scheduledCancellation = getScheduledCancellationTransition(data);
  const runtimeChainId = useRuntimeChainId();
  const { address, isConnected } = useSafeAccount();
  const { walletClient: wagmiWalletClient } = useSafeWalletClient();
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [localProvider, setLocalProvider] = useState<WindowEthereum | null>(
    null,
  );
  const [connecting, setConnecting] = useState(false);
  const [txStatus, setTxStatus] = useState<
    "idle" | "approving" | "confirmed" | "error"
  >("idle");
  const [txError, setTxError] = useState("");
  const [planChangePreview, setPlanChangePreview] =
    useState<PlanChangeProrationSummary | null>(null);
  const [planChangePreviewError, setPlanChangePreviewError] = useState("");
  const [planChangePreviewLoading, setPlanChangePreviewLoading] =
    useState(false);

  const basePrice = getPlanDisplayPrice(selectedPlan, billingPeriod);
  const activeBillingPeriod = resolveActiveBillingPeriod({
    billingPeriod: data.billingPeriod,
    activePlan,
  });
  const activePlanPrice = getPlanDisplayPrice(activePlan, activeBillingPeriod);
  const activeCouponQuote =
    couponQuote &&
    couponQuote.planId === effectiveSelectedPlanId &&
    couponQuote.billingPeriod === billingPeriod
      ? couponQuote
      : null;
  const price = activeCouponQuote
    ? activeCouponQuote.discountedAmountMicros / 1_000_000
    : basePrice;
  const normalizedCustomerName = normalizeCustomerName(customerName);
  const missingCustomerName = normalizedCustomerName.length === 0;
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const hasCustomerEmail = normalizedCustomerEmail.length > 0;
  const hasInvalidCustomerEmail =
    hasCustomerEmail && !isValidCustomerEmail(normalizedCustomerEmail);
  const paymentMethod = data.paymentMethod as ComponentPaymentMethod | null;
  const chainId = paymentMethod?.chainId ?? runtimeChainId;
  const serverSmartAccountAddress =
    typeof paymentMethod?.walletAddress === "string"
      ? paymentMethod.walletAddress
      : null;
  const smartAccountAddress = serverSmartAccountAddress;
  const hasSmartAccountInfra = Boolean(
    chainId &&
      hasSmartAccountInfrastructure({
        chainId,
        bundlerUrl: smartAccountConfig?.bundlerUrl,
        paymasterUrl: smartAccountConfig?.paymasterUrl,
      }),
  );
  const selectedOnChainPlanId = selectedPlan?.onChainPlanId ?? null;
  const activeOnChainPlanId = activePlan?.onChainPlanId ?? null;
  const isCurrentPlanSelected = isCurrentBillingSelection({
    activePlanId: activePlan?.id ?? null,
    selectedPlanId: effectiveSelectedPlanId,
    activeBillingPeriod,
    selectedBillingPeriod: billingPeriod,
  });
  const isScheduledCancellationResume = Boolean(
    scheduledCancellation &&
    selectedPlan?.onChainPlanId &&
    isCurrentPlanSelected,
  );
  const isOnChainPlanChange = Boolean(
    selectedPlan &&
    activePlan &&
    selectedOnChainPlanId &&
    activeOnChainPlanId &&
    !isCurrentPlanSelected,
  );
  const requiresHostedActivation = Boolean(
    selectedOnChainPlanId && !activeOnChainPlanId && !isCurrentPlanSelected,
  );
  const requiresResumeActivation = Boolean(isScheduledCancellationResume);
  const requiresBillingIdentity =
    price > 0 ||
    requiresResumeActivation ||
    requiresHostedActivation ||
    isOnChainPlanChange;
  const hasUnsupportedPaidFlow =
    price > 0 &&
    !requiresResumeActivation &&
    !isOnChainPlanChange &&
    !requiresHostedActivation &&
    selectedPlan?.id !== activePlan?.id;
  const unsupportedOnChainAnnualSelection = isUnsupportedOnChainAnnualSelection(
    selectedPlan,
    billingPeriod,
  );
  const isImmediateOnChainUpgrade =
    isOnChainPlanChange && basePrice > activePlanPrice;
  const scheduledDowngradeWillBeReplaced = Boolean(
    isImmediateOnChainUpgrade &&
      activeTransition?.changeType === "downgrade" &&
      isOpenTransitionStage(activeTransition),
  );
  const immediateAmountDue = isImmediateOnChainUpgrade
    ? Number.parseFloat(planChangePreview?.amountDue ?? "0")
    : isOnChainPlanChange
      ? 0
      : price;

  const isNarrowPayment = containerWidth < 700;
  const finalAddress = address || localAddress;
  const finalConnected = isConnected || !!localAddress;
  const resolvedWalletClient =
    wagmiWalletClient ??
    (chainId
      ? createBrowserWalletClient({
          chainId,
          account: finalAddress,
          provider: localProvider,
        })
      : null);
  const resolvedWalletAddress =
    resolvedWalletClient?.account?.address ?? finalAddress ?? null;
  const requiresSmartAccountPlanChangeExecution = Boolean(
    isOnChainPlanChange &&
    smartAccountAddress &&
    resolvedWalletAddress &&
    smartAccountAddress.toLowerCase() !==
      resolvedWalletAddress.toLowerCase(),
  );

  async function connectWindowEthereum(walletKind?: WalletKind) {
    setTxError("");
    setTxStatus("idle");
    setConnecting(true);
    try {
      const result = await requestWindowEthereumAccounts(walletKind);
      setPreferredWindowEthereum(result.provider);
      setLocalProvider(result.provider);
      setLocalAddress(result.accounts[0] ?? null);
    } catch (error) {
      setTxStatus("error");
      setTxError(getWalletConnectionErrorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function submitPaymentAccountTransaction(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    smartAccountAddressOverride?: `0x${string}`;
  }) {
    if (!chainId || !resolvedWalletClient) {
      throw new Error("A connected wallet is required before continuing.");
    }

    const effectiveSmartAccountAddress =
      params.smartAccountAddressOverride ?? smartAccountAddress;

    const prefersSponsoredExecution = Boolean(
      effectiveSmartAccountAddress && hasSmartAccountInfra,
    );

    if (prefersSponsoredExecution) {
      if (!effectiveSmartAccountAddress) {
        throw new Error(
          "Autopay setup requires additional configuration on this account.",
        );
      }

      await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

      try {
        return await sendSmartAccountTransaction({
          bundlerUrl: smartAccountConfig?.bundlerUrl,
          paymasterUrl: smartAccountConfig?.paymasterUrl,
          chainId,
          walletClient: resolvedWalletClient,
          smartAccountAddress: effectiveSmartAccountAddress as `0x${string}`,
          to: params.to,
          data: params.data,
        });
      } catch (error) {
        const canFallbackToDirectWalletExecution = Boolean(
          effectiveSmartAccountAddress &&
            resolvedWalletAddress &&
            effectiveSmartAccountAddress.toLowerCase() ===
              resolvedWalletAddress.toLowerCase() &&
            isUnsupportedEip7702AuthorizationError(error),
        );

        if (!canFallbackToDirectWalletExecution) {
          throw error;
        }

        return submitWalletTransaction({
          chainId,
          walletClient: resolvedWalletClient,
          account: resolvedWalletAddress as `0x${string}`,
          to: params.to,
          data: params.data,
        });
      }
    }

    if (!resolvedWalletAddress) {
      throw new Error("Connect the customer wallet before continuing.");
    }

    return submitWalletTransaction({
      chainId,
      walletClient: resolvedWalletClient,
      account: resolvedWalletAddress as `0x${string}`,
      to: params.to,
      data: params.data,
    });
  }

  async function ensureBillingSmartAccount(): Promise<`0x${string}`> {
    if (!chainId || !resolvedWalletClient) {
      throw new Error(
        "A connected wallet on the target payment chain is required before activation.",
      );
    }

    await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

    if (
      hasSmartAccountInfra &&
      resolvedWalletAddress &&
      isAddress(resolvedWalletAddress)
    ) {
      return resolvedWalletAddress as `0x${string}`;
    }

    if (smartAccountAddress && isAddress(smartAccountAddress)) {
      return smartAccountAddress as `0x${string}`;
    }

    if (!hasSmartAccountInfra) {
      throw new Error(
        "Gas sponsorship is not configured for this chain yet. Configure Pimlico bundler and paymaster support before activating subscriptions.",
      );
    }

    return getCounterfactualSmartAccountAddress(
      resolvedWalletClient,
      chainId,
    );
  }

  async function requestHostedActivation(body: {
    planId: string;
    paymentAccount: `0x${string}`;
    subscriberEmail?: string;
    company: {
      id?: string;
      wallet: string;
      name?: string;
      email?: string;
    };
    activationTxHash?: `0x${string}`;
  }) {
    const res = await fetch(`${apiBaseUrl}/api/v1/subscriptions/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      data?: {
        txHash?: string;
        activationRequired?: boolean;
        preparedTransaction?: {
          target?: string;
          value?: string;
          data?: string;
          functionSignature?: string;
        };
      };
    };

    return { res, json };
  }

  async function confirmHostedActivation(params: {
    body: {
      planId: string;
      paymentAccount: `0x${string}`;
      subscriberEmail?: string;
      company: {
        id?: string;
        wallet: string;
        name?: string;
        email?: string;
      };
    };
    activationTxHash: `0x${string}`;
  }) {
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { res, json } = await requestHostedActivation({
        ...params.body,
        activationTxHash: params.activationTxHash,
      });

      if (res.ok) {
        return {
          txHash: (json.data?.txHash ??
            params.activationTxHash) as `0x${string}`,
          pending: res.status === 202,
        };
      }

      if (res.status === 425 && attempt < maxAttempts - 1) {
        await sleep(2_000);
        continue;
      }

      throw new Error(json.error ?? `HTTP ${res.status}`);
    }

    throw new Error(
      "Subscription activation is still waiting for chain confirmations. Please try again in a moment.",
    );
  }

  async function ensureAutopayReadyForActivation(onChainPlanId: string) {
    if (!chainId) {
      throw new Error("Missing payment chain for autopay setup.");
    }
    const paymentChainId = chainId;

    const billingPaymentAccount = await ensureBillingSmartAccount();

    const targetPlan = await readOnChainPlan(paymentChainId, onChainPlanId);
    if (!targetPlan?.active) {
      throw new Error("The selected on-chain plan is not active anymore.");
    }
    if (
      !targetPlan.provider ||
      !targetPlan.acceptedToken ||
      typeof targetPlan.billingInterval !== "number"
    ) {
      throw new Error(
        "The selected on-chain plan is missing billing metadata.",
      );
    }

    const contracts = getContractAddresses(paymentChainId);
    const autopayAddress = contracts.autopayModule as `0x${string}`;
    const tokenAddress = targetPlan.acceptedToken as `0x${string}`;
    const { chargeAmount, interval: configuredInterval } =
      resolveOnChainAutopayConfigForBillingPeriod({
        selectedPlan,
        targetPlan,
        billingPeriod,
      });
    assertOnChainPlanSupportsConfiguredCharge({
      selectedPlan,
      targetPlan,
      billingPeriod,
      chargeAmount,
    });
    if (chargeAmount <= 0n) {
      throw new Error("The selected on-chain plan has no billable amount.");
    }

    async function buildNextConfig() {
      const chainNow = await readChainTimestampSeconds(paymentChainId);
      return {
        merchant: targetPlan.provider as `0x${string}`,
        maxAmount: chargeAmount,
        token: tokenAddress,
        interval: configuredInterval,
        // Use chain time instead of browser time so wallet-confirmation delays
        // and local clock skew do not immediately invalidate the install.
        startTime: chainNow + BigInt(AUTOPAY_START_TIME_BUFFER_SECONDS),
        planId: BigInt(onChainPlanId),
        maxTotalAmount: 0n,
      };
    }

    let nextConfig = await buildNextConfig();
    const maxApprovalAmount = chargeAmount * 13n;

    async function waitForAutopaySetupReadiness() {
      const maxAttempts = 6;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const initialized = await readAutopayInitialized(
          paymentChainId,
          billingPaymentAccount,
        );

        if (initialized) {
          const isPaused = await readAutopayPaused(
            paymentChainId,
            billingPaymentAccount,
          );
          const currentConfig = await readAutopayConfig(
            paymentChainId,
            billingPaymentAccount,
          );
          const configMatches =
            String(currentConfig.merchant ?? "").toLowerCase() ===
              nextConfig.merchant.toLowerCase() &&
            BigInt(currentConfig.maxAmount ?? 0n) === nextConfig.maxAmount &&
            String(currentConfig.token ?? "").toLowerCase() ===
              nextConfig.token.toLowerCase() &&
            Number(currentConfig.interval ?? 0) === nextConfig.interval &&
            BigInt(currentConfig.planId ?? 0n) === nextConfig.planId;

          if (configMatches && !isPaused) {
            return;
          }
        }

        if (attempt < maxAttempts - 1) {
          await sleep(1_000);
        }
      }

      throw new Error(
        "Automatic payments setup has not finished syncing for this payment account yet. Please wait a moment and try Activate subscription again.",
      );
    }

    const isInitialized = await readAutopayInitialized(
      paymentChainId,
      billingPaymentAccount,
    );
    if (!isInitialized) {
      let installError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        nextConfig = await buildNextConfig();
        const installData = encodeFunctionData({
          abi: ERC7579AutopayModuleABI,
          functionName: "onInstall",
          args: [encodeAutopayInstallData(nextConfig)],
        });

        try {
          await submitPaymentAccountTransaction({
            to: autopayAddress,
            data: installData,
          });
          installError = null;
          break;
        } catch (error) {
          installError = error;
          if (isUserRejectedWalletAction(error)) {
            throw error;
          }

          const initializedAfterFailure = await readAutopayInitialized(
            paymentChainId,
            billingPaymentAccount,
          );
          if (initializedAfterFailure) {
            installError = null;
            break;
          }
        }
      }

      if (installError) {
        const installMessage =
          installError instanceof Error
            ? installError.message
            : "Automatic payment setup did not complete.";
        throw new Error(installMessage);
      }
    } else {
      const currentConfig = await readAutopayConfig(
        paymentChainId,
        billingPaymentAccount,
      );
      const configMatches =
        String(currentConfig.merchant ?? "").toLowerCase() ===
          nextConfig.merchant.toLowerCase() &&
        BigInt(currentConfig.maxAmount ?? 0n) === nextConfig.maxAmount &&
        String(currentConfig.token ?? "").toLowerCase() ===
          nextConfig.token.toLowerCase() &&
        Number(currentConfig.interval ?? 0) === nextConfig.interval &&
        BigInt(currentConfig.planId ?? 0n) === nextConfig.planId;

      if (!configMatches) {
        const updateData = encodeFunctionData({
          abi: ERC7579AutopayModuleABI,
          functionName: "updateConfig",
          args: [
            {
              ...nextConfig,
              maxTotalAmount:
                typeof currentConfig.maxTotalAmount === "bigint"
                  ? currentConfig.maxTotalAmount
                  : 0n,
            },
          ],
        });

        await submitPaymentAccountTransaction({
          to: autopayAddress,
          data: updateData,
        });
      }

      const isPaused = await readAutopayPaused(
        paymentChainId,
        billingPaymentAccount,
      );
      if (isPaused) {
        const unpauseData = encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "unpauseAccount",
              inputs: [],
              outputs: [],
              stateMutability: "nonpayable",
            },
          ],
          functionName: "unpauseAccount",
          args: [],
        });

        await submitPaymentAccountTransaction({
          to: autopayAddress,
          data: unpauseData,
        });
      }
    }

    await waitForAutopaySetupReadiness();

    const approveData = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "approve",
      args: [autopayAddress, maxApprovalAmount],
    });

    await submitPaymentAccountTransaction({
      to: tokenAddress,
      data: approveData,
    });

    const allowanceCheckClient = createPublicClient({
      chain: getChain(paymentChainId),
      transport: http(),
    });
    const allowance = (await allowanceCheckClient.readContract({
      address: tokenAddress,
      abi: [
        {
          type: "function",
          name: "allowance",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "allowance",
      args: [billingPaymentAccount, autopayAddress],
    })) as bigint;

    if (allowance < chargeAmount) {
      throw new Error(
        "Token approval did not stick for the payment account. Please try activation again after confirming the approval transaction.",
      );
    }

    return billingPaymentAccount;
  }

  async function fetchImmediateUpgradePreview(
    signal?: AbortSignal,
  ): Promise<PlanChangeProrationSummary> {
    if (!effectiveSelectedPlanId) {
      throw new Error("Select a destination plan before continuing.");
    }

    const res = await fetch(`${apiBaseUrl}/api/v1/companies/plan/preview`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        planId: effectiveSelectedPlanId,
        billingPeriod,
        ...(normalizedCustomerName ? { customerName: normalizedCustomerName } : {}),
        ...(hasCustomerEmail ? { customerEmail: normalizedCustomerEmail } : {}),
      }),
    });

    const json = (await res
      .json()
      .catch(() => ({}))) as PlanChangePreviewResponse;
    if (!res.ok) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }

    const proration = json.data?.proration;
    if (!proration) {
      throw new Error("Upgrade preview is missing proration details.");
    }

    return proration;
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    if (!isImmediateOnChainUpgrade || !effectiveSelectedPlanId) {
      setPlanChangePreview(null);
      setPlanChangePreviewError("");
      setPlanChangePreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setPlanChangePreviewLoading(true);
    setPlanChangePreviewError("");

    void fetchImmediateUpgradePreview(controller.signal)
      .then((preview) => {
        if (cancelled) return;
        setPlanChangePreview(preview);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Could not calculate the upgrade amount.";
        setPlanChangePreview(null);
        setPlanChangePreviewError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setPlanChangePreviewLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    accessToken,
    apiBaseUrl,
    billingPeriod,
    hasCustomerEmail,
    isImmediateOnChainUpgrade,
    normalizedCustomerEmail,
    effectiveSelectedPlanId,
  ]);

  async function handlePay() {
    setTxError("");
    if (price === 0) {
      onConfirm({});
      return;
    }

    if (unsupportedOnChainAnnualSelection) {
      setTxStatus("error");
      setTxError(
        "This plan does not have yearly billing configured yet.",
      );
      return;
    }

    if (requiresResumeActivation || requiresHostedActivation) {
      if (!selectedOnChainPlanId || !selectedPlan) {
        setTxStatus("error");
        setTxError(
          requiresResumeActivation
            ? "Missing plan metadata for subscription reactivation."
            : "Missing on-chain plan metadata for activation.",
        );
        return;
      }

      if (!finalAddress) {
        setTxStatus("error");
        setTxError("Connect a wallet before activating this subscription.");
        return;
      }

      if (hasInvalidCustomerEmail) {
        setTxStatus("error");
        setTxError(
          requiresResumeActivation
            ? "Enter a valid billing email before continuing."
            : "Enter a valid billing email before activating.",
        );
        return;
      }

      if (missingCustomerName && requiresBillingIdentity) {
        setTxStatus("error");
        setTxError("Enter the customer's full name before continuing.");
        return;
      }

      if (requiresHostedActivation && !hasCustomerEmail) {
        setTxStatus("error");
        setTxError("Enter a billing email before activating.");
        return;
      }

      setTxStatus("approving");
      try {
        const readyPaymentAccount = await ensureAutopayReadyForActivation(
          selectedOnChainPlanId,
        );
        const company =
          (data.company as Record<string, unknown> | null | undefined) ?? null;
        const body = {
          planId: selectedOnChainPlanId,
          paymentAccount: readyPaymentAccount,
          ...(hasCustomerEmail
            ? { subscriberEmail: normalizedCustomerEmail }
            : {}),
          company: {
            ...(typeof company?.id === "string" && company.id.trim()
              ? { id: String(company.id).trim() }
              : {}),
            wallet:
              typeof company?.walletAddress === "string" &&
              company.walletAddress.trim()
                ? String(company.walletAddress)
                : readyPaymentAccount,
            ...(normalizedCustomerName
              ? { name: normalizedCustomerName }
              : typeof company?.name === "string" && company.name.trim()
                ? { name: String(company.name) }
                : {}),
            ...(hasCustomerEmail
              ? { email: normalizedCustomerEmail }
              : typeof company?.email === "string" && company.email.trim()
                ? { email: String(company.email).trim().toLowerCase() }
                : {}),
          },
        };

        const { res, json } = await requestHostedActivation(body);
        if (!res.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }

        let activationResult: {
          txHash?: string;
          pending?: boolean;
        } = {
          txHash: json.data?.txHash,
          pending: res.status === 202,
        };

        if (json.data?.activationRequired) {
          const preparedTarget = json.data.preparedTransaction?.target;
          const preparedData = json.data.preparedTransaction?.data;

          if (!preparedTarget || !isAddress(preparedTarget) || !preparedData) {
            throw new Error(
              "Hosted activation returned an invalid sponsored transaction payload.",
            );
          }

          const activationTx = await submitPaymentAccountTransaction({
            to: preparedTarget as `0x${string}`,
            data: preparedData as `0x${string}`,
            smartAccountAddressOverride: readyPaymentAccount,
          });

          activationResult = await confirmHostedActivation({
            body,
            activationTxHash: activationTx.txHash,
          });
        }

        setTxStatus("confirmed");
        await onActivationComplete({
          txHash: activationResult.txHash,
          pending: activationResult.pending,
          successMsg: requiresResumeActivation
            ? "Subscription will continue. Future renewals are active again."
            : undefined,
        });
      } catch (err: unknown) {
        setTxStatus("error");
        const msg =
          err instanceof Error
            ? err.message
            : requiresResumeActivation
              ? "Subscription reactivation failed"
              : "Activation failed";
        if (isUserRejectedWalletAction(err)) {
          setTxError("Transaction cancelled");
        } else {
          setTxError(msg.slice(0, 160));
        }
      }
      return;
    }

    if (!isOnChainPlanChange) {
      setTxStatus("error");
      setTxError(
        "This embed does not support direct payments for plan changes. Please use the checkout or select a supported plan.",
      );
      return;
    }

    if (!chainId || !smartAccountAddress || !selectedOnChainPlanId) {
      setTxStatus("error");
      setTxError("Missing subscription metadata for this plan change.");
      return;
    }

    if (
      !resolvedWalletClient ||
      (requiresSmartAccountPlanChangeExecution && !hasSmartAccountInfra)
    ) {
      throw new Error("Connect your wallet before making plan changes.");
      return;
    }

    setTxStatus("approving");
    try {
      await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

      const [currentConfig, targetPlan] = await Promise.all([
        readAutopayConfig(chainId, smartAccountAddress),
        readOnChainPlan(chainId, selectedOnChainPlanId),
      ]);

      if (!targetPlan?.active) {
        throw new Error("The selected on-chain plan is not active anymore.");
      }
      if (!targetPlan.provider || !targetPlan.acceptedToken) {
        throw new Error(
          "The selected on-chain plan is missing billing metadata.",
        );
      }

      const {
        chargeAmount: configuredChargeAmount,
        interval: configuredInterval,
      } = resolveOnChainAutopayConfigForBillingPeriod({
        selectedPlan,
        targetPlan,
        billingPeriod,
      });
      assertOnChainPlanSupportsConfiguredCharge({
        selectedPlan,
        targetPlan,
        billingPeriod,
        chargeAmount: configuredChargeAmount,
      });

      let preview = planChangePreview;
      if (isImmediateOnChainUpgrade) {
        preview = preview ?? (await fetchImmediateUpgradePreview());
        setPlanChangePreview(preview);
      }

      const contracts = getContractAddresses(chainId);
      if (!contracts.autopayModule) {
        throw new Error(
          "Automatic payment system address is not configured for this chain.",
        );
      }

      const updateConfigData = encodeFunctionData({
        abi: ERC7579AutopayModuleABI as any,
        functionName: "updateConfig",
        args: [
          {
            merchant: targetPlan.provider as `0x${string}`,
            maxAmount: configuredChargeAmount,
            token: targetPlan.acceptedToken as `0x${string}`,
            interval: configuredInterval,
            startTime:
              typeof currentConfig.startTime === "bigint"
                ? currentConfig.startTime
                : BigInt(Math.floor(Date.now() / 1000)),
            planId: BigInt(selectedOnChainPlanId),
            maxTotalAmount:
              typeof currentConfig.maxTotalAmount === "bigint"
                ? currentConfig.maxTotalAmount
                : 0n,
          },
        ],
      });

      const { txHash: autopayTxHash } = await submitPaymentAccountTransaction({
        to: contracts.autopayModule as `0x${string}`,
        data: updateConfigData,
        smartAccountAddressOverride:
          smartAccountAddress && isAddress(smartAccountAddress)
            ? (smartAccountAddress as `0x${string}`)
            : undefined,
      });

      let paymentTransferTxHash: `0x${string}` | undefined;
      if (isImmediateOnChainUpgrade) {
        const amountDueAtomic = parseDecimalToAtomicUnits(
          preview?.amountDue ?? "0.000000",
        );

        if (amountDueAtomic > 0n) {
          const paymentTransferData = encodeFunctionData({
            abi: [
              {
                type: "function",
                name: "transfer",
                inputs: [
                  { name: "to", type: "address" },
                  { name: "amount", type: "uint256" },
                ],
                outputs: [{ name: "", type: "bool" }],
                stateMutability: "nonpayable",
              },
            ],
            functionName: "transfer",
            args: [targetPlan.provider as `0x${string}`, amountDueAtomic],
          });

          const paymentTransfer = await submitPaymentAccountTransaction({
            to: targetPlan.acceptedToken as `0x${string}`,
            data: paymentTransferData,
          });
          paymentTransferTxHash = paymentTransfer.txHash;
        }
      }

      setTxStatus("confirmed");
      onConfirm({
        txHash: paymentTransferTxHash ?? autopayTxHash,
        autopayConfigTxHash: autopayTxHash,
        paymentTxHash: paymentTransferTxHash,
        prorationEffectiveAt: preview?.effectiveAt,
      });
    } catch (err: unknown) {
      setTxStatus("error");
      const msg = err instanceof Error ? err.message : "Transaction failed";
      if (isUserRejectedWalletAction(err)) {
        setTxError("Transaction cancelled");
      } else {
        setTxError(msg.slice(0, 120));
      }
    }
  }

  const needsWallet =
    (isOnChainPlanChange ||
      requiresHostedActivation ||
      requiresResumeActivation) &&
    (!finalConnected || !finalAddress);
  const needsWalletClient =
    (isOnChainPlanChange ||
      requiresHostedActivation ||
      requiresResumeActivation) &&
    (!resolvedWalletClient ||
      ((requiresSmartAccountPlanChangeExecution ||
        requiresHostedActivation ||
        requiresResumeActivation) &&
        !hasSmartAccountInfra));
  const hasWindowEth =
    typeof window !== "undefined" &&
    !!(window as unknown as { ethereum?: unknown }).ethereum;

  return (
    <div>
      {/* Step header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: tokens.primary,
              color: isLightColor(tokens.primary) ? "#000" : "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            2
          </div>
          <span
            style={{
              fontSize: tokens.size,
              color: tokens.textColor,
              fontWeight: 600,
            }}
          >
            Payment
          </span>
        </div>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: tokens.size - 1,
            color: tokens.mutedColor,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          ← Back
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: isNarrowPayment ? "column" : "row",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Left: payment section */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isOnChainPlanChange ? (
            /* ── On-chain plan change ── */
            <Card tokens={tokens} style={{ marginBottom: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#2775ca",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}
                  >
                    $
                  </span>
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size,
                      color: tokens.textColor,
                    }}
                  >
                    Update subscription on the blockchain
                  </div>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    Secure payment wallet transaction
                  </div>
                </div>
              </div>

              {needsWallet ? (
                <div>
                  <div
                    style={{
                      fontSize: tokens.size - 1,
                      color: tokens.mutedColor,
                      marginBottom: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    Connect the wallet you use to manage your subscription
                    before authorizing this
                    {isImmediateOnChainUpgrade ? "upgrade" : "plan change"}.
                  </div>
                  {hasWindowEth || isMobileDevice() ? (
                    <WalletSelector
                      tokens={tokens}
                      connecting={connecting}
                      onConnectMetaMask={() => {
                        if (isMobileDevice() && !getWindowEthereum()) {
                          openMetaMaskDeepLink();
                          return;
                        }
                        connectWindowEthereum("metamask");
                      }}
                      onConnectBase={() => {
                        if (isMobileDevice() && !getWindowEthereum()) {
                          openCoinbaseWalletDeepLink();
                          return;
                        }
                        if (!getCoinbaseProvider()) {
                          openCoinbaseWalletDeepLink();
                          return;
                        }
                        connectWindowEthereum("coinbase");
                      }}
                    />
                  ) : (
                    <NoWalletSelector tokens={tokens} />
                  )}
                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: "1px solid #f0f0f0",
                      textAlign: "center",
                      fontSize: 11,
                      color: tokens.mutedColor,
                      lineHeight: 1.6,
                    }}
                  >
                    {isImmediateOnChainUpgrade
                      ? "This route processes the payment update, prorated charge, and applies the new plan."
                      : "This route schedules the selected plan for the next renewal without charging again today."}
                  </div>
                </div>
              ) : needsWalletClient ? (
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    fontSize: tokens.size - 2,
                    color: "#b91c1c",
                    lineHeight: 1.6,
                  }}
                >
                  This embed needs a connected wallet to send plan change
                  transactions.
                </div>
              ) : (
                <div>
                  {/* Connected wallet badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 8,
                      marginBottom: 16,
                    }}
                  >
                    <span
                      style={{
                        color: "#16a34a",
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                    >
                      ✓
                    </span>
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#166534",
                          fontSize: tokens.size - 1,
                        }}
                      >
                        Wallet connected
                      </div>
                      <div
                        style={{
                          color: tokens.mutedColor,
                          fontSize: 11,
                          fontFamily: "monospace",
                          marginTop: 1,
                        }}
                      >
                        {finalAddress!.slice(0, 10)}…{finalAddress!.slice(-6)}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setLocalAddress(null);
                        setLocalProvider(null);
                        setPreferredWindowEthereum(null);
                      }}
                      style={{
                        marginLeft: "auto",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        color: tokens.mutedColor,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>

                  {txStatus === "error" && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#dc2626",
                        marginBottom: 12,
                      }}
                    >
                      {txError || "Transaction failed. Please try again."}
                    </div>
                  )}

                  {planChangePreviewError && isImmediateOnChainUpgrade && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fff7ed",
                        border: "1px solid #fdba74",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#c2410c",
                        marginBottom: 12,
                      }}
                    >
                      {planChangePreviewError}
                    </div>
                  )}

                  {unsupportedOnChainAnnualSelection && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fff7ed",
                        border: "1px solid #fdba74",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#c2410c",
                        marginBottom: 12,
                      }}
                    >
                      This plan does not have yearly billing configured yet.
                    </div>
                  )}

                  {scheduledDowngradeWillBeReplaced && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#1d4ed8",
                        marginBottom: 12,
                      }}
                    >
                      This payment replaces the scheduled downgrade. Your
                      current subscription will stay active and future renewals
                      will use the updated plan settings.
                    </div>
                  )}

                  {planChangePreview && isImmediateOnChainUpgrade && (
                    <div
                      style={{
                        padding: "12px 14px",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        marginBottom: 14,
                        background: "#fafafa",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: tokens.mutedColor,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          marginBottom: 8,
                        }}
                      >
                        Upgrade summary
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: tokens.size - 1,
                          marginBottom: 6,
                          color: tokens.textColor,
                        }}
                      >
                        <span>Remaining charge on new plan</span>
                        <span>
                          {formatUsdFromDecimalString(
                            planChangePreview.newPlanRemainingCharge,
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: tokens.size - 1,
                          marginBottom: 6,
                          color: tokens.textColor,
                        }}
                      >
                        <span>Unused value on current plan</span>
                        <span>
                          {formatUsdFromDecimalString(
                            planChangePreview.unusedOldPlanCredit,
                          )}
                        </span>
                      </div>
                      {Number(planChangePreview.availableBillingCredit ?? 0) >
                      0 ? (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: tokens.size - 1,
                            marginBottom: 6,
                            color: tokens.textColor,
                          }}
                        >
                          <span>Existing wallet credit</span>
                          <span>
                            {formatUsdFromDecimalString(
                              planChangePreview.availableBillingCredit ??
                                "0.000000",
                            )}
                          </span>
                        </div>
                      ) : null}
                      {Number(planChangePreview.billingCreditApplied ?? 0) >
                      0 ? (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: tokens.size - 1,
                            marginBottom: 6,
                            color: tokens.textColor,
                          }}
                        >
                          <span>Wallet credit applied</span>
                          <span>
                            -
                            {formatUsdFromDecimalString(
                              planChangePreview.billingCreditApplied ??
                                "0.000000",
                            )}
                          </span>
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: tokens.size,
                          fontWeight: 700,
                          color: tokens.textColor,
                        }}
                      >
                        <span>Due now</span>
                        <span>
                          {formatUsdFromDecimalString(
                            planChangePreview.amountDue,
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  <PrimaryButton
                    tokens={tokens}
                    fullWidth
                    disabled={
                      processing ||
                      txStatus === "approving" ||
                      unsupportedOnChainAnnualSelection ||
                      (isImmediateOnChainUpgrade &&
                        (planChangePreviewLoading ||
                          Boolean(planChangePreviewError)))
                    }
                    onClick={handlePay}
                  >
                    {planChangePreviewLoading && isImmediateOnChainUpgrade
                      ? "Calculating upgrade…"
                      : txStatus === "approving"
                        ? "Confirm in wallet…"
                        : processing
                          ? "Processing…"
                          : isImmediateOnChainUpgrade
                            ? "Confirm prorated upgrade"
                            : "Authorize plan change"}
                  </PrimaryButton>

                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.mutedColor,
                      marginTop: 10,
                      lineHeight: 1.6,
                    }}
                  >
                    {isImmediateOnChainUpgrade
                      ? "The backend verifies the real prorated payment before it changes your subscription access."
                      : "The backend will verify this payment configuration update and schedule the new plan for the next renewal cycle."}
                  </div>
                </div>
              )}
            </Card>
          ) : requiresResumeActivation || requiresHostedActivation ? (
            <Card tokens={tokens} style={{ marginBottom: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ color: "#2563eb", fontWeight: 800 }}>↗</span>
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size,
                      color: tokens.textColor,
                    }}
                  >
                    {requiresResumeActivation
                      ? "Keep subscription active"
                      : "Activate subscription"}
                  </div>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    {requiresResumeActivation
                      ? "Restore future renewals"
                      : "First bill + automatic payments setup"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: tokens.size - 1,
                  color: tokens.mutedColor,
                  lineHeight: 1.6,
                }}
              >
                {requiresResumeActivation
                  ? "This subscription is already active through the current billing period, but future renewals are turned off. Connect the customer wallet, confirm the payment account again, and we will restore automatic payments for the current plan."
                  : "This portal can activate the subscription directly from your app. Connect the customer wallet, confirm the payment account, and we will create the subscription for the selected plan."}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: tokens.mutedColor,
                    marginBottom: 6,
                  }}
                >
                  Full name
                </div>
                <input
                  value={customerName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onCustomerNameChange(e.target.value)
                  }
                  placeholder="Jane Doe"
                  autoComplete="name"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${missingCustomerName && requiresBillingIdentity ? "#fecaca" : "#e5e7eb"}`,
                    fontSize: tokens.size - 1,
                    outline: "none",
                    fontFamily: tokens.font,
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color:
                      missingCustomerName && requiresBillingIdentity
                        ? "#dc2626"
                        : tokens.mutedColor,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {missingCustomerName && requiresBillingIdentity
                    ? "Enter the customer's full name so billing documents are issued correctly."
                    : "This name is used on invoices, receipts, and subscription billing records."}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: tokens.mutedColor,
                    marginBottom: 6,
                  }}
                >
                  Billing email
                </div>
                <input
                  value={customerEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onCustomerEmailChange(e.target.value)
                  }
                  placeholder="you@company.com"
                  type="email"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${hasInvalidCustomerEmail ? "#fecaca" : "#e5e7eb"}`,
                    fontSize: tokens.size - 1,
                    outline: "none",
                    fontFamily: tokens.font,
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: hasInvalidCustomerEmail
                      ? "#dc2626"
                      : tokens.mutedColor,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {hasInvalidCustomerEmail
                    ? "Enter a valid email address so the subscription can be tied to the correct customer."
                    : requiresResumeActivation
                      ? "You can keep the existing billing email, or update it before future renewals resume."
                      : "Billing email is required for paid activations so ArcenPay can send invoices, receipts, and lifecycle notices."}
                </div>
              </div>

              {needsWallet ? (
                hasWindowEth || isMobileDevice() ? (
                  <WalletSelector
                    tokens={tokens}
                    connecting={connecting}
                    onConnectMetaMask={() => {
                      if (isMobileDevice() && !getWindowEthereum()) {
                        openMetaMaskDeepLink();
                        return;
                      }
                      connectWindowEthereum("metamask");
                    }}
                    onConnectBase={() => {
                      if (isMobileDevice() && !getWindowEthereum()) {
                        openCoinbaseWalletDeepLink();
                        return;
                      }
                      if (!getCoinbaseProvider()) {
                        openCoinbaseWalletDeepLink();
                        return;
                      }
                      connectWindowEthereum("coinbase");
                    }}
                  />
                ) : (
                  <NoWalletSelector tokens={tokens} />
                )
              ) : (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 8,
                      marginBottom: 16,
                    }}
                  >
                    <span
                      style={{
                        color: "#16a34a",
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                    >
                      ✓
                    </span>
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#166534",
                          fontSize: tokens.size - 1,
                        }}
                      >
                        Wallet connected
                      </div>
                      <div
                        style={{
                          color: tokens.mutedColor,
                          fontSize: 11,
                          fontFamily: "monospace",
                          marginTop: 1,
                        }}
                      >
                        {finalAddress!.slice(0, 10)}…{finalAddress!.slice(-6)}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setLocalAddress(null);
                        setLocalProvider(null);
                        setPreferredWindowEthereum(null);
                      }}
                      style={{
                        marginLeft: "auto",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        color: tokens.mutedColor,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>

                  {txStatus === "error" && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#dc2626",
                        marginBottom: 12,
                      }}
                    >
                      {txError || "Activation failed. Please try again."}
                    </div>
                  )}

                  {actionError && (
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: 8,
                        fontSize: tokens.size - 2,
                        color: "#dc2626",
                        marginBottom: 12,
                      }}
                    >
                      {actionError}
                    </div>
                  )}

                  <PrimaryButton
                    tokens={tokens}
                    fullWidth
                    disabled={
                      processing ||
                      txStatus === "approving" ||
                      hasInvalidCustomerEmail ||
                      (requiresHostedActivation && !hasCustomerEmail)
                    }
                    onClick={handlePay}
                  >
                    {txStatus === "approving"
                      ? requiresResumeActivation
                        ? "Restoring renewals…"
                        : "Activating subscription…"
                      : processing
                        ? "Processing…"
                        : requiresResumeActivation
                          ? "Keep subscription active"
                          : "Activate subscription"}
                  </PrimaryButton>
                </div>
              )}
            </Card>
          ) : (
            /* ── Free / unsupported flow ── */
            <Card tokens={tokens} style={{ marginBottom: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size,
                      color: tokens.textColor,
                    }}
                  >
                    Confirm subscription
                  </div>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    {price === 0
                      ? "Free plan · no payment required"
                      : "Authoritative flow required"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    fontSize: tokens.size - 1,
                    color: tokens.mutedColor,
                    lineHeight: 1.6,
                  }}
                >
                  {price === 0
                    ? "This is a free plan. Click below to activate it — no payment needed."
                    : hasUnsupportedPaidFlow
                      ? "Paid changes in this portal must come from a verified subscription flow. Direct payment plan changes are disabled."
                      : "This plan cannot be self-activated until the provider finishes wallet and payment setup."}
                </div>
              </div>

              {txStatus === "error" && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    fontSize: tokens.size - 2,
                    color: "#dc2626",
                    marginBottom: 12,
                  }}
                >
                  {txError || "Something went wrong. Please try again."}
                </div>
              )}

              <PrimaryButton
                tokens={tokens}
                fullWidth
                disabled={processing || price > 0}
                onClick={() => onConfirm(undefined)}
              >
                {processing
                  ? "Activating…"
                  : price === 0
                    ? "Activate free plan"
                    : "Authoritative flow required"}
              </PrimaryButton>
            </Card>
          )}
        </div>

        {/* Right: order summary */}
        <div
          style={{
            width: isNarrowPayment ? "100%" : 260,
            flexShrink: 0,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: tokens.radius,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid #f0f0f0",
              background: "#fafafa",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: tokens.mutedColor,
                fontWeight: 600,
                letterSpacing: "0.02em",
                textTransform: "uppercase" as const,
              }}
            >
              Order summary
            </div>
          </div>
          <div style={{ padding: "16px 18px" }}>
            {selectedPlan ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                      marginBottom: 2,
                    }}
                  >
                    Plan
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: tokens.size + 1,
                      color: tokens.textColor,
                    }}
                  >
                    {selectedPlan.name}
                  </div>
                  {selectedPlan.description && (
                    <div
                      style={{
                        fontSize: tokens.size - 2,
                        color: tokens.mutedColor,
                        marginTop: 2,
                      }}
                    >
                      {selectedPlan.description}
                    </div>
                  )}
                </div>

                <div
                  style={{ height: 1, background: "#e5e7eb", margin: "12px 0" }}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: tokens.size - 1,
                      color: tokens.mutedColor,
                    }}
                  >
                    {billingPeriod === "annual"
                      ? "Annual price"
                      : "Monthly price"}
                  </span>
                  <span
                    style={{
                      fontSize: tokens.size - 1,
                      fontWeight: 600,
                      color: tokens.textColor,
                    }}
                  >
                    {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                  </span>
                </div>

                {activeCouponQuote && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: tokens.size - 1,
                          color: tokens.mutedColor,
                        }}
                      >
                        Coupon ({activeCouponQuote.code})
                      </span>
                      <span
                        style={{
                          fontSize: tokens.size - 1,
                          fontWeight: 600,
                          color: "#16a34a",
                        }}
                      >
                        -$
                        {(
                          (activeCouponQuote.baseAmountMicros -
                            activeCouponQuote.discountedAmountMicros) /
                          1_000_000
                        ).toFixed(2)}
                      </span>
                    </div>

                    <div
                      style={{
                        height: 1,
                        background: "#e5e7eb",
                        margin: "10px 0",
                      }}
                    />
                  </>
                )}

                <div
                  style={{ height: 1, background: "#e5e7eb", margin: "10px 0" }}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: tokens.size - 1,
                      color: tokens.mutedColor,
                      fontWeight: 600,
                    }}
                  >
                    Due today
                  </span>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: tokens.size + 1,
                      color: tokens.textColor,
                    }}
                  >
                    {immediateAmountDue === 0
                      ? "$0.00"
                      : `$${immediateAmountDue.toFixed(2)}`}
                  </span>
                </div>

                {price > 0 &&
                  (isOnChainPlanChange || requiresHostedActivation) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: tokens.mutedColor,
                        marginTop: 6,
                      }}
                    >
                      Subscription on the blockchain
                    </div>
                  )}
              </>
            ) : (
              <div
                style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}
              >
                No plan selected
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Unsubscribe content ──────────────────────────────────────────────────────

function UnsubscribeContent({
  data,
  processing,
  actionError,
  tokens,
  onConfirm,
  onBack,
  containerWidth,
  smartAccountConfig,
}: {
  data: ComponentRenderData;
  processing: boolean;
  actionError?: string | null;
  tokens: Tokens;
  onConfirm: (confirmation: CancellationConfirmation) => void;
  onBack: () => void;
  containerWidth: number;
  smartAccountConfig?: {
    provider?: "pimlico";
    bundlerUrl: string;
    paymasterUrl: string;
    isReady: boolean;
    selfFunded?: boolean;
  } | null;
}) {
  const activePlan = data.activePlan;
  const scheduledCancellation = getScheduledCancellationTransition(data);
  const price = activePlan ? parseFloat(String(activePlan.price)) : 0;
  const activePlanPeriod = activePlan
    ? intervalLabel(Number(activePlan.billingInterval)).replace("/", "") || "mo"
    : "mo";
  const isMobileUnsub = containerWidth < 600;
  const runtimeChainId = useRuntimeChainId();
  const { address, isConnected } = useSafeAccount();
  const { walletClient: wagmiWalletClient } = useSafeWalletClient();
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [localProvider, setLocalProvider] = useState<WindowEthereum | null>(
    null,
  );
  const [connecting, setConnecting] = useState(false);
  const [txStatus, setTxStatus] = useState<
    "idle" | "approving" | "confirmed" | "error"
  >("idle");
  const [txError, setTxError] = useState("");
  const paymentMethod = data.paymentMethod as ComponentPaymentMethod | null;
  const chainId = paymentMethod?.chainId ?? runtimeChainId;
  const smartAccountAddress =
    typeof paymentMethod?.walletAddress === "string"
      ? paymentMethod.walletAddress
      : null;
  const hasSmartAccountInfra = Boolean(
    chainId &&
      hasSmartAccountInfrastructure({
        chainId,
        bundlerUrl: smartAccountConfig?.bundlerUrl,
        paymasterUrl: smartAccountConfig?.paymasterUrl,
      }),
  );
  const finalAddress = address || localAddress;
  const finalConnected = isConnected || !!localAddress;
  const resolvedWalletClient =
    wagmiWalletClient ??
    (chainId
      ? createBrowserWalletClient({
          chainId,
          account: finalAddress,
          provider: localProvider,
        })
      : null);
  const resolvedWalletAddress =
    resolvedWalletClient?.account?.address ?? finalAddress ?? null;
  const requiresOnChainCancellation = Boolean(
    activePlan?.onChainPlanId && smartAccountAddress && price > 0,
  );
  const prefersSponsoredCancellationExecution = Boolean(
    requiresOnChainCancellation && smartAccountAddress && hasSmartAccountInfra,
  );
  const needsWallet =
    requiresOnChainCancellation && (!finalConnected || !finalAddress);
  const needsWalletClient = requiresOnChainCancellation && !resolvedWalletClient;

  async function connectWindowEthereum(walletKind?: WalletKind) {
    setTxError("");
    setTxStatus("idle");
    setConnecting(true);
    try {
      const result = await requestWindowEthereumAccounts(walletKind);
      setPreferredWindowEthereum(result.provider);
      setLocalProvider(result.provider);
      setLocalAddress(result.accounts[0] ?? null);
    } catch (error) {
      setTxStatus("error");
      setTxError(getWalletConnectionErrorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function handleConfirm() {
    setTxError("");

    if (!requiresOnChainCancellation) {
      onConfirm({ intent: "scheduled" });
      return;
    }

    if (!chainId || !smartAccountAddress) {
      setTxStatus("error");
      setTxError("Missing subscription metadata for cancellation.");
      return;
    }

    if (!resolvedWalletClient) {
      setTxStatus("error");
      setTxError("A wallet client is required for on-chain cancellation.");
      return;
    }

    setTxStatus("approving");
    try {
      await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

      const contracts = getContractAddresses(chainId);
      const autopayAddress = contracts.autopayModule as
        | `0x${string}`
        | undefined;
      if (!autopayAddress) {
        throw new Error(
          "Automatic payment system is not available for this chain.",
        );
      }

      const isInitialized = await readAutopayInitialized(
        chainId,
        smartAccountAddress,
      );
      const isPaused = isInitialized
        ? await readAutopayPaused(chainId, smartAccountAddress)
        : false;

      if (!isInitialized || isPaused) {
        setTxStatus("confirmed");
        onConfirm({ intent: "scheduled" });
        return;
      }

      const pauseData = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "pauseAccount",
            inputs: [],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "pauseAccount",
        args: [],
      });

      let txHash: `0x${string}` | undefined;
      if (prefersSponsoredCancellationExecution) {
        try {
          const result = await sendSmartAccountTransaction({
            bundlerUrl: smartAccountConfig?.bundlerUrl,
            paymasterUrl: smartAccountConfig?.paymasterUrl,
            chainId,
            walletClient: resolvedWalletClient,
            smartAccountAddress: smartAccountAddress as `0x${string}`,
            to: autopayAddress,
            data: pauseData,
          });
          txHash = result.txHash;
        } catch (error) {
          const canFallbackToDirectWalletExecution = Boolean(
            resolvedWalletAddress &&
              smartAccountAddress &&
              resolvedWalletAddress.toLowerCase() ===
                smartAccountAddress.toLowerCase() &&
              isUnsupportedEip7702AuthorizationError(error),
          );

          if (!canFallbackToDirectWalletExecution) {
            throw error;
          }

          const result = await submitWalletTransaction({
            chainId,
            walletClient: resolvedWalletClient,
            account: resolvedWalletAddress as `0x${string}`,
            to: autopayAddress,
            data: pauseData,
          });
          txHash = result.txHash;
        }
      } else {
        if (!resolvedWalletAddress) {
          throw new Error("Connect the customer wallet before continuing.");
        }

        const result = await submitWalletTransaction({
          chainId,
          walletClient: resolvedWalletClient,
          account: resolvedWalletAddress as `0x${string}`,
          to: autopayAddress,
          data: pauseData,
        });
        txHash = result.txHash;
      }

      setTxStatus("confirmed");
      onConfirm({
        intent: "scheduled",
        txHash,
      });
    } catch (error) {
      setTxStatus("error");
      setTxError(
        error instanceof Error
          ? error.message
          : "Failed to stop automatic payments.",
      );
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobileUnsub ? "column" : "row",
        minHeight: 260,
      }}
    >
      {/* Left */}
      <div
        style={{
          flex: 1,
          padding: "32px 28px",
          borderRight: isMobileUnsub ? "none" : "1px solid #f0f0f0",
          borderBottom: isMobileUnsub ? "1px solid #f0f0f0" : "none",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: tokens.mutedColor,
            lineHeight: 1,
            marginBottom: 20,
            padding: 0,
          }}
        >
          ×
        </button>
        <div
          style={{
            fontWeight: 800,
            fontSize: tokens.size + 10,
            color: tokens.textColor,
            marginBottom: 8,
          }}
        >
          {scheduledCancellation
            ? "Cancellation already scheduled"
            : "Cancel subscription"}
        </div>
        <div
          style={{
            fontSize: tokens.size - 1,
            color: tokens.mutedColor,
            lineHeight: 1.6,
            marginBottom: 24,
          }}
        >
          {scheduledCancellation
            ? `Your current plan already stays active until ${
                formatDateLabel(scheduledCancellation.effectiveAt) ??
                "the end of the current billing period"
              }. You do not need to submit another cancellation transaction.`
            : requiresOnChainCancellation
              ? "We will stop future automatic payments now. Your current plan stays active until the end of the current billing period, then your subscription moves to Free."
              : "Your current plan stays active until the end of the current billing period, then your subscription moves to Free."}
        </div>
        {requiresOnChainCancellation && (
          <div
            style={{
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              fontSize: tokens.size - 2,
              color: "#b91c1c",
              lineHeight: 1.6,
              marginBottom: 20,
            }}
          >
            This flow stops future automatic payments for the subscription
            payment account right away, then schedules the actual plan downgrade
            for the current billing period end.
          </div>
        )}
        <div
          style={{
            fontSize: tokens.size - 1,
            color: tokens.mutedColor,
            marginBottom: 8,
          }}
        >
          Not ready to cancel?
        </div>
        <button
          onClick={onBack}
          style={{
            padding: "8px 16px",
            borderRadius: tokens.radius / 1.5,
            border: `1px solid #e5e7eb`,
            background: "#fff",
            cursor: "pointer",
            fontSize: tokens.size - 1,
            fontWeight: 500,
            color: tokens.textColor,
          }}
        >
          Manage plan
        </button>
        {needsWallet && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: tokens.size - 1,
                color: tokens.mutedColor,
                lineHeight: 1.6,
                marginBottom: 12,
              }}
            >
              Connect the wallet you use to manage your subscription before
              stopping future automatic payments.
            </div>
            <WalletSelector
              tokens={tokens}
              connecting={connecting}
              onConnectMetaMask={() => {
                if (isMobileDevice() && !getWindowEthereum()) {
                  openMetaMaskDeepLink();
                  return;
                }
                connectWindowEthereum("metamask");
              }}
              onConnectBase={() => {
                if (isMobileDevice() && !getWindowEthereum()) {
                  openCoinbaseWalletDeepLink();
                  return;
                }
                if (!getCoinbaseProvider()) {
                  openCoinbaseWalletDeepLink();
                  return;
                }
                connectWindowEthereum("coinbase");
              }}
            />
          </div>
        )}
        {txStatus === "error" && txError && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              fontSize: tokens.size - 2,
              color: "#dc2626",
            }}
          >
            {txError}
          </div>
        )}
        {actionError && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              fontSize: tokens.size - 2,
              color: "#dc2626",
            }}
          >
            {actionError}
          </div>
        )}
      </div>

      {/* Right: summary + action */}
      <div
        style={{
          width: isMobileUnsub ? "100%" : 260,
          flexShrink: 0,
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: tokens.size - 2,
              color: tokens.mutedColor,
              marginBottom: 2,
            }}
          >
            Plan
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: tokens.size,
                color: tokens.textColor,
              }}
            >
              {activePlan?.name ?? "Free"}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: tokens.size - 1,
                color: tokens.mutedColor,
              }}
            >
              ${price.toFixed(2)}/{activePlanPeriod}
            </span>
          </div>
        </div>
        <div style={{ height: 1, background: "#f0f0f0", marginBottom: 12 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}>
            {activePlanPeriod === "yr" ? "Annual total:" : "Monthly total:"}
          </span>
          <span
            style={{
              fontSize: tokens.size - 1,
              fontWeight: 600,
              color: tokens.textColor,
            }}
          >
            ${price.toFixed(2)}/{activePlanPeriod}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleConfirm}
          disabled={
            processing ||
            txStatus === "approving" ||
            needsWalletClient ||
            Boolean(scheduledCancellation)
          }
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: tokens.radius / 1.5,
            background: tokens.primary,
            color: isLightColor(tokens.primary) ? "#000" : "#fff",
            border: "none",
            cursor: processing ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontSize: tokens.size - 1,
            opacity: processing ? 0.7 : 1,
          }}
        >
          {txStatus === "approving"
            ? "Confirm in wallet…"
            : processing
              ? "Cancelling…"
              : scheduledCancellation
                ? "Cancellation already scheduled"
                : requiresOnChainCancellation
                  ? "Cancel and stop payments at period end"
                  : "Schedule cancellation"}
        </button>
        {needsWalletClient && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "#b91c1c",
              lineHeight: 1.5,
            }}
        >
            {prefersSponsoredCancellationExecution
              ? "This embed needs a wallet client and smart-account provider config to submit the smart-account autopay shutdown transaction."
              : "This embed needs a wallet client to submit the autopay shutdown transaction."}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Full-screen modal ────────────────────────────────────────────────────────
// On mobile: true full-screen. On desktop: centered popup.

let _modalIdCounter = 0;

// ─── Secured-by badge ────────────────────────────────────────────────────────

function SecuredByArcenpay({ tokens }: { tokens: Tokens }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingTop: 16,
        paddingBottom: 8,
        opacity: 0.52,
        fontSize: 10.5,
        fontFamily: tokens.font,
        color: tokens.textColor,
        userSelect: "none" as const,
        letterSpacing: 0.1,
      }}
    >
      <svg
        width="11"
        height="13"
        viewBox="0 0 24 28"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path
          d="M12 1L2 5v9c0 6.075 4.477 11.25 10 12 5.523-.75 10-5.925 10-12V5L12 1z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 14l2.5 2.5 5-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Secured by <strong style={{ fontWeight: 600 }}>Arcenpay</strong></span>
    </div>
  );
}

function FullScreenModal({
  onClose,
  tokens,
  contentRef,
  children,
}: {
  onClose: () => void;
  tokens: Tokens;
  contentRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const idRef = useRef(`am-${++_modalIdCounter}`);

  return createPortal(
    <>
      <style>{`
        .${idRef.current}-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: rgba(0,0,0,0.45);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .${idRef.current}-inner {
          background: ${tokens.bg};
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        @media (max-width: 640px) {
          .${idRef.current}-overlay {
            background: ${tokens.bg};
            align-items: stretch;
            justify-content: stretch;
          }
          .${idRef.current}-inner {
            width: 100vw !important;
            height: 100vh !important;
            border-radius: 0 !important;
          }
        }
        @media (min-width: 641px) {
          .${idRef.current}-inner {
            width: 92vw;
            max-width: 1100px;
            height: 92vh;
            max-height: 1100px;
            border-radius: ${tokens.radius * 1.5}px;
          }
        }
      `}</style>
      <div className={`${idRef.current}-overlay`} onClick={onClose}>
        <div
          ref={contentRef}
          className={`${idRef.current}-inner`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 24 }}
          >
            {children}
          </div>
          <div style={{ flexShrink: 0, borderTop: `1px solid rgba(0,0,0,0.06)` }}>
            <SecuredByArcenpay tokens={tokens} />
          </div>
        </div>
      </div>
    </>,
    typeof document !== "undefined"
      ? document.body
      : (undefined as unknown as HTMLElement),
  );
}

// ─── Success content ──────────────────────────────────────────────────────────

function SuccessContent({
  data,
  selectedPlanId,
  successMsg,
  txHash,
  chainId,
  tokens,
  onDone,
  containerWidth,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  successMsg: string | null;
  txHash: string | null;
  chainId: number | null;
  tokens: Tokens;
  onDone: () => void;
  containerWidth: number;
}) {
  const selectedPlan =
    data.plans.find((p: ComponentPlanSummary) => p.id === selectedPlanId) ??
    data.activePlan;

  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountdown((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (countdown !== 0) return;
    onDone();
  }, [countdown, onDone]);

  const price = selectedPlan ? parseFloat(String(selectedPlan.price)) : 0;
  const showAmountPaid =
    price > 0 &&
    !String(successMsg ?? "")
      .toLowerCase()
      .includes("plan changed") &&
    !String(successMsg ?? "")
      .toLowerCase()
      .includes("cancel");

  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {/* Success circle */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "#dcfce7",
          border: "2px solid #86efac",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
        }}
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#16a34a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div
        style={{
          fontWeight: 800,
          fontSize: tokens.size + 10,
          color: tokens.textColor,
          marginBottom: 6,
          letterSpacing: "-0.02em",
        }}
      >
        {successMsg ?? "You're all set!"}
      </div>
      <div
        style={{
          fontSize: tokens.size - 1,
          color: tokens.mutedColor,
          marginBottom: 28,
          lineHeight: 1.6,
        }}
      >
        Your subscription is now active and ready to use.
      </div>

      {/* Plan summary card */}
      {selectedPlan && (
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: tokens.radius,
            padding: "16px 20px",
            marginBottom: 20,
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 2,
                }}
              >
                Plan
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: tokens.size + 2,
                  color: tokens.textColor,
                }}
              >
                {selectedPlan.name}
              </div>
            </div>
            <div
              style={{
                background: "#dcfce7",
                color: "#166534",
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
              }}
            >
              Active
            </div>
          </div>
          {showAmountPaid && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: tokens.size - 1,
              }}
            >
              <span style={{ color: tokens.mutedColor }}>Amount paid</span>
              <span style={{ fontWeight: 600, color: tokens.textColor }}>
                ${price.toFixed(2)}
              </span>
            </div>
          )}
          {txHash && (
            <>
              <div
                style={{ height: 1, background: "#e5e7eb", margin: "12px 0" }}
              />
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 4,
                }}
              >
                Transaction
              </div>
              <a
                href={
                  chainId
                    ? getBlockExplorerUrl(chainId, txHash as `0x${string}`)
                    : "#"
                }
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: tokens.primary,
                  textDecoration: "none",
                  wordBreak: "break-all",
                }}
              >
                {txHash.slice(0, 20)}…{txHash.slice(-8)} ↗
              </a>
            </>
          )}
        </div>
      )}

      <PrimaryButton
        tokens={tokens}
        onClick={onDone}
        fullWidth
        style={{ fontSize: tokens.size, padding: "12px 0" }}
      >
        Return to portal
      </PrimaryButton>
      <div style={{ fontSize: 11, color: tokens.mutedColor, marginTop: 12 }}>
        Redirecting in {countdown}s…
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ArcenEmbed({
  accessToken,
  componentId,
  id,
  className,
  style,
  mockData,
  initialView,
  onViewChange,
  onPlanChange,
  mode = "modal",
}: ArcenEmbedProps = {}) {
  // The portal should always surface plan changes by default.
  // Workspace-specific restrictions are enforced by backend APIs when a
  // customer actually attempts the change, so the CTA should not disappear
  // because of a frontend env toggle.
  const allowPortalPlanChanges = true;
  const allowPortalCancellation = true;

  // Try to read token and componentId from Provider context
  let providerToken: string | null = null;
  let providerCid: string | null = null;
  let providerBaseUrl: string | null = null;
  let providerSmartAccount: {
    provider?: "pimlico";
    bundlerUrl: string;
    paymasterUrl: string;
    isReady: boolean;
    selfFunded?: boolean;
  } | null = null;
  try {
    const arcen = useArcenPay();
    providerToken = arcen.session.token;
    providerCid = arcen.componentId;
    providerBaseUrl = arcen.baseUrl;
    providerSmartAccount = arcen.smartAccount;
  } catch {
    // Provider not available — fall through
  }

  const resolvedId =
    componentId ??
    providerCid ??
    id ??
    (typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "")
      : "");

  // baseUrl is always resolved internally — never exposed to the user
  const resolvedBaseUrl = resolveDashboardBaseUrl(providerBaseUrl ?? undefined);

  // Resolve accessToken: prop > env var > provider context
  const resolvedToken =
    accessToken ??
    providerToken ??
    (typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_ARCENPAY_ACCESS_TOKEN ?? "")
      : "");

  // All hooks must run unconditionally before any early returns
  const [state, dispatch] = useReducer(
    reducer,
    initialView ?? "portal",
    (v) => ({ ...initialState, view: v as PortalView }),
  );
  const [couponQuote, setCouponQuote] = useState<AppliedCouponQuote | null>(
    null,
  );
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const tokenRef = useRef(resolvedToken);
  const baseRef = useRef(resolvedBaseUrl);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useContainerWidth(containerRef);

  const modalContentRef = useRef<HTMLDivElement | null>(null);
  const [modalContentWidth, setModalContentWidth] = useState(0);

  useEffect(() => {
    const el = modalContentRef.current;
    if (!el || state.view === "portal") return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setModalContentWidth(w);
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setModalContentWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.view]);

  const effectiveContainerWidth =
    mode === "modal" ? modalContentWidth || 360 : containerWidth;

  const isInline = mode === "inline";
  const effectiveSelectedPlanId = state.data
    ? resolvePlanSelectionForBillingPeriod({
        plans: state.data.plans,
        selectedPlanId: state.selectedPlanId,
        billingPeriod: state.billingPeriod,
      })
    : state.selectedPlanId;

  // Notify parent whenever view changes
  useEffect(() => {
    onViewChange?.(state.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);
  useEffect(() => {
    tokenRef.current = accessToken ?? resolvedToken;
    baseRef.current = resolvedBaseUrl;
  }, [accessToken, resolvedToken, resolvedBaseUrl]);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      dispatch({ type: "FETCH_START" });
      try {
        const res = await fetch(
          `${baseRef.current}/api/v1/components/${resolvedId}/render`,
          {
            signal,
            headers: { Authorization: `Bearer ${tokenRef.current}` },
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            ((err as Record<string, unknown>).error as string) ??
              `HTTP ${res.status}`,
          );
        }
        const json = await res.json();
        dispatch({ type: "FETCH_OK", data: json.data as ComponentRenderData });
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        dispatch({
          type: "FETCH_ERR",
          error: e instanceof Error ? e.message : "Failed to load component",
        });
      }
    },
    [resolvedId],
  );

  useEffect(() => {
    if (mockData) {
      dispatch({ type: "FETCH_OK", data: mockData });
      if (initialView && initialView !== "portal") {
        dispatch({
          type:
            initialView === "checkout"
              ? "OPEN_CHECKOUT"
              : initialView === "payment"
                ? "OPEN_PAYMENT"
                : initialView === "unsubscribe"
                  ? "OPEN_UNSUBSCRIBE"
                  : "GOTO_PORTAL",
        });
      }
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    fetchData(controller.signal);
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchData, mockData, initialView]);

  useEffect(() => {
    setCouponQuote((current) => {
      if (!current) return null;
      if (!effectiveSelectedPlanId) return null;
      if (current.planId !== effectiveSelectedPlanId) return null;
      if (current.billingPeriod !== state.billingPeriod) return null;
      return current;
    });
  }, [effectiveSelectedPlanId, state.billingPeriod]);

  useEffect(() => {
    const company =
      (state.data?.company as Record<string, unknown> | null) ?? null;
    const nextName =
      typeof company?.name === "string"
        ? normalizeCustomerName(company.name)
        : "";
    const nextEmail =
      typeof company?.email === "string"
        ? normalizeCustomerEmail(company.email)
        : "";

    if (nextName) {
      setCustomerName((current) => current || nextName);
    }
    if (!nextEmail) return;
    setCustomerEmail((current) => current || nextEmail);
  }, [state.data]);

  const callApi = useCallback(
    async (
      path: string,
      body?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      const res = await fetch(`${baseRef.current}${path}`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        // Detect token expiry specifically — bubble up a sentinel so callers can show a refresh UI
        if (res.status === 401) throw new Error("__TOKEN_EXPIRED__");
        const err = await res.json().catch(() => ({}));
        throw new Error(
          ((err as Record<string, unknown>).error as string) ??
            `HTTP ${res.status}`,
        );
      }
      return res.json();
    },
    [],
  );

  const handleSwitchPlan = useCallback(
    async (planId: string, confirmation?: PlanChangeConfirmation) => {
      dispatch({ type: "PROCESSING_START" });
      try {
        const normalizedCustomerName = normalizeCustomerName(customerName);
        const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
        const successTxHash =
          confirmation?.accessChangeTxHash ??
          confirmation?.paymentTxHash ??
          confirmation?.autopayConfigTxHash ??
          confirmation?.txHash;
        const planApiController = new AbortController();
        const response = await callApi(
          "/api/v1/companies/plan",
          {
            planId,
            billingPeriod: state.billingPeriod,
            ...(normalizedCustomerName
              ? { customerName: normalizedCustomerName }
              : {}),
            ...(isValidCustomerEmail(normalizedCustomerEmail)
              ? { customerEmail: normalizedCustomerEmail }
              : {}),
            ...(couponQuote?.planId === planId &&
            couponQuote.billingPeriod === state.billingPeriod
              ? { couponCode: couponQuote.code }
              : {}),
            ...(confirmation?.txHash ? { txHash: confirmation.txHash } : {}),
            ...(confirmation?.autopayConfigTxHash
              ? { autopayConfigTxHash: confirmation.autopayConfigTxHash }
              : {}),
            ...(confirmation?.accessChangeTxHash
              ? { accessChangeTxHash: confirmation.accessChangeTxHash }
              : {}),
            ...(confirmation?.paymentTxHash
              ? { paymentTxHash: confirmation.paymentTxHash }
              : {}),
            ...(confirmation?.prorationEffectiveAt
              ? { prorationEffectiveAt: confirmation.prorationEffectiveAt }
              : {}),
          },
          planApiController.signal,
        );
        const accessChangeRequired = Boolean(
          (
            response as {
              data?: {
                accessChangeRequired?: boolean;
                accessChangeNote?: string;
              };
            }
          )?.data?.accessChangeRequired,
        );
        if (accessChangeRequired) {
          const accessChangeNote =
            (
              response as {
                data?: {
                  accessChangeNote?: string;
                };
              }
            )?.data?.accessChangeNote ??
            "ArcenPay could not finish this subscription switch yet. Refresh the portal and try the plan change again.";
          throw new Error(accessChangeNote);
        }
        await fetchData();
        setCouponQuote(null);
        onPlanChange?.(planId);
        const selectedPlan =
          state.data?.plans.find(
            (plan: ComponentPlanSummary) => plan.id === planId,
          ) ?? null;
        const mode = String(
          (response as { data?: { mode?: string } })?.data?.mode ?? "",
        );
        const walletCreditCreated = Number(
          (response as { data?: { walletCreditCreated?: string } })?.data
            ?.walletCreditCreated ?? 0,
        );
        const pendingVerification = Boolean(
          (response as { data?: { pendingVerification?: boolean } })?.data
            ?.pendingVerification,
        );
        const alreadyScheduled = Boolean(
          (response as { data?: { alreadyScheduled?: boolean } })?.data
            ?.alreadyScheduled,
        );
        const prorationAmountDue =
          (response as { data?: { proration?: { amountDue?: string } } })?.data
            ?.proration?.amountDue ?? null;
        const effectiveAt =
          (response as { data?: { effectiveAt?: string } })?.data
            ?.effectiveAt ?? null;
        const effectiveAtLabel =
          typeof effectiveAt === "string" ? formatDateLabel(effectiveAt) : null;
        const previousBillingPeriod = resolveActiveBillingPeriod({
          billingPeriod: state.data?.billingPeriod,
          activePlan: state.data?.activePlan ?? null,
        });
        const previousTransition = state.data
          ? getSubscriptionTransition(state.data)
          : null;
        dispatch({
          type: "GOTO_SUCCESS",
          successMsg: buildPlanChangeSuccessMessage({
            mode,
            selectedPlanName: selectedPlan?.name ?? null,
            targetBillingPeriod: state.billingPeriod,
            previousBillingPeriod,
            effectiveAtLabel,
            prorationAmountDue,
            walletCreditCreated,
            pendingVerification,
            alreadyScheduled,
            replacedScheduledDowngrade:
              previousTransition?.changeType === "downgrade" &&
              isOpenTransitionStage(previousTransition),
          }),
          txHash: successTxHash,
        });
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Failed to switch plan";
        dispatch({
          type: msg === "__TOKEN_EXPIRED__" ? "FETCH_ERR" : "PROCESSING_ERR",
          error: msg === "__TOKEN_EXPIRED__" ? "__TOKEN_EXPIRED__" : msg,
        });
      }
    },
    [
      callApi,
      couponQuote,
      customerEmail,
      fetchData,
      onPlanChange,
      state.data,
      state.billingPeriod,
    ],
  );

  const handleActivateSubscription = useCallback(
    async (result: {
      txHash?: string;
      pending?: boolean;
      successMsg?: string;
    }) => {
      const effectivePlanId = state.data
        ? resolvePlanSelectionForBillingPeriod({
            plans: state.data.plans,
            selectedPlanId: state.selectedPlanId,
            billingPeriod: state.billingPeriod,
          })
        : state.selectedPlanId;
      const selectedPlan = state.data?.plans.find(
        (plan: ComponentPlanSummary) => plan.id === effectivePlanId,
      );

      await fetchData();
      if (result.pending) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await sleep(1_500);
          await fetchData();
        }
      }
      setCouponQuote(null);

      if (selectedPlan?.id) {
        onPlanChange?.(selectedPlan.id);
      }

      dispatch({
        type: "GOTO_SUCCESS",
        successMsg:
          result.successMsg ??
          (result.pending
            ? "Subscription activation submitted. We’re finalizing your billing state now."
            : "Subscription activated!"),
        txHash: result.txHash,
      });
    },
    [fetchData, onPlanChange, state.billingPeriod, state.data, state.selectedPlanId],
  );

  const handleUnsubscribe = useCallback(
    async (confirmation: CancellationConfirmation) => {
      dispatch({ type: "PROCESSING_START" });
      try {
        const unsubController = new AbortController();
        const response = await callApi(
          "/api/v1/companies/unsubscribe",
          buildCancellationRequestBody(confirmation),
          unsubController.signal,
        );
        await fetchData();
        const mode = String(
          (response as { data?: { mode?: string } })?.data?.mode ?? "",
        );
        const effectiveAt =
          (response as { data?: { effectiveAt?: string } })?.data
            ?.effectiveAt ?? null;
        const pendingVerification = Boolean(
          (response as { data?: { pendingVerification?: boolean } })?.data
            ?.pendingVerification,
        );
        const effectiveAtLabel =
          typeof effectiveAt === "string" ? formatDateLabel(effectiveAt) : null;
        const feedback = buildCancellationFeedback({
          intent: confirmation.intent,
          mode,
          effectiveAtLabel,
          pendingVerification,
        });

        if (feedback.successMsg) {
          dispatch({
            type: "GOTO_SUCCESS",
            successMsg: feedback.successMsg,
            txHash: confirmation.txHash,
          });
        } else {
          dispatch({
            type: "GOTO_PORTAL",
            flashMsg: feedback.flashMsg,
          });
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg =
          e instanceof Error ? e.message : "Failed to cancel subscription";
        dispatch({
          type: msg === "__TOKEN_EXPIRED__" ? "FETCH_ERR" : "PROCESSING_ERR",
          error: msg === "__TOKEN_EXPIRED__" ? "__TOKEN_EXPIRED__" : msg,
        });
      }
    },
    [callApi, fetchData],
  );

  const {
    data,
    loading,
    error,
    actionError,
    view,
    selectedPlanId,
    billingPeriod,
    processing,
    flashMsg,
    successMsg,
    successTxHash,
  } = state;

  useEffect(() => {
    if (view === "unsubscribe" && !allowPortalCancellation) {
      dispatch({
        type: "GOTO_PORTAL",
        flashMsg:
          "Self-serve cancellation is disabled for this launch. Contact support to cancel or downgrade.",
      });
    }
  }, [allowPortalCancellation, view]);

  const handleOpenCheckout = useCallback(() => {
    if (!allowPortalPlanChanges) return;
    dispatch({ type: "OPEN_CHECKOUT" });
  }, [allowPortalPlanChanges]);

  const handleOpenUnsubscribe = useCallback(() => {
    if (!allowPortalCancellation) return;
    dispatch({ type: "OPEN_UNSUBSCRIBE" });
  }, [allowPortalCancellation]);

  const handleResumeSubscription = useCallback(async () => {
    if (!allowPortalPlanChanges || !state.data?.activePlan?.id) {
      return;
    }

    dispatch({ type: "PROCESSING_START" });
    try {
      const response = await callApi("/api/v1/companies/resume", {});
      await fetchData();
      const effectiveAt =
        (response as { data?: { effectiveAt?: string | null } })?.data
          ?.effectiveAt ?? null;
      const effectiveAtLabel =
        typeof effectiveAt === "string" ? formatDateLabel(effectiveAt) : null;

      dispatch({
        type: "GOTO_SUCCESS",
        successMsg: effectiveAtLabel
          ? `Subscription resumed. Future renewals remain active through ${effectiveAtLabel} and beyond.`
          : "Subscription resumed. Future renewals are active again.",
      });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Failed to resume subscription";
      dispatch({
        type: msg === "__TOKEN_EXPIRED__" ? "FETCH_ERR" : "PROCESSING_ERR",
        error: msg === "__TOKEN_EXPIRED__" ? "__TOKEN_EXPIRED__" : msg,
      });
    }
  }, [allowPortalPlanChanges, callApi, fetchData, state.data]);

  // Guard: loading — show skeleton first
  if (loading) {
    const skeletonCard = (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #eef2f7",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.05)",
        }}
      >
        <div
          style={{
            width: 180,
            height: 14,
            background: "#f3f4f6",
            borderRadius: 999,
            marginBottom: 18,
            animation: "pulse 1.5s infinite",
          }}
        />
        <div
          style={{
            width: "100%",
            height: 120,
            background: "#f3f4f6",
            borderRadius: 16,
            animation: "pulse 1.5s infinite",
          }}
        />
      </div>
    );

    return (
      <div
        className={className}
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          minHeight: 1180,
          background: "#ffffff",
          ...style,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1480,
            margin: "0 auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 240,
                height: 18,
                background: "#f3f4f6",
                borderRadius: 999,
                animation: "pulse 1.5s infinite",
              }}
            />
            <div
              style={{
                width: 90,
                height: 18,
                background: "#f3f4f6",
                borderRadius: 999,
                animation: "pulse 1.5s infinite",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
              marginBottom: 24,
            }}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  background: "#ffffff",
                  border: "1px solid #eef2f7",
                  borderRadius: 24,
                  padding: 24,
                  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.05)",
                }}
              >
                <div
                  style={{
                    width: 140,
                    height: 16,
                    background: "#f3f4f6",
                    borderRadius: 999,
                    marginBottom: 12,
                    animation: "pulse 1.5s infinite",
                  }}
                />
                <div
                  style={{
                    width: 90,
                    height: 12,
                    background: "#f3f4f6",
                    borderRadius: 999,
                    marginBottom: 28,
                    animation: "pulse 1.5s infinite",
                  }}
                />
                <div
                  style={{
                    width: "100%",
                    height: 46,
                    background: "#f3f4f6",
                    borderRadius: 14,
                    animation: "pulse 1.5s infinite",
                  }}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gap: 20,
            }}
          >
            {[1, 2, 3, 4].map((i) => (
              <div key={i}>{skeletonCard}</div>
            ))}
          </div>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} } @keyframes arcenSpin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Guards: missing token or component ID — show setup guidance
  if (!resolvedToken && !mockData) {
    return (
      <div
        className={className}
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 32,
          textAlign: "center",
          ...style,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
        <div style={{ fontWeight: 700, color: "#111827", marginBottom: 4 }}>
          Access token required
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Pass an{" "}
          <code
            style={{
              background: "#f3f4f6",
              padding: "2px 5px",
              borderRadius: 4,
            }}
          >
            accessToken
          </code>{" "}
          prop to{" "}
          <code
            style={{
              background: "#f3f4f6",
              padding: "2px 5px",
              borderRadius: 4,
            }}
          >
            ArcenEmbed
          </code>
          .
        </div>
      </div>
    );
  }

  if (!resolvedId && !mockData) {
    return (
      <div
        className={className}
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 32,
          textAlign: "center",
          ...style,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>🧩</div>
        <div style={{ fontWeight: 700, color: "#111827", marginBottom: 4 }}>
          Component ID required
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Pass a{" "}
          <code
            style={{
              background: "#f3f4f6",
              padding: "2px 5px",
              borderRadius: 4,
            }}
          >
            componentId
          </code>{" "}
          prop to{" "}
          <code
            style={{
              background: "#f3f4f6",
              padding: "2px 5px",
              borderRadius: 4,
            }}
          >
            ArcenEmbed
          </code>
          .
        </div>
      </div>
    );
  }

  if (error) {
    const isExpired =
      error.includes("__TOKEN_EXPIRED__") ||
      error.toLowerCase().includes("expired") ||
      error.toLowerCase().includes("invalid") ||
      error === "401";
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 40,
          textAlign: "center",
          color: "#6b7280",
          ...style,
        }}
      >
        {isExpired ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: "#111827",
                marginBottom: 6,
              }}
            >
              Session expired
            </div>
            <div style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              Your billing session has timed out. Please refresh the page to
              continue.
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 24px",
                background: "#111827",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Refresh page
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: "#111827",
                marginBottom: 6,
              }}
            >
              Unable to load portal
            </div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>{error}</div>
            <button
              onClick={() => fetchData()}
              style={{
                padding: "10px 24px",
                background: "#111827",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  if (!data) return null;

  const tokens = getDesignTokens(data.component.design);

  const containerStyle: React.CSSProperties = {
    fontFamily: tokens.font,
    fontSize: tokens.size,
    color: tokens.textColor,
    background: tokens.bg,
    lineHeight: 1.5,
    padding: 16,
    boxSizing: "border-box" as const,
    minWidth: 0,
    overflowWrap: "break-word",
    wordBreak: "break-word",
    ...style,
  };

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {isInline ? (
        <>
          {view === "portal" && (
            <PortalContent
              data={data}
              tokens={tokens}
              flashMsg={flashMsg}
              onChangePlan={handleOpenCheckout}
              onUnsubscribe={handleOpenUnsubscribe}
              onResumeSubscription={handleResumeSubscription}
              allowPlanChanges={allowPortalPlanChanges}
              allowCancellation={allowPortalCancellation}
              containerWidth={effectiveContainerWidth}
            />
          )}
          {view === "checkout" && (
            <CheckoutContent
              data={data}
              selectedPlanId={selectedPlanId}
              billingPeriod={billingPeriod}
              apiBaseUrl={baseRef.current}
              accessToken={tokenRef.current}
              couponQuote={couponQuote}
              processing={processing}
              tokens={tokens}
              customerName={customerName}
              customerEmail={customerEmail}
              containerWidth={effectiveContainerWidth}
              onSelectPlan={(planId) =>
                dispatch({ type: "SELECT_PLAN", planId })
              }
              onBillingPeriodChange={(p) =>
                dispatch({ type: "SET_BILLING_PERIOD", period: p })
              }
              onCustomerNameChange={setCustomerName}
              onCustomerEmailChange={setCustomerEmail}
              onCouponQuoteChange={setCouponQuote}
              onSubscribeClose={() => {
                const targetId =
                  effectiveSelectedPlanId ?? data.activePlan?.id ?? "";
                const hasBillingSelectionChange = !isCurrentBillingSelection({
                  activePlanId: data.activePlan?.id ?? null,
                  selectedPlanId: effectiveSelectedPlanId,
                  activeBillingPeriod: resolveActiveBillingPeriod({
                    billingPeriod: data.billingPeriod,
                    activePlan: data.activePlan,
                  }),
                  selectedBillingPeriod: billingPeriod,
                });
                if (targetId && hasBillingSelectionChange) {
                  const targetPlan = data.plans.find((p) => p.id === targetId);
                  const targetPrice = parseFloat(String(targetPlan?.price ?? "0"));
                  const currentPrice = parseFloat(String(data.activePlan?.price ?? "0"));
                  // Free plan → must use cancellation flow, not plan-change
                  if (targetPrice <= 0 && currentPrice > 0 && allowPortalCancellation) {
                    dispatch({ type: "OPEN_UNSUBSCRIBE" });
                  } else {
                    handleSwitchPlan(targetId);
                  }
                } else {
                  dispatch({ type: "GOTO_PORTAL" });
                }
              }}
              onNextPayment={() => dispatch({ type: "OPEN_PAYMENT" })}
              onBack={() => dispatch({ type: "GOTO_PORTAL" })}
            />
          )}
          {view === "payment" && (
            <PaymentContent
              data={data}
              selectedPlanId={selectedPlanId}
              billingPeriod={billingPeriod}
              apiBaseUrl={baseRef.current}
              accessToken={tokenRef.current}
              couponQuote={couponQuote}
              processing={processing}
              actionError={actionError}
              tokens={tokens}
              customerName={customerName}
              customerEmail={customerEmail}
              containerWidth={effectiveContainerWidth}
              smartAccountConfig={providerSmartAccount}
              onCustomerNameChange={setCustomerName}
              onCustomerEmailChange={setCustomerEmail}
              onConfirm={(txHash) => {
                if (effectiveSelectedPlanId) {
                  handleSwitchPlan(effectiveSelectedPlanId, txHash);
                }
              }}
              onActivationComplete={handleActivateSubscription}
              onBack={() => dispatch({ type: "OPEN_CHECKOUT" })}
            />
          )}
          {view === "unsubscribe" && (
            <UnsubscribeContent
              data={data}
              processing={processing}
              actionError={actionError}
              tokens={tokens}
              containerWidth={effectiveContainerWidth}
              smartAccountConfig={providerSmartAccount}
              onConfirm={(confirmation) => handleUnsubscribe(confirmation)}
              onBack={() => dispatch({ type: "GOTO_PORTAL" })}
            />
          )}
          {view === "success" && (
            <SuccessContent
              data={data}
              selectedPlanId={effectiveSelectedPlanId}
              successMsg={successMsg}
              txHash={successTxHash}
              chainId={data.paymentMethod?.chainId ?? null}
              tokens={tokens}
              onDone={() => dispatch({ type: "GOTO_PORTAL" })}
              containerWidth={effectiveContainerWidth}
            />
          )}
          <SecuredByArcenpay tokens={tokens} />
        </>
      ) : (
        <>
          <PortalContent
            data={data}
            tokens={tokens}
            flashMsg={flashMsg}
            onChangePlan={handleOpenCheckout}
            onUnsubscribe={handleOpenUnsubscribe}
            onResumeSubscription={handleResumeSubscription}
            allowPlanChanges={allowPortalPlanChanges}
            allowCancellation={allowPortalCancellation}
            containerWidth={containerWidth}
          />
          {view !== "portal" && (
            <FullScreenModal
              onClose={() => dispatch({ type: "GOTO_PORTAL" })}
              tokens={tokens}
              contentRef={modalContentRef}
            >
              {view === "checkout" && (
                <CheckoutContent
                  data={data}
                  selectedPlanId={selectedPlanId}
                  billingPeriod={billingPeriod}
                  apiBaseUrl={baseRef.current}
                  accessToken={tokenRef.current}
                  couponQuote={couponQuote}
                  processing={processing}
                  tokens={tokens}
                  customerName={customerName}
                  customerEmail={customerEmail}
                  containerWidth={effectiveContainerWidth}
                  onSelectPlan={(planId) =>
                    dispatch({ type: "SELECT_PLAN", planId })
                  }
                  onBillingPeriodChange={(p) =>
                    dispatch({ type: "SET_BILLING_PERIOD", period: p })
                  }
                  onCustomerNameChange={setCustomerName}
                  onCustomerEmailChange={setCustomerEmail}
                  onCouponQuoteChange={setCouponQuote}
                  onSubscribeClose={() => {
                    const targetId =
                      effectiveSelectedPlanId ?? data.activePlan?.id ?? "";
                    const hasBillingSelectionChange = !isCurrentBillingSelection({
                      activePlanId: data.activePlan?.id ?? null,
                      selectedPlanId: effectiveSelectedPlanId,
                      activeBillingPeriod: resolveActiveBillingPeriod({
                        billingPeriod: data.billingPeriod,
                        activePlan: data.activePlan,
                      }),
                      selectedBillingPeriod: billingPeriod,
                    });
                    if (targetId && hasBillingSelectionChange) {
                      handleSwitchPlan(targetId);
                    } else {
                      dispatch({ type: "GOTO_PORTAL" });
                    }
                  }}
                  onNextPayment={() => dispatch({ type: "OPEN_PAYMENT" })}
                  onBack={() => dispatch({ type: "GOTO_PORTAL" })}
                />
              )}
              {view === "payment" && (
                <PaymentContent
                  data={data}
                  selectedPlanId={selectedPlanId}
                  billingPeriod={billingPeriod}
                  apiBaseUrl={baseRef.current}
                  accessToken={tokenRef.current}
                  couponQuote={couponQuote}
                  processing={processing}
                  actionError={actionError}
                  tokens={tokens}
                  customerName={customerName}
                  customerEmail={customerEmail}
                  containerWidth={effectiveContainerWidth}
                  smartAccountConfig={providerSmartAccount}
                  onCustomerNameChange={setCustomerName}
                  onCustomerEmailChange={setCustomerEmail}
                  onConfirm={(txHash) => {
                    if (effectiveSelectedPlanId) {
                      handleSwitchPlan(effectiveSelectedPlanId, txHash);
                    }
                  }}
                  onActivationComplete={handleActivateSubscription}
                  onBack={() => dispatch({ type: "OPEN_CHECKOUT" })}
                />
              )}
              {view === "unsubscribe" && (
                <UnsubscribeContent
                  data={data}
                  processing={processing}
                  actionError={actionError}
                  tokens={tokens}
                  containerWidth={effectiveContainerWidth}
                  smartAccountConfig={providerSmartAccount}
                  onConfirm={(confirmation) => handleUnsubscribe(confirmation)}
                  onBack={() => dispatch({ type: "GOTO_PORTAL" })}
                />
              )}
              {view === "success" && (
                <SuccessContent
                  data={data}
                  selectedPlanId={effectiveSelectedPlanId}
                  successMsg={successMsg}
                  txHash={successTxHash}
                  chainId={data.paymentMethod?.chainId ?? null}
                  tokens={tokens}
                  onDone={() => dispatch({ type: "GOTO_PORTAL" })}
                  containerWidth={effectiveContainerWidth}
                />
              )}
            </FullScreenModal>
          )}
          <SecuredByArcenpay tokens={tokens} />
        </>
      )}
    </div>
  );
}

/**
 * ArcenpayEmbed — alias for `ArcenEmbed`.
 *
 * @example
 * import { ArcenpayEmbed } from '@arcenpay/react';
 *
 * <ArcenpayEmbed
 *   accessToken={tokenFromBackend}
 *   id="cmn_xxx"
 * />
 */
export const ArcenpayEmbed = ArcenEmbed;
export type ArcenpayEmbedProps = ArcenEmbedProps;
