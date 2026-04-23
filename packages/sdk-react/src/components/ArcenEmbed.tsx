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
 *   baseUrl="https://dashboard.arcenpay.xyz"
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
import type {
  ComponentRenderData,
  ComponentElement,
  ComponentUsageItem,
  ComponentEntitlement,
  ComponentPlanSummary,
  ComponentDesign,
  ComponentInvoiceSummary,
  ComponentPaymentMethod,
} from "@arcenpay/sdk";
import {
  ERC7579AutopayModuleABI,
  getBlockExplorerUrl,
  getChain,
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
} from "@arcenpay/sdk";
import {
  cancelSubscription,
  deploySmartAccount,
  sendSmartAccountTransaction,
  updateAutopayConfig,
} from "../lib/zerodev";
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArcenEmbedProps {
  accessToken: string;
  componentId?: string;
  id?: string;
  baseUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  mockData?: ComponentRenderData;
  /** Start the embed on a specific view instead of portal */
  initialView?: PortalView;
  /** Called whenever the embed navigates to a new view */
  onViewChange?: (view: PortalView) => void;
  /** Called whenever the user successfully switches to a new plan */
  onPlanChange?: (planId: string) => void;
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

interface PortalState {
  data: ComponentRenderData | null;
  loading: boolean;
  error: string | null;
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

function isEnvEnabled(value: string | undefined, defaultValue = true): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

const PORTAL_SELF_SERVE_PLAN_CHANGES_ENABLED =
  isEnvEnabled(process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_PLAN_CHANGES);
const PORTAL_SELF_SERVE_CANCELLATION_ENABLED =
  isEnvEnabled(process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_CANCELLATION);

const initialState: PortalState = {
  data: null,
  loading: true,
  error: null,
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
      return { ...state, loading: true, error: null };
    case "FETCH_OK":
      return {
        ...state,
        loading: false,
        data: action.data,
        view: "portal",
        processing: false,
        flashMsg: null,
      };
    case "FETCH_ERR":
      return { ...state, loading: false, error: action.error };
    case "OPEN_CHECKOUT":
      return {
        ...state,
        view: "checkout",
        selectedPlanId: state.data?.activePlan?.id ?? null,
      };
    case "OPEN_UNSUBSCRIBE":
      return { ...state, view: "unsubscribe" };
    case "OPEN_PAYMENT":
      return { ...state, view: "payment" };
    case "GOTO_PORTAL":
      return {
        ...state,
        view: "portal",
        selectedPlanId: null,
        flashMsg: action.flashMsg ?? null,
      };
    case "GOTO_SUCCESS":
      return {
        ...state,
        view: "success",
        processing: false,
        successMsg: action.successMsg,
        successTxHash: action.txHash ?? null,
      };
    case "SELECT_PLAN":
      return { ...state, selectedPlanId: action.planId };
    case "SET_BILLING_PERIOD":
      return { ...state, billingPeriod: action.period };
    case "PROCESSING_START":
      return { ...state, processing: true };
    case "PROCESSING_DONE":
      return {
        ...state,
        processing: false,
        view: "portal",
        flashMsg: action.flashMsg ?? null,
      };
    case "PROCESSING_ERR":
      return { ...state, processing: false, error: action.error };
    default:
      return state;
  }
}

// ─── Design helpers ───────────────────────────────────────────────────────────

export function getDesignTokens(design: ComponentDesign) {
  const primary = design.primaryColor ?? "#000000";
  const font = design.fontFamily ?? "system-ui, -apple-system, sans-serif";
  const size =
    typeof design.fontSize === "number"
      ? design.fontSize
      : parseFloat(String(design.fontSize ?? "14")) || 14;
  const textColor = design.fontColor ?? "#111827";
  const bg = design.backgroundColor ?? "#ffffff";
  const radius =
    typeof design.borderRadius === "number"
      ? design.borderRadius
      : parseFloat(String(design.borderRadius ?? "8")) || 8;
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

function billingPeriodUnit(
  billingPeriod: "monthly" | "annual",
): "mo" | "yr" {
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

function formatMoney(amount: string | number, currency = "USD"): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return String(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatChainLabel(chainId?: number | null): string | null {
  if (!chainId) return null;
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 8453) return "Base";
  return `Chain ${chainId}`;
}

function getUsageItems(data: ComponentRenderData): ComponentUsageItem[] {
  if (data.usage.length > 0) return data.usage;

  return data.entitlements
    .filter((entitlement) => entitlement.featureType === "event_based")
    .map((entitlement) => ({
      featureKey: entitlement.featureKey,
      name: entitlement.name,
      used: entitlement.usage ?? 0,
      limit: entitlement.limit,
      unitSingular: entitlement.unitSingular ?? null,
      unitPlural: entitlement.unitPlural ?? null,
    }));
}

type ResolvedBooleanFeature = {
  featureKey: string;
  name: string;
  value: true;
  featureType: "boolean";
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
  const metadataSource =
    ((matchedPlan as { metadata?: unknown } | null | undefined)?.metadata ??
      (data.activePlan as { metadata?: unknown } | null | undefined)?.metadata ??
      null) as Record<string, unknown> | null;

  if (metadataSource && typeof metadataSource === "object") {
    const rawEntitlements = Array.isArray(metadataSource.entitlements)
      ? metadataSource.entitlements
      : [];

    return rawEntitlements
      .filter(
        (entry): entry is {
          featureKey: string;
          featureName?: string;
          type?: string;
          enabled?: boolean;
        } =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof (entry as { featureKey?: unknown }).featureKey === "string",
          ),
      )
      .filter(
        (entry) =>
          entry.enabled === true &&
          (!entry.type || entry.type === "BOOLEAN"),
      )
      .map((entry) => ({
        featureKey: entry.featureKey,
        name: entry.featureName ?? entry.featureKey,
        value: true as const,
        featureType: "boolean" as const,
      }));
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
          <FeatureIcon size={36}>{CHART_ICON}</FeatureIcon>
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

function getPlanDisplayPrice(
  plan: ComponentPlanSummary | null | undefined,
  billingPeriod: "monthly" | "annual",
): number {
  if (!plan) return 0;
  const monthly = parseFloat(String(plan.price));
  const annual = plan.annualPrice ? parseFloat(String(plan.annualPrice)) : 0;
  return billingPeriod === "annual" && annual > 0 ? annual : monthly;
}

function getWindowEthereum():
  | { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
  | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }).ethereum;
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

async function requestWindowEthereumAccounts(): Promise<string[]> {
  const eth = getWindowEthereum();
  if (!eth) {
    throw new Error(
      "No browser wallet found. Install a wallet like MetaMask to continue.",
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
    return existingAccounts as string[];
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

    return requestedAccounts as string[];
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function createBrowserWalletClient(params: {
  chainId: number;
  account: string | null | undefined;
}): WalletClient | null {
  const ethereum = getWindowEthereum();
  if (!ethereum || !params.account || !isAddress(params.account)) return null;

  return createWalletClient({
    account: params.account as `0x${string}`,
    chain: getChain(params.chainId),
    transport: custom(ethereum),
  }) as WalletClient;
}

async function getCurrentWalletChainId(walletClient: WalletClient): Promise<number | null> {
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
      throw new Error(`Switch to ${targetChain.name} in your wallet to continue.`);
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

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

async function readWalletSubscriptionTokenId(
  chainId: number,
  paymentAccount: string,
): Promise<bigint> {
  const chain = getChain(chainId);
  const contracts = getContractAddresses(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  return (await publicClient.readContract({
    address: contracts.subscriptionRegistry as `0x${string}`,
    abi: SubscriptionRegistryABI,
    functionName: "getWalletSubscription",
    args: [paymentAccount as `0x${string}`],
  })) as bigint;
}

// ─── Responsive container width hook ─────────────────────────────────────────

function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
): number {
  const [width, setWidth] = useState(800);
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
  allowPlanChanges = true,
  allowCancellation = true,
): React.ReactNode {
  const prop = (key: string) =>
    el[key] ?? (el.config as Record<string, unknown> | undefined)?.[key];

  switch (el.type) {
    case "planManager": {
      const plan = data.activePlan;
      const priceNum = plan ? parseFloat(String(plan.price)) : 0;
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
                    background: `${tokens.primary}18`,
                    color: tokens.primary,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                  }}
                >
                  ✓ Active
                </div>
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
                    {intervalLabel(plan!.billingInterval)}
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
                      <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
                          <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
                      <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
      return (
        <div key={index} style={{ marginBottom: 24 }}>
          <SectionHeading tokens={tokens}>Available Plans</SectionHeading>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {data.plans.map((p: ComponentPlanSummary) => {
              const isActive = p.id === data.activePlan?.id;
              return (
                <div
                  key={p.id}
                  style={{
                    flex: "1 1 160px",
                    minWidth: 150,
                    maxWidth: 220,
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
                    {parseFloat(String(p.price)) === 0
                      ? "Free"
                      : `$${parseFloat(String(p.price)).toFixed(2)}`}
                    {parseFloat(String(p.price)) > 0 ? (
                      <span
                        style={{
                          fontSize: tokens.size - 2,
                          fontWeight: 400,
                          color: tokens.mutedColor,
                        }}
                      >
                        {intervalLabel(p.billingInterval)}
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
      const plan = data.activePlan;
      const priceVal = plan ? parseFloat(String(plan.price)) : 0;
      const nextBillingLabel = formatDateLabel(data.nextBillingAt);
      const nextBillingRelative = formatRelativeDate(data.nextBillingAt);
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
                </div>
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: tokens.mutedColor,
                    paddingBottom: 2,
                  }}
                >
                  {nextBillingRelative ?? nextBillingLabel}
                </div>
              </div>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 10,
                }}
              >
                Scheduled billing date · {nextBillingLabel}
              </div>
            </div>
          )}
        </Card>
      );
    }

    case "paymentMethod": {
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
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
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
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
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
      if (!isPaidPlan || !allowCancellation) return null;
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
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
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
  allowPlanChanges,
  allowCancellation,
}: {
  data: ComponentRenderData;
  tokens: Tokens;
  flashMsg: string | null;
  onChangePlan: () => void;
  onUnsubscribe: () => void;
  allowPlanChanges: boolean;
  allowCancellation: boolean;
}) {
  const elements = data.component.elements as Array<
    ComponentElement & Record<string, unknown>
  >;

  // Categorise elements by role
  const hasPlanManager = elements.some((e) => e.type === "planManager");
  const hasIncluded = elements.some((e) => e.type === "includedFeatures");
  const hasMetered = elements.some((e) => e.type === "meteredFeatures");
  const hasUnsubscribe =
    allowCancellation && elements.some((e) => e.type === "unsubscribe");
  const billingTypes = [
    "nextBillDue",
    "paymentMethod",
    "invoices",
    "billingHistory",
    "billing-history",
  ];
  const billingEls = elements.filter((e) => billingTypes.includes(e.type));
  const customEls = elements.filter((e) =>
    ["text", "button", "plansTable"].includes(e.type),
  );

  const plan = data.activePlan;
  const isPaid = plan ? parseFloat(String(plan.price)) > 0 : false;
  const price = plan ? parseFloat(String(plan.price)) : 0;

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
  const hasLeftCard = hasPlanManager || hasIncluded || hasMetered;
  const hasRightCol = billingEls.length > 0;

  // In merged mode, ignore columns and put everything in one card
  const isMerged = designSections === "merged";

  // In separate mode with columns >= 2, use grid for left/right split
  const useGrid = !isMerged && designColumns >= 2 && hasLeftCard && hasRightCol;

  // For columns=1 (single column), stack everything vertically even when separate
  const singleColumn = !isMerged && designColumns === 1;

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

      {/* Custom / full-width elements (text, button, plansTable) */}
      {customEls.map((el, i) =>
        renderElement(
          el,
          i,
          data,
          tokens,
          onChangePlan,
          onUnsubscribe,
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
                      {plan?.description ?? "Included with your subscription"}
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 8,
                        background: `${tokens.primary}18`,
                        color: tokens.primary,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      ✓ Active
                    </div>
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
                        {intervalLabel(plan!.billingInterval)}
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
                  {boolFeats.length === 0 ? (
                    <div
                      style={{
                        color: tokens.mutedColor,
                        fontSize: tokens.size - 1,
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
                          <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
            {[...billingEls].map((el, i) =>
              renderElement(
                el as ComponentElement & Record<string, unknown>,
                i + 200,
                data,
                tokens,
                onChangePlan,
                onUnsubscribe,
                allowPlanChanges,
                allowCancellation,
              ),
            )}
            {hasUnsubscribe && isPaid && (
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
        ) : singleColumn ? (
          /* ── SINGLE COLUMN: all elements stacked vertically as separate cards ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hasLeftCard && (
              <div style={leftCard}>
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
                            background: `${tokens.primary}18`,
                            color: tokens.primary,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          ✓ Active
                        </div>
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
                            {intervalLabel(plan!.billingInterval)}
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
                      {boolFeats.length === 0 ? (
                        <div
                          style={{
                            color: tokens.mutedColor,
                            fontSize: tokens.size - 1,
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
                              <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
                {hasUnsubscribe && isPaid && (
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
            {billingEls.map((el, i) =>
              renderElement(
                el as ComponentElement & Record<string, unknown>,
                i + 200,
                data,
                tokens,
                onChangePlan,
                onUnsubscribe,
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
                            background: `${tokens.primary}18`,
                            color: tokens.primary,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          ✓ Active
                        </div>
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
                            {intervalLabel(plan!.billingInterval)}
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
                                <FeatureIcon>{DOC_ICON}</FeatureIcon>
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
                {hasUnsubscribe && isPaid && (
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
  customerEmail,
  onSelectPlan,
  onBillingPeriodChange,
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
  customerEmail: string;
  onSelectPlan: (id: string) => void;
  onBillingPeriodChange: (p: "monthly" | "annual") => void;
  onCustomerEmailChange: (value: string) => void;
  onCouponQuoteChange: (quote: AppliedCouponQuote | null) => void;
  onSubscribeClose: () => void;
  onNextPayment: () => void;
  onBack: () => void;
  containerWidth: number;
}) {
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
  const selectedPlan = data.plans.find(
    (p: ComponentPlanSummary) => p.id === selectedPlanId,
  );
  const isCurrentPlanSelected =
    selectedPlanId === currentPlanId || !selectedPlanId;
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
    selectedPlanId && !isCurrentPlanSelected && !isFreePlanSelected;

  // Compute displayed price based on billing period
  const getDisplayPrice = (plan: ComponentPlanSummary) => {
    const monthly = parseFloat(String(plan.price));
    const annual = plan.annualPrice ? parseFloat(String(plan.annualPrice)) : 0;
    return billingPeriod === "annual" && annual > 0 ? annual : monthly;
  };

  const selectedDisplayPrice = selectedPlan ? getDisplayPrice(selectedPlan) : 0;
  const activeCouponQuote =
    couponQuote &&
    couponQuote.planId === selectedPlanId &&
    couponQuote.billingPeriod === billingPeriod
      ? couponQuote
      : null;
  const discountedPrice = activeCouponQuote
    ? activeCouponQuote.discountedAmountMicros / 1_000_000
    : selectedDisplayPrice;
  const immediateAmountDue =
    isAuthoritativeOnChainPlanChange &&
    discountedPrice <= (currentPlan ? getDisplayPrice(currentPlan) : 0)
      ? 0
      : discountedPrice;
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const hasCustomerEmail = normalizedCustomerEmail.length > 0;
  const hasInvalidCustomerEmail =
    hasCustomerEmail && !isValidCustomerEmail(normalizedCustomerEmail);

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
  }, [billingPeriod, onCouponQuoteChange, selectedPlanId]);

  const nextBill =
    formatDateLabel(data.nextBillingAt) ??
    (selectedPlan && discountedPrice > 0 ? "After activation" : null);

  async function applyCoupon() {
    if (!coupon.trim() || !selectedPlanId) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/v1/coupons/validate?code=${encodeURIComponent(coupon.trim())}&planId=${encodeURIComponent(selectedPlanId)}&billingPeriod=${encodeURIComponent(billingPeriod)}`,
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
          description:
            typeof d.description === "string" ? d.description : null,
          discount: Number(d.discount ?? 0),
          planId: String(d.planId ?? selectedPlanId),
          billingPeriod:
            d.billingPeriod === "annual" ? "annual" : "monthly",
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
          justifyContent: "flex-end",
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
          {(["monthly", "annual"] as const).map((period) => (
            <button
              key={period}
              onClick={() => onBillingPeriodChange(period)}
              style={{
                padding: "6px 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: tokens.size - 1,
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
              }}
            >
              {period === "monthly" ? "Billed monthly" : "Billed yearly"}
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
          ))}
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
          }}
        >
          {data.plans.map((plan: ComponentPlanSummary) => {
            const isActive = plan.id === currentPlanId;
            const isSelected = plan.id === selectedPlanId;
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
                  padding: "24px 20px",
                  borderRadius: tokens.radius,
                  border: isSelected
                    ? `2px solid ${tokens.primary}`
                    : `1px solid #e5e7eb`,
                  background: tokens.bg,
                  cursor: "pointer",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 180,
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
                <div style={{ flex: 1 }} />
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
                      background: isSelected ? `${tokens.primary}14` : tokens.primary,
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
                        if (e.key === "Enter" && couponsSupported) applyCoupon();
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
                      disabled={couponLoading || !coupon.trim() || !couponsSupported}
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
                        opacity:
                          couponLoading || !couponsSupported ? 0.6 : 1,
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
                      Coupons are not supported for this on-chain subscription
                      lifecycle flow.
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
                  color: hasInvalidCustomerEmail ? "#dc2626" : tokens.mutedColor,
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {hasInvalidCustomerEmail
                  ? "Enter a valid email address so invoices and billing notices reach the customer."
                  : "We’ll use this for receipts, invoices, and subscription notices."}
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
                ${discountedPrice.toFixed(2)}/
                {billingPeriodUnit(billingPeriod)}
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
                ${isCurrentPlanSelected ? "0.00" : immediateAmountDue.toFixed(2)}
              </span>
            </div>

            {/* CTA */}
            {isCurrentPlanSelected ? (
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
                  opacity: hasInvalidCustomerEmail ? 0.6 : 1,
                }}
                disabled={hasInvalidCustomerEmail}
              >
                {isAuthoritativeOnChainPlanChange
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

            {/* Billing fine print */}
            {selectedPlan && !isCurrentPlanSelected && discountedPrice > 0 && (
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
            )}
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
  tokens,
  customerEmail,
  onCustomerEmailChange,
  onConfirm,
  onActivationComplete,
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
  customerEmail: string;
  onCustomerEmailChange: (value: string) => void;
  onConfirm: (txHash?: string) => void;
  onActivationComplete: (result: {
    txHash?: string;
    pending?: boolean;
  }) => Promise<void> | void;
  onBack: () => void;
  containerWidth: number;
}) {
  const selectedPlan = data.plans.find(
    (p: ComponentPlanSummary) => p.id === selectedPlanId,
  );
  const activePlan = data.activePlan;
  const { address, isConnected } = useSafeAccount();
  const { walletClient: wagmiWalletClient } = useSafeWalletClient();
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [provisionedSmartAccountAddress, setProvisionedSmartAccountAddress] =
    useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [txStatus, setTxStatus] = useState<
    "idle" | "approving" | "confirmed" | "error"
  >("idle");
  const [txError, setTxError] = useState("");

  const basePrice = getPlanDisplayPrice(selectedPlan, billingPeriod);
  const activePlanPrice = getPlanDisplayPrice(activePlan, billingPeriod);
  const activeCouponQuote =
    couponQuote &&
    couponQuote.planId === selectedPlanId &&
    couponQuote.billingPeriod === billingPeriod
      ? couponQuote
      : null;
  const price = activeCouponQuote
    ? activeCouponQuote.discountedAmountMicros / 1_000_000
    : basePrice;
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const hasCustomerEmail = normalizedCustomerEmail.length > 0;
  const hasInvalidCustomerEmail =
    hasCustomerEmail && !isValidCustomerEmail(normalizedCustomerEmail);
  const paymentMethod = data.paymentMethod as ComponentPaymentMethod | null;
  const chainId = paymentMethod?.chainId ?? null;
  const serverSmartAccountAddress =
    typeof paymentMethod?.walletAddress === "string"
      ? paymentMethod.walletAddress
      : null;
  const smartAccountAddress =
    provisionedSmartAccountAddress ?? serverSmartAccountAddress;
  const zeroDevProjectId =
    process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? null;
  const selectedOnChainPlanId = selectedPlan?.onChainPlanId ?? null;
  const activeOnChainPlanId = activePlan?.onChainPlanId ?? null;
  const isOnChainPlanChange = Boolean(
    selectedPlan &&
      activePlan &&
      selectedPlan.id !== activePlan.id &&
      selectedOnChainPlanId &&
      activeOnChainPlanId,
  );
  const isPriceIncreasingPlanChange =
    isOnChainPlanChange && price > activePlanPrice;
  const requiresHostedActivation = Boolean(
    selectedOnChainPlanId && !activeOnChainPlanId,
  );
  const hasUnsupportedPaidFlow =
    price > 0 &&
    !isOnChainPlanChange &&
    !requiresHostedActivation &&
    selectedPlan?.id !== activePlan?.id;

  const isNarrowPayment = containerWidth < 700;
  const finalAddress = address || localAddress;
  const paymentAccount = smartAccountAddress ?? finalAddress;
  const finalConnected = isConnected || !!localAddress;
  const resolvedWalletClient =
    wagmiWalletClient ??
    (chainId
      ? createBrowserWalletClient({
          chainId,
          account: finalAddress,
        })
      : null);

  useEffect(() => {
    if (serverSmartAccountAddress) {
      setProvisionedSmartAccountAddress(serverSmartAccountAddress);
    }
  }, [serverSmartAccountAddress]);

  async function connectWindowEthereum() {
    setTxError("");
    setTxStatus("idle");
    setConnecting(true);
    try {
      const accounts = await requestWindowEthereumAccounts();
      setLocalAddress(accounts[0] ?? null);
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

    const requiresSmartAccountExecution = Boolean(
      effectiveSmartAccountAddress &&
        finalAddress &&
        effectiveSmartAccountAddress.toLowerCase() !== finalAddress.toLowerCase(),
    );

    if (requiresSmartAccountExecution) {
      if (!zeroDevProjectId || !effectiveSmartAccountAddress) {
        throw new Error(
          "Smart-account autopay setup requires NEXT_PUBLIC_ZERODEV_PROJECT_ID.",
        );
      }

      await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

      return sendSmartAccountTransaction({
        projectId: zeroDevProjectId,
        chainId,
        walletClient: resolvedWalletClient,
        smartAccountAddress: effectiveSmartAccountAddress as `0x${string}`,
        to: params.to,
        data: params.data,
      });
    }

    if (!finalAddress) {
      throw new Error("Connect the customer wallet before continuing.");
    }

    return submitWalletTransaction({
      chainId,
      walletClient: resolvedWalletClient,
      account: finalAddress as `0x${string}`,
      to: params.to,
      data: params.data,
    });
  }

  async function ensureBillingSmartAccount(): Promise<`0x${string}`> {
    if (smartAccountAddress && isAddress(smartAccountAddress)) {
      return smartAccountAddress as `0x${string}`;
    }

    if (!chainId || !resolvedWalletClient || !zeroDevProjectId || !finalAddress) {
      throw new Error(
        "A connected Base Sepolia wallet and NEXT_PUBLIC_ZERODEV_PROJECT_ID are required before activation.",
      );
    }

    await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

    const result = await deploySmartAccount({
      projectId: zeroDevProjectId,
      chainId,
      walletClient: resolvedWalletClient,
    });

    setProvisionedSmartAccountAddress(result.smartAccountAddress);
    return result.smartAccountAddress;
  }

  async function ensureAutopayReadyForActivation(onChainPlanId: string) {
    if (!chainId) {
      throw new Error("Missing payment chain for autopay setup.");
    }

    const billingPaymentAccount = await ensureBillingSmartAccount();

    const targetPlan = await readOnChainPlan(chainId, onChainPlanId);
    if (!targetPlan?.active) {
      throw new Error("The selected on-chain plan is not active anymore.");
    }
    if (
      !targetPlan.provider ||
      !targetPlan.acceptedToken ||
      typeof targetPlan.billingInterval !== "number"
    ) {
      throw new Error("The selected on-chain plan is missing billing metadata.");
    }

    const contracts = getContractAddresses(chainId);
    const autopayAddress = contracts.autopayModule as `0x${string}`;
    const tokenAddress = targetPlan.acceptedToken as `0x${string}`;
    const chargeAmount = BigInt(targetPlan.price ?? 0n);
    if (chargeAmount <= 0n) {
      throw new Error("The selected on-chain plan has no billable amount.");
    }

    const nextConfig = {
      merchant: targetPlan.provider as `0x${string}`,
      maxAmount: chargeAmount,
      token: tokenAddress,
      interval: Number(targetPlan.billingInterval),
      startTime: BigInt(Math.floor(Date.now() / 1000)),
      planId: BigInt(onChainPlanId),
      maxTotalAmount: 0n,
    };

    const isInitialized = await readAutopayInitialized(
      chainId,
      billingPaymentAccount,
    );
    if (!isInitialized) {
      const installData = encodeFunctionData({
        abi: ERC7579AutopayModuleABI,
        functionName: "onInstall",
        args: [encodeAutopayInstallData(nextConfig)],
      });

      await submitPaymentAccountTransaction({
        to: autopayAddress,
        data: installData,
        smartAccountAddressOverride: billingPaymentAccount,
      });
    } else {
      const currentConfig = await readAutopayConfig(
        chainId,
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
          smartAccountAddressOverride: billingPaymentAccount,
        });
      }
    }

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
      args: [autopayAddress, chargeAmount * 13n],
    });

    await submitPaymentAccountTransaction({
      to: tokenAddress,
      data: approveData,
      smartAccountAddressOverride: billingPaymentAccount,
    });

    return billingPaymentAccount;
  }

  async function handlePay() {
    setTxError("");
    if (price === 0) {
      onConfirm(undefined);
      return;
    }

    if (requiresHostedActivation) {
      if (!selectedOnChainPlanId || !selectedPlan) {
        setTxStatus("error");
        setTxError("Missing on-chain plan metadata for activation.");
        return;
      }

      if (!finalAddress) {
        setTxStatus("error");
        setTxError("Connect a wallet before activating this subscription.");
        return;
      }

      if (hasInvalidCustomerEmail) {
        setTxStatus("error");
        setTxError("Enter a valid billing email before activating.");
        return;
      }

      setTxStatus("approving");
      try {
        const readyPaymentAccount =
          await ensureAutopayReadyForActivation(selectedOnChainPlanId);
        const company =
          (data.company as Record<string, unknown> | null | undefined) ?? null;
        const body = {
          planId: selectedOnChainPlanId,
          paymentAccount: readyPaymentAccount,
          ...(hasCustomerEmail
            ? { subscriberEmail: normalizedCustomerEmail }
            : {}),
          company: {
            wallet:
              typeof company?.walletAddress === "string" &&
              company.walletAddress.trim()
                ? String(company.walletAddress)
                : readyPaymentAccount,
            ...(typeof company?.name === "string" && company.name.trim()
              ? { name: String(company.name) }
              : {}),
            ...(hasCustomerEmail
              ? { email: normalizedCustomerEmail }
              : typeof company?.email === "string" && company.email.trim()
                ? { email: String(company.email).trim().toLowerCase() }
                : {}),
          },
        };

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
          data?: { txHash?: string };
        };
        if (!res.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }

        setTxStatus("confirmed");
        await onActivationComplete({
          txHash: json.data?.txHash,
          pending: res.status === 202,
        });
      } catch (err: unknown) {
        setTxStatus("error");
        const msg = err instanceof Error ? err.message : "Activation failed";
        if (msg.includes("rejected") || msg.includes("denied")) {
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
        "This embed no longer accepts direct token transfers for paid plan changes. Use the authoritative hosted checkout or supported on-chain plan-change flow instead.",
      );
      return;
    }

    if (isPriceIncreasingPlanChange) {
      setTxStatus("error");
      setTxError(
        "Price-increasing upgrades are still blocked until the dedicated charge-plus-plan-change flow is deployed.",
      );
      return;
    }

    if (!chainId || !smartAccountAddress || !selectedOnChainPlanId) {
      setTxStatus("error");
      setTxError("Missing on-chain subscription metadata for this plan change.");
      return;
    }

    if (!resolvedWalletClient || !zeroDevProjectId) {
      setTxStatus("error");
      setTxError(
        "A wallet client and NEXT_PUBLIC_ZERODEV_PROJECT_ID are required for authoritative on-chain plan changes.",
      );
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
        throw new Error("The selected on-chain plan is missing billing metadata.");
      }

      const { txHash } = await updateAutopayConfig({
        projectId: zeroDevProjectId,
        chainId,
        walletClient: resolvedWalletClient,
        smartAccountAddress: smartAccountAddress as `0x${string}`,
        merchant: targetPlan.provider as `0x${string}`,
        maxAmount: BigInt(targetPlan.price ?? 0n),
        token: targetPlan.acceptedToken as `0x${string}`,
        interval: Number(targetPlan.billingInterval ?? 0),
        startTime:
          typeof currentConfig.startTime === "bigint"
            ? currentConfig.startTime
            : BigInt(Math.floor(Date.now() / 1000)),
        planId: BigInt(selectedOnChainPlanId),
        maxTotalAmount:
          typeof currentConfig.maxTotalAmount === "bigint"
            ? currentConfig.maxTotalAmount
            : 0n,
      });
      setTxStatus("confirmed");
      onConfirm(txHash);
    } catch (err: unknown) {
      setTxStatus("error");
      const msg = err instanceof Error ? err.message : "Transaction failed";
      if (msg.includes("rejected") || msg.includes("denied")) {
        setTxError("Transaction cancelled");
      } else {
        setTxError(msg.slice(0, 120));
      }
    }
  }

  const needsWallet =
    (isOnChainPlanChange || requiresHostedActivation) &&
    (!finalConnected || !finalAddress);
  const needsWalletClient =
    isOnChainPlanChange && (!resolvedWalletClient || !zeroDevProjectId);
  const immediateAmountDue =
    isOnChainPlanChange && price <= activePlanPrice ? 0 : price;
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
                    Update on-chain subscription
                  </div>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    Smart account transaction · EVM
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
                    Connect the wallet that controls your subscription smart
                    account before authorizing this on-chain plan change.
                  </div>
                  {hasWindowEth ? (
                    <PrimaryButton
                      tokens={tokens}
                      fullWidth
                      disabled={connecting}
                      onClick={connectWindowEthereum}
                    >
                      {connecting ? "Connecting…" : "Connect wallet"}
                    </PrimaryButton>
                  ) : (
                    <div
                      style={{
                        padding: "12px 14px",
                        background: "#fef9c3",
                        border: "1px solid #fde68a",
                        borderRadius: 8,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: tokens.size - 1,
                          color: "#92400e",
                          marginBottom: 2,
                        }}
                      >
                        No wallet found
                      </div>
                      <div
                        style={{ fontSize: tokens.size - 2, color: "#78350f" }}
                      >
                        Install{" "}
                        <a
                          href="https://metamask.io"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#d97706" }}
                        >
                          MetaMask
                        </a>{" "}
                        or use a Web3-enabled browser.
                      </div>
                    </div>
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
                    This route verifies a real `updateConfig(...)` transaction
                    before your plan changes. Off-chain-only plan changes are
                    intentionally rejected.
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
                  This embed needs a wallet client and
                  `NEXT_PUBLIC_ZERODEV_PROJECT_ID` to send smart-account plan
                  change transactions.
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

                  <PrimaryButton
                    tokens={tokens}
                    fullWidth
                    disabled={processing || txStatus === "approving"}
                    onClick={handlePay}
                  >
                    {txStatus === "approving"
                      ? "Confirm in wallet…"
                      : processing
                        ? "Processing…"
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
                    {price < activePlanPrice
                      ? "The backend will create the prorated wallet credit after it verifies this downgrade transaction."
                      : "The backend will switch your plan after it verifies this on-chain config update."}
                  </div>
                </div>
              )}
            </Card>
          ) : requiresHostedActivation ? (
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
                    Activate subscription
                  </div>
                  <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                    First bill + autopay setup
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
                This portal can activate the subscription directly from your
                app. Connect the customer wallet, confirm the payment account,
                and we will create the subscription on-chain for the selected
                plan.
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
                    color: hasInvalidCustomerEmail ? "#dc2626" : tokens.mutedColor,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {hasInvalidCustomerEmail
                    ? "Enter a valid email address so the subscription can be tied to the correct customer."
                    : "Recommended for receipts, invoices, and lifecycle notices."}
                </div>
              </div>

              {needsWallet ? (
                hasWindowEth ? (
                  <PrimaryButton
                    tokens={tokens}
                    fullWidth
                    disabled={connecting}
                    onClick={connectWindowEthereum}
                  >
                    {connecting ? "Connecting…" : "Connect wallet"}
                  </PrimaryButton>
                ) : (
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "#fef9c3",
                      border: "1px solid #fde68a",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: tokens.size - 1,
                        color: "#92400e",
                        marginBottom: 2,
                      }}
                    >
                      No wallet found
                    </div>
                    <div
                      style={{ fontSize: tokens.size - 2, color: "#78350f" }}
                    >
                      Install a Web3 wallet like MetaMask to continue.
                    </div>
                  </div>
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

                  <PrimaryButton
                    tokens={tokens}
                    fullWidth
                    disabled={
                      processing || txStatus === "approving" || hasInvalidCustomerEmail
                    }
                    onClick={handlePay}
                  >
                    {txStatus === "approving"
                      ? "Activating subscription…"
                      : processing
                        ? "Processing…"
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
                      ? "Paid changes in this portal must come from a verified on-chain subscription flow. Direct token transfer plan changes are disabled."
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

                {price > 0 && (isOnChainPlanChange || requiresHostedActivation) && (
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.mutedColor,
                      marginTop: 6,
                    }}
                  >
                    On-chain subscription flow · EVM
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
  tokens,
  onConfirm,
  onBack,
  containerWidth,
}: {
  data: ComponentRenderData;
  processing: boolean;
  tokens: Tokens;
  onConfirm: (txHash?: string) => void;
  onBack: () => void;
  containerWidth: number;
}) {
  const activePlan = data.activePlan;
  const price = activePlan ? parseFloat(String(activePlan.price)) : 0;
  const activePlanPeriod = activePlan
    ? intervalLabel(Number(activePlan.billingInterval)).replace("/", "") || "mo"
    : "mo";
  const isMobileUnsub = containerWidth < 600;
  const { address, isConnected } = useSafeAccount();
  const { walletClient: wagmiWalletClient } = useSafeWalletClient();
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [txStatus, setTxStatus] = useState<
    "idle" | "approving" | "confirmed" | "error"
  >("idle");
  const [txError, setTxError] = useState("");
  const paymentMethod = data.paymentMethod as ComponentPaymentMethod | null;
  const chainId = paymentMethod?.chainId ?? null;
  const smartAccountAddress =
    typeof paymentMethod?.walletAddress === "string"
      ? paymentMethod.walletAddress
      : null;
  const zeroDevProjectId =
    process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? null;
  const finalAddress = address || localAddress;
  const finalConnected = isConnected || !!localAddress;
  const resolvedWalletClient =
    wagmiWalletClient ??
    (chainId
      ? createBrowserWalletClient({
          chainId,
          account: finalAddress,
        })
      : null);
  const requiresOnChainCancellation = Boolean(
    activePlan?.onChainPlanId && smartAccountAddress && price > 0,
  );
  const needsWallet =
    requiresOnChainCancellation && (!finalConnected || !finalAddress);
  const needsWalletClient =
    requiresOnChainCancellation && (!resolvedWalletClient || !zeroDevProjectId);

  async function connectWindowEthereum() {
    setTxError("");
    setTxStatus("idle");
    setConnecting(true);
    try {
      const accounts = await requestWindowEthereumAccounts();
      setLocalAddress(accounts[0] ?? null);
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
      onConfirm(undefined);
      return;
    }

    if (!chainId || !smartAccountAddress) {
      setTxStatus("error");
      setTxError("Missing on-chain subscription metadata for cancellation.");
      return;
    }

    if (!resolvedWalletClient || !zeroDevProjectId) {
      setTxStatus("error");
      setTxError(
        "A wallet client and NEXT_PUBLIC_ZERODEV_PROJECT_ID are required for on-chain cancellation.",
      );
      return;
    }

    setTxStatus("approving");
    try {
      await ensureWalletOnTargetChain(resolvedWalletClient, chainId);

      const tokenId = await readWalletSubscriptionTokenId(
        chainId,
        smartAccountAddress,
      );
      if (tokenId <= 0n) {
        throw new Error(
          "No active on-chain subscription token was found for this payment account.",
        );
      }

      const { txHash } = await cancelSubscription({
        projectId: zeroDevProjectId,
        chainId,
        walletClient: resolvedWalletClient,
        smartAccountAddress: smartAccountAddress as `0x${string}`,
        tokenId,
      });

      setTxStatus("confirmed");
      onConfirm(txHash);
    } catch (error) {
      setTxStatus("error");
      setTxError(
        error instanceof Error
          ? error.message
          : "Cancellation transaction failed.",
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
          Cancel subscription
        </div>
        <div
          style={{
            fontSize: tokens.size - 1,
            color: tokens.mutedColor,
            lineHeight: 1.6,
            marginBottom: 24,
          }}
        >
          {requiresOnChainCancellation
            ? "Your paid subscription will be cancelled immediately once the on-chain transaction confirms."
            : "Your subscription will be downgraded to the free plan immediately."}
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
            Paid on-chain cancellations are immediate in the current protocol.
            This flow verifies the real cancellation transaction before your
            dashboard access is downgraded.
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
              Connect the wallet that controls your subscription smart account
              before cancelling.
            </div>
            <PrimaryButton
              tokens={tokens}
              fullWidth
              disabled={connecting}
              onClick={connectWindowEthereum}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </PrimaryButton>
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
          disabled={processing || txStatus === "approving" || needsWalletClient}
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
              : requiresOnChainCancellation
                ? "Cancel on-chain subscription"
                : "Cancel subscription"}
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
            This embed needs a wallet client and `NEXT_PUBLIC_ZERODEV_PROJECT_ID`
            to submit the cancellation transaction.
          </div>
        )}
      </div>
    </div>
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
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  successMsg: string | null;
  txHash: string | null;
  chainId: number | null;
  tokens: Tokens;
  onDone: () => void;
}) {
  const selectedPlan =
    data.plans.find((p: ComponentPlanSummary) => p.id === selectedPlanId) ??
    data.activePlan;

  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          onDone();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onDone]);

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
  baseUrl = "",
  className,
  style,
  mockData,
  initialView,
  onViewChange,
  onPlanChange,
}: ArcenEmbedProps) {
  const resolvedId = componentId ?? id ?? "";

  // All hooks must run unconditionally before any early returns
  const [state, dispatch] = useReducer(
    reducer,
    initialView ?? "portal",
    (v) => ({ ...initialState, view: v as PortalView }),
  );
  const [couponQuote, setCouponQuote] = useState<AppliedCouponQuote | null>(
    null,
  );
  const [customerEmail, setCustomerEmail] = useState("");
  const tokenRef = useRef(accessToken);
  const baseRef = useRef(baseUrl);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useContainerWidth(containerRef);

  // Notify parent whenever view changes
  useEffect(() => {
    onViewChange?.(state.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view]);
  tokenRef.current = accessToken;
  baseRef.current = baseUrl;

  const fetchData = useCallback(async () => {
    dispatch({ type: "FETCH_START" });
    try {
      const res = await fetch(
        `${baseRef.current}/api/v1/components/${resolvedId}/render`,
        {
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
      dispatch({
        type: "FETCH_ERR",
        error: e instanceof Error ? e.message : "Failed to load component",
      });
    }
  }, [resolvedId]);

  useEffect(() => {
    if (mockData) {
      // For mock data, load data and jump to initialView (preserve nav state, don't reset to portal)
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
    fetchData();
  }, [fetchData, mockData, initialView]);

  useEffect(() => {
    setCouponQuote((current) => {
      if (!current) return null;
      if (!state.selectedPlanId) return null;
      if (current.planId !== state.selectedPlanId) return null;
      if (current.billingPeriod !== state.billingPeriod) return null;
      return current;
    });
  }, [state.billingPeriod, state.selectedPlanId]);

  useEffect(() => {
    const company = (state.data?.company as Record<string, unknown> | null) ?? null;
    const nextEmail =
      typeof company?.email === "string"
        ? normalizeCustomerEmail(company.email)
        : "";

    if (!nextEmail) return;
    setCustomerEmail((current) => current || nextEmail);
  }, [state.data]);

  const callApi = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      const res = await fetch(`${baseRef.current}${path}`, {
        method: "POST",
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
    async (planId: string, txHash?: string) => {
      dispatch({ type: "PROCESSING_START" });
      try {
        const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
        const response = await callApi("/api/v1/companies/plan", {
          planId,
          billingPeriod: state.billingPeriod,
          ...(isValidCustomerEmail(normalizedCustomerEmail)
            ? { customerEmail: normalizedCustomerEmail }
            : {}),
          ...(couponQuote?.planId === planId &&
          couponQuote.billingPeriod === state.billingPeriod
            ? { couponCode: couponQuote.code }
            : {}),
          ...(txHash ? { txHash } : {}),
        });
        await fetchData();
        setCouponQuote(null);
        onPlanChange?.(planId);
        const mode = String(
          (response as { data?: { mode?: string } })?.data?.mode ?? "",
        );
        const walletCreditCreated = Number(
          (response as { data?: { walletCreditCreated?: string } })?.data
            ?.walletCreditCreated ?? 0,
        );
        dispatch({
          type: "GOTO_SUCCESS",
          successMsg:
            mode === "immediate_on_chain" && walletCreditCreated > 0
              ? `Plan changed. $${walletCreditCreated.toFixed(2)} wallet credit created.`
              : mode === "immediate_on_chain"
                ? "Plan changed on-chain."
                : "Plan activated!",
          txHash,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to switch plan";
        dispatch({
          type: "FETCH_ERR",
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
      state.billingPeriod,
    ],
  );

  const handleActivateSubscription = useCallback(
    async (result: { txHash?: string; pending?: boolean }) => {
      const selectedPlan = state.data?.plans.find(
        (plan: ComponentPlanSummary) => plan.id === state.selectedPlanId,
      );

      await fetchData();
      setCouponQuote(null);

      if (selectedPlan?.id) {
        onPlanChange?.(selectedPlan.id);
      }

      dispatch({
        type: "GOTO_SUCCESS",
        successMsg: result.pending
          ? "Subscription activation submitted. We’re finalizing the on-chain billing state now."
          : "Subscription activated!",
        txHash: result.txHash,
      });
    },
    [fetchData, onPlanChange, state.data, state.selectedPlanId],
  );

  const handleUnsubscribe = useCallback(async (txHash?: string) => {
    dispatch({ type: "PROCESSING_START" });
    try {
      await callApi("/api/v1/companies/unsubscribe", txHash ? { txHash } : {});
      await fetchData();
      if (txHash) {
        dispatch({
          type: "GOTO_SUCCESS",
          successMsg: "Subscription cancelled on-chain.",
          txHash,
        });
      } else {
        dispatch({
          type: "GOTO_PORTAL",
          flashMsg: "Subscription cancelled. You are now on the Free plan.",
        });
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Failed to cancel subscription";
      dispatch({
        type: msg === "__TOKEN_EXPIRED__" ? "FETCH_ERR" : "PROCESSING_ERR",
        error: msg === "__TOKEN_EXPIRED__" ? "__TOKEN_EXPIRED__" : msg,
      });
    }
  }, [callApi, fetchData]);

  const {
    data,
    loading,
    error,
    view,
    selectedPlanId,
    billingPeriod,
    processing,
    flashMsg,
    successMsg,
    successTxHash,
  } = state;

  useEffect(() => {
    if (
      view === "unsubscribe" &&
      !PORTAL_SELF_SERVE_CANCELLATION_ENABLED
    ) {
      dispatch({
        type: "GOTO_PORTAL",
        flashMsg:
          "Self-serve cancellation is disabled for this launch. Contact support to cancel or downgrade.",
      });
    }
  }, [view]);

  const handleOpenCheckout = useCallback(() => {
    if (!PORTAL_SELF_SERVE_PLAN_CHANGES_ENABLED) return;
    dispatch({ type: "OPEN_CHECKOUT" });
  }, []);

  const handleOpenUnsubscribe = useCallback(() => {
    if (!PORTAL_SELF_SERVE_CANCELLATION_ENABLED) return;
    dispatch({ type: "OPEN_UNSUBSCRIBE" });
  }, []);

  // Guard: missing required props — rendered after all hooks to comply with Rules of Hooks
  if (!accessToken) {
    return (
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 32,
          textAlign: "center",
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
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 32,
          textAlign: "center",
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

  if (loading) {
    return (
      <div
        className={className}
        style={{ fontFamily: "system-ui, sans-serif", padding: 24, ...style }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 120,
                background: "#f3f4f6",
                borderRadius: 10,
                animation: "pulse 1.5s infinite",
              }}
            />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
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
    padding: 24,
    boxSizing: "border-box" as const,
    ...style,
  };

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {view === "portal" && (
        <PortalContent
          data={data}
          tokens={tokens}
          flashMsg={flashMsg}
          onChangePlan={handleOpenCheckout}
          onUnsubscribe={handleOpenUnsubscribe}
          allowPlanChanges={PORTAL_SELF_SERVE_PLAN_CHANGES_ENABLED}
          allowCancellation={PORTAL_SELF_SERVE_CANCELLATION_ENABLED}
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
          customerEmail={customerEmail}
          containerWidth={containerWidth}
          onSelectPlan={(planId) => dispatch({ type: "SELECT_PLAN", planId })}
          onBillingPeriodChange={(p) =>
            dispatch({ type: "SET_BILLING_PERIOD", period: p })
          }
          onCustomerEmailChange={setCustomerEmail}
          onCouponQuoteChange={setCouponQuote}
          onSubscribeClose={() => {
            const targetId = selectedPlanId ?? data.activePlan?.id ?? "";
            if (targetId && targetId !== data.activePlan?.id) {
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
          tokens={tokens}
          customerEmail={customerEmail}
          containerWidth={containerWidth}
          onCustomerEmailChange={setCustomerEmail}
          onConfirm={(txHash) => {
            if (selectedPlanId) handleSwitchPlan(selectedPlanId, txHash);
          }}
          onActivationComplete={handleActivateSubscription}
          onBack={() => dispatch({ type: "OPEN_CHECKOUT" })}
        />
      )}
      {view === "unsubscribe" && (
        <UnsubscribeContent
          data={data}
          processing={processing}
          tokens={tokens}
          containerWidth={containerWidth}
          onConfirm={(txHash) => handleUnsubscribe(txHash)}
          onBack={() => dispatch({ type: "GOTO_PORTAL" })}
        />
      )}
      {view === "success" && (
        <SuccessContent
          data={data}
          selectedPlanId={selectedPlanId}
          successMsg={successMsg}
          txHash={successTxHash}
          chainId={data.paymentMethod?.chainId ?? null}
          tokens={tokens}
          onDone={() => dispatch({ type: "GOTO_PORTAL" })}
        />
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
 *   baseUrl="https://dashboard.arcenpay.xyz"
 * />
 */
export const ArcenpayEmbed = ArcenEmbed;
export type ArcenpayEmbedProps = ArcenEmbedProps;
