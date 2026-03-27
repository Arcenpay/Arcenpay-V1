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
} from "@arcenpay/sdk";

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
}

type PortalView = "portal" | "checkout" | "payment" | "unsubscribe" | "success";

interface PortalState {
  data: ComponentRenderData | null;
  loading: boolean;
  error: string | null;
  view: PortalView;
  selectedPlanId: string | null;
  processing: boolean;
  flashMsg: string | null;
  successMsg: string | null;
}

type PortalAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_OK"; data: ComponentRenderData }
  | { type: "FETCH_ERR"; error: string }
  | { type: "OPEN_CHECKOUT" }
  | { type: "OPEN_UNSUBSCRIBE" }
  | { type: "OPEN_PAYMENT" }
  | { type: "GOTO_PORTAL"; flashMsg?: string }
  | { type: "GOTO_SUCCESS"; successMsg: string }
  | { type: "SELECT_PLAN"; planId: string }
  | { type: "PROCESSING_START" }
  | { type: "PROCESSING_DONE"; flashMsg?: string }
  | { type: "PROCESSING_ERR"; error: string };

const initialState: PortalState = {
  data: null,
  loading: true,
  error: null,
  view: "portal",
  selectedPlanId: null,
  processing: false,
  flashMsg: null,
  successMsg: null,
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
      };
    case "SELECT_PLAN":
      return { ...state, selectedPlanId: action.planId };
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
  const sections: "merged" | "separate" = design.sections === "merged" ? "merged" : "separate";
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

function fmtPrice(price: string | number, billingInterval?: number): string {
  const p = parseFloat(String(price));
  if (p === 0) return "Free";
  const interval =
    billingInterval !== undefined ? intervalLabel(billingInterval) : "";
  return `$${p.toFixed(2)}${interval}`;
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

// ─── Safe wagmi hook (avoids crash if wagmi not installed) ────────────────────

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

// ─── Portal element renderers ─────────────────────────────────────────────────

export function renderElement(
  el: ComponentElement & Record<string, unknown>,
  index: number,
  data: ComponentRenderData,
  tokens: Tokens,
  onChangePlan: () => void,
  onUnsubscribe: () => void,
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
            <PrimaryButton tokens={tokens} onClick={onChangePlan} fullWidth>
              Change plan
            </PrimaryButton>
          </div>
        </div>
      );
    }

    case "includedFeatures": {
      const ents = data.entitlements as Array<
        ComponentEntitlement & { featureType?: string }
      >;
      const boolFeats = ents.filter(
        (e) =>
          (!e.featureType || e.featureType === "boolean") &&
          (e.value === true || e.value === "true"),
      );
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
            {data.usage.length === 0 ? (
              <div
                style={{
                  border: "1px solid #f0f0f0",
                  borderRadius: tokens.radius,
                  padding: 16,
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
                      API Calls
                    </div>
                    <div
                      style={{
                        fontSize: tokens.size - 2,
                        color: tokens.mutedColor,
                      }}
                    >
                      0 used · Limit 10,000
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    height: 6,
                    background: "#f3f4f6",
                    borderRadius: 999,
                  }}
                />
              </div>
            ) : (
              data.usage.map((u: ComponentUsageItem, ui: number) => {
                const pct = u.limit
                  ? Math.min((u.used / u.limit) * 100, 100)
                  : 0;
                const barColor =
                  pct >= 90
                    ? "#ef4444"
                    : pct >= 70
                      ? "#f59e0b"
                      : tokens.primary;
                return (
                  <div
                    key={u.featureKey}
                    style={{
                      border: "1px solid #f0f0f0",
                      borderRadius: tokens.radius,
                      padding: 16,
                      marginBottom: ui < data.usage.length - 1 ? 10 : 0,
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
                          {u.name}
                        </div>
                        <div
                          style={{
                            fontSize: tokens.size - 2,
                            color: tokens.mutedColor,
                          }}
                        >
                          {u.used.toLocaleString()}{" "}
                          {u.unitPlural ?? u.unitSingular ?? "uses"}
                          {u.limit
                            ? ` · Limit ${u.limit.toLocaleString()}`
                            : ""}
                        </div>
                      </div>
                    </div>
                    {u.limit && (
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
              })
            )}
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
                  in 12 days
                </div>
              </div>
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  marginBottom: 10,
                }}
              >
                Estimated bill ·{" "}
                {new Date().toLocaleString("default", { month: "short" })} 1–
                {new Date(
                  new Date().getFullYear(),
                  new Date().getMonth() + 1,
                  0,
                ).getDate()}
              </div>
              <div
                style={{ height: 6, background: "#f3f4f6", borderRadius: 999 }}
              >
                <div
                  style={{
                    height: 6,
                    width: "60%",
                    background: tokens.primary,
                    borderRadius: 999,
                    opacity: 0.7,
                  }}
                />
              </div>
            </div>
          )}
        </Card>
      );
    }

    case "paymentMethod": {
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
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
          {isPaidPlan ? (
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
                  0x4a2f…8c3d
                </div>
                <div
                  style={{
                    fontSize: tokens.size - 3,
                    color: tokens.mutedColor,
                    marginTop: 1,
                  }}
                >
                  Base · USDC
                </div>
              </div>
              <span
                style={{
                  fontSize: tokens.size - 2,
                  fontWeight: 600,
                  color: tokens.primary,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Edit
              </span>
            </div>
          ) : (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              Free plan — no payment method required.
            </div>
          )}
        </Card>
      );
    }

    case "invoices": {
      const plan = data.activePlan;
      const isPaidPlan = plan && parseFloat(String(plan.price)) > 0;
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
          {isPaidPlan ? (
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size - 1,
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              Invoice history appears after the first charge.
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
      if (!isPaidPlan) return null;
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
          {isPaidPlan ? (
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size - 1,
                textAlign: "center",
                padding: "8px 0",
              }}
            >
              Billing history appears after the first charge.
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
}: {
  data: ComponentRenderData;
  tokens: Tokens;
  flashMsg: string | null;
  onChangePlan: () => void;
  onUnsubscribe: () => void;
}) {
  const elements = data.component.elements as Array<
    ComponentElement & Record<string, unknown>
  >;

  // Categorise elements by role
  const hasPlanManager = elements.some((e) => e.type === "planManager");
  const hasIncluded = elements.some((e) => e.type === "includedFeatures");
  const hasMetered = elements.some((e) => e.type === "meteredFeatures");
  const hasUnsubscribe = elements.some((e) => e.type === "unsubscribe");
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

  const ents = data.entitlements as Array<
    ComponentEntitlement & { featureType?: string }
  >;
  const boolFeats = ents.filter(
    (e) => !e.featureType || e.featureType === "boolean",
  );

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
  const useGrid = !isMerged && designColumns >= 2 && (hasLeftCard && hasRightCol);

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
        renderElement(el, i, data, tokens, onChangePlan, onUnsubscribe),
      )}

      {/* Main layout */}
      {(hasLeftCard || hasRightCol || isMerged) && (
        isMerged ? (
          /* ── MERGED mode: all elements inside one unified card ── */
          <div style={{ ...leftCard, marginBottom: 12 }}>
            {hasPlanManager && (
              <div style={{ padding: "24px 24px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: tokens.size + 18, fontWeight: 800, lineHeight: 1.05, color: tokens.textColor, letterSpacing: "-0.02em" }}>{plan?.name ?? "Free"}</div>
                    <div style={{ fontSize: tokens.size - 1, color: tokens.mutedColor, marginTop: 4 }}>{plan?.description ?? "Included with your subscription"}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, background: `${tokens.primary}18`, color: tokens.primary, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}>✓ Active</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: tokens.size + 10, fontWeight: 800, color: tokens.textColor }}>{price === 0 ? "Free" : `$${price.toFixed(2)}`}</div>
                    {isPaid && <div style={{ fontSize: tokens.size - 2, color: tokens.mutedColor }}>{intervalLabel(plan!.billingInterval)}</div>}
                  </div>
                </div>
                <PrimaryButton tokens={tokens} onClick={onChangePlan} fullWidth>Change plan</PrimaryButton>
              </div>
            )}
            {hasIncluded && <>{hasPlanManager && divider}<div style={{ padding: "20px 24px" }}><div style={{ fontSize: tokens.size, fontWeight: 700, color: tokens.textColor, marginBottom: 12 }}>Included features</div>{boolFeats.length === 0 ? <div style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}>No features configured.</div> : boolFeats.map((f, i) => (<div key={f.featureKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < boolFeats.length - 1 ? "1px solid #f5f5f5" : undefined }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><FeatureIcon>{DOC_ICON}</FeatureIcon><span style={{ fontSize: tokens.size, fontWeight: 500, color: tokens.textColor }}>{f.name ?? f.featureKey}</span></div><span style={{ fontWeight: 700, color: "#16a34a" }}>✓</span></div>))}</div></>}
            {[...billingEls].map((el, i) => renderElement(el as ComponentElement & Record<string, unknown>, i + 200, data, tokens, onChangePlan, onUnsubscribe))}
            {hasUnsubscribe && isPaid && <>{divider}<div style={{ padding: "14px 24px" }}><button onClick={onUnsubscribe} style={{ background: "none", border: "none", cursor: "pointer", fontSize: tokens.size - 1, color: tokens.mutedColor, padding: 0, fontFamily: tokens.font }}>Cancel subscription</button></div></>}
          </div>
        ) : singleColumn ? (
          /* ── SINGLE COLUMN: all elements stacked vertically as separate cards ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hasLeftCard && <div style={leftCard}>
              {hasPlanManager && (
                <div style={{ padding: "24px 24px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: tokens.size + 18, fontWeight: 800, lineHeight: 1.05, color: tokens.textColor, letterSpacing: "-0.02em" }}>{plan?.name ?? "Free"}</div>
                      <div style={{ fontSize: tokens.size - 1, color: tokens.mutedColor, marginTop: 4 }}>{plan?.description ?? "Included with your subscription"}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, background: `${tokens.primary}18`, color: tokens.primary, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}>✓ Active</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: tokens.size + 10, fontWeight: 800, color: tokens.textColor }}>{price === 0 ? "Free" : `$${price.toFixed(2)}`}</div>
                      {isPaid && <div style={{ fontSize: tokens.size - 2, color: tokens.mutedColor }}>{intervalLabel(plan!.billingInterval)}</div>}
                    </div>
                  </div>
                  <PrimaryButton tokens={tokens} onClick={onChangePlan} fullWidth>Change plan</PrimaryButton>
                </div>
              )}
              {hasIncluded && <>{(hasPlanManager) && divider}<div style={{ padding: "20px 24px" }}><div style={{ fontSize: tokens.size, fontWeight: 700, color: tokens.textColor, marginBottom: 12 }}>Included features</div>{boolFeats.length === 0 ? <div style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}>No features configured.</div> : boolFeats.map((f, i) => (<div key={f.featureKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < boolFeats.length - 1 ? "1px solid #f5f5f5" : undefined }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><FeatureIcon>{DOC_ICON}</FeatureIcon><span style={{ fontSize: tokens.size, fontWeight: 500, color: tokens.textColor }}>{f.name ?? f.featureKey}</span></div><span style={{ fontWeight: 700, color: "#16a34a" }}>✓</span></div>))}</div></>}
              {hasMetered && <>{(hasPlanManager || hasIncluded) && divider}<div style={{ padding: "20px 24px" }}><div style={{ fontSize: tokens.size, fontWeight: 700, color: tokens.textColor, marginBottom: 14 }}>Usage</div>{data.usage.length === 0 ? <div style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}>No usage data.</div> : data.usage.map((u: ComponentUsageItem, ui: number) => { const pct = u.limit ? Math.min((u.used / u.limit) * 100, 100) : 0; const barColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : tokens.primary; return (<div key={u.featureKey} style={{ marginBottom: ui < data.usage.length - 1 ? 10 : 0 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><FeatureIcon size={36}>{CHART_ICON}</FeatureIcon><div><div style={{ fontSize: tokens.size, fontWeight: 600, color: tokens.textColor }}>{u.name}</div><div style={{ fontSize: tokens.size - 2, color: tokens.mutedColor }}>{u.used.toLocaleString()} {u.unitPlural ?? "uses"}{u.limit ? ` · Limit ${u.limit.toLocaleString()}` : ""}</div></div></div>{u.limit && <div style={{ height: 6, background: "#f3f4f6", borderRadius: 999 }}><div style={{ height: 6, width: `${pct}%`, background: barColor, borderRadius: 999 }} /></div>}</div>); })}</div></>}
              {hasUnsubscribe && isPaid && <>{divider}<div style={{ padding: "14px 24px" }}><button onClick={onUnsubscribe} style={{ background: "none", border: "none", cursor: "pointer", fontSize: tokens.size - 1, color: tokens.mutedColor, padding: 0, fontFamily: tokens.font }}>Cancel subscription</button></div></>}
            </div>}
            {billingEls.map((el, i) => renderElement(el as ComponentElement & Record<string, unknown>, i + 200, data, tokens, onChangePlan, onUnsubscribe))}
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
                  <PrimaryButton
                    tokens={tokens}
                    onClick={onChangePlan}
                    fullWidth
                  >
                    Change plan
                  </PrimaryButton>
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
                    {data.usage.length === 0 ? (
                      /* Demo placeholder */
                      <div
                        style={{
                          border: "1px solid #f0f0f0",
                          borderRadius: tokens.radius,
                          padding: 16,
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
                              API Calls
                            </div>
                            <div
                              style={{
                                fontSize: tokens.size - 2,
                                color: tokens.mutedColor,
                              }}
                            >
                              0 used · Limit 10,000
                            </div>
                          </div>
                        </div>
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
                              width: "0%",
                              background: tokens.primary,
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      data.usage.map((u: ComponentUsageItem, ui: number) => {
                        const pct = u.limit
                          ? Math.min((u.used / u.limit) * 100, 100)
                          : 0;
                        const barColor =
                          pct >= 90
                            ? "#ef4444"
                            : pct >= 70
                              ? "#f59e0b"
                              : tokens.primary;
                        return (
                          <div
                            key={u.featureKey}
                            style={{
                              border: "1px solid #f0f0f0",
                              borderRadius: tokens.radius,
                              padding: 16,
                              marginBottom: ui < data.usage.length - 1 ? 10 : 0,
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
                                  {u.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: tokens.size - 2,
                                    color: tokens.mutedColor,
                                  }}
                                >
                                  {u.used.toLocaleString()}{" "}
                                  {u.unitPlural ?? u.unitSingular ?? "uses"}
                                  {u.limit
                                    ? ` · Limit ${u.limit.toLocaleString()}`
                                    : ""}
                                </div>
                              </div>
                            </div>
                            {u.limit && (
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
                      })
                    )}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {billingEls.map((el, i) =>
                renderElement(
                  el as ComponentElement & Record<string, unknown>,
                  i + 200,
                  data,
                  tokens,
                  onChangePlan,
                  onUnsubscribe,
                ),
              )}
              {/* Branding */}
              <div style={{ textAlign: "center", paddingTop: 4 }}>
                <div style={{ fontSize: 11, color: tokens.mutedColor }}>
                  Secured by{" "}
                  <strong style={{ fontWeight: 700, color: tokens.textColor }}>ArcenPay</strong>
                  {" "}· On-chain payments
                </div>
              </div>
            </div>
          )}
        </div>
        )
      )}

      {/* Branding when no billing column (grid/single layouts) */}
      {!isMerged && !hasRightCol && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: tokens.mutedColor }}>
            Secured by{" "}
            <strong style={{ fontWeight: 700, color: tokens.textColor }}>ArcenPay</strong>
            {" "}· On-chain payments
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
  processing,
  tokens,
  onSelectPlan,
  onSubscribeClose,
  onNextPayment,
  onBack,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  processing: boolean;
  tokens: Tokens;
  onSelectPlan: (id: string) => void;
  onSubscribeClose: () => void;
  onNextPayment: () => void;
  onBack: () => void;
}) {
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
  const needsPayment =
    selectedPlanId && !isCurrentPlanSelected && !isFreePlanSelected;

  return (
    <div>
      <ViewHeader
        title="Select Plan"
        onBack={onBack}
        step={1}
        tokens={tokens}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 24,
          alignItems: "start",
        }}
      >
        {/* Left: plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {data.plans.map((plan: ComponentPlanSummary) => {
            const isActive = plan.id === currentPlanId;
            const isSelected = plan.id === selectedPlanId;
            const price = parseFloat(String(plan.price));
            return (
              <div
                key={plan.id}
                onClick={() => onSelectPlan(plan.id)}
                style={{
                  padding: 20,
                  borderRadius: tokens.radius,
                  border: isSelected
                    ? `2px solid ${tokens.primary}`
                    : `1px solid #e5e7eb`,
                  background: isSelected ? `${tokens.primary}08` : tokens.bg,
                  cursor: "pointer",
                  position: "relative",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                {isActive ? (
                  <div
                    style={{
                      position: "absolute",
                      top: -10,
                      left: 12,
                      background: tokens.primary,
                      color: isLightColor(tokens.primary) ? "#000" : "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    Current
                  </div>
                ) : null}
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: tokens.size + 2,
                    color: tokens.textColor,
                    marginBottom: 2,
                  }}
                >
                  {plan.name}
                </div>
                {plan.description ? (
                  <div
                    style={{
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                      marginBottom: 10,
                    }}
                  >
                    {plan.description}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: tokens.size + 8,
                    fontWeight: 800,
                    color: tokens.textColor,
                    marginBottom: 16,
                  }}
                >
                  {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                  {price > 0 ? (
                    <span
                      style={{
                        fontSize: tokens.size - 1,
                        fontWeight: 400,
                        color: tokens.mutedColor,
                      }}
                    >
                      {intervalLabel(plan.billingInterval)}
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    width: "100%",
                    padding: "7px 0",
                    background: isActive
                      ? "transparent"
                      : isSelected
                        ? tokens.primary
                        : "#f3f4f6",
                    color: isActive
                      ? tokens.mutedColor
                      : isSelected
                        ? isLightColor(tokens.primary)
                          ? "#000"
                          : "#fff"
                        : tokens.textColor,
                    border: isActive ? `1px solid #e5e7eb` : "none",
                    borderRadius: tokens.radius / 1.5,
                    textAlign: "center",
                    fontSize: tokens.size - 1,
                    fontWeight: 600,
                  }}
                >
                  {isActive
                    ? "✓ Current plan"
                    : isSelected
                      ? "✓ Plan selected"
                      : "Choose plan"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: summary */}
        <div
          style={{
            background: "#fafafa",
            border: `1px solid #f0f0f0`,
            borderRadius: tokens.radius,
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: tokens.size + 2,
              color: tokens.textColor,
            }}
          >
            Summary
          </div>

          {selectedPlan && !isCurrentPlanSelected ? (
            <div>
              {currentPlan ? (
                <div
                  style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: `1px solid #e5e7eb`,
                  }}
                >
                  <div
                    style={{
                      fontSize: tokens.size - 2,
                      color: tokens.mutedColor,
                      marginBottom: 4,
                    }}
                  >
                    Current
                  </div>
                  <div
                    style={{
                      fontWeight: 500,
                      color: tokens.mutedColor,
                      textDecoration: "line-through",
                      fontSize: tokens.size,
                    }}
                  >
                    {currentPlan.name} —{" "}
                    {fmtPrice(currentPlan.price, currentPlan.billingInterval)}
                  </div>
                </div>
              ) : null}
              <div
                style={{
                  marginBottom: 16,
                  paddingBottom: 12,
                  borderBottom: `1px solid #e5e7eb`,
                }}
              >
                <div
                  style={{
                    fontSize: tokens.size - 2,
                    color: tokens.mutedColor,
                    marginBottom: 4,
                  }}
                >
                  New plan
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    color: tokens.textColor,
                    fontSize: tokens.size,
                  }}
                >
                  {selectedPlan.name} —{" "}
                  {fmtPrice(selectedPlan.price, selectedPlan.billingInterval)}
                </div>
              </div>
              {needsPayment ? (
                <PrimaryButton
                  tokens={tokens}
                  fullWidth
                  onClick={onNextPayment}
                >
                  Next: Payment →
                </PrimaryButton>
              ) : (
                <PrimaryButton
                  tokens={tokens}
                  fullWidth
                  disabled={processing}
                  onClick={onSubscribeClose}
                >
                  {processing ? "Processing..." : "Subscribe and close"}
                </PrimaryButton>
              )}
              {selectedPlan ? (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: tokens.mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  {parseFloat(String(selectedPlan.price)) === 0
                    ? "You are switching to the free plan. Your subscription will be cancelled."
                    : `You will be billed ${fmtPrice(selectedPlan.price, selectedPlan.billingInterval)} unless you unsubscribe.`}
                </div>
              ) : null}
            </div>
          ) : (
            <div
              style={{ color: tokens.mutedColor, fontSize: tokens.size - 1 }}
            >
              {selectedPlanId === currentPlanId
                ? "You are already on this plan."
                : "Select a plan to see pricing."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Payment content (inline) ─────────────────────────────────────────────────

function PaymentContent({
  data,
  selectedPlanId,
  processing,
  tokens,
  onConfirm,
  onBack,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  processing: boolean;
  tokens: Tokens;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const selectedPlan = data.plans.find(
    (p: ComponentPlanSummary) => p.id === selectedPlanId,
  );
  const { address, isConnected } = useSafeAccount();
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const price = selectedPlan ? parseFloat(String(selectedPlan.price)) : 0;
  const acceptedToken = selectedPlan?.acceptedToken ?? "USDC";

  const finalAddress = address || localAddress;
  const finalConnected = isConnected || !!localAddress;

  async function connectWindowEthereum() {
    if (typeof window === "undefined") return;
    const eth = (
      window as unknown as {
        ethereum?: { request: (args: { method: string }) => Promise<string[]> };
      }
    ).ethereum;
    if (!eth) return;
    setConnecting(true);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      setLocalAddress(accounts[0] ?? null);
    } catch {
      // user rejected
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div>
      <ViewHeader title="Payment" onBack={onBack} step={2} tokens={tokens} />

      {/* Plan summary card */}
      {selectedPlan ? (
        <Card tokens={tokens} style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
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
                Selected plan
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
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: tokens.size + 6,
                  color: tokens.textColor,
                }}
              >
                ${price.toFixed(2)}
              </div>
              <div
                style={{ fontSize: tokens.size - 2, color: tokens.mutedColor }}
              >
                {intervalLabel(selectedPlan.billingInterval)} · {acceptedToken}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Wallet section */}
      <Card tokens={tokens} style={{ marginBottom: 20 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: tokens.size,
            color: tokens.textColor,
            marginBottom: 14,
          }}
        >
          Wallet
        </div>
        {finalConnected && finalAddress ? (
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
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 16 }}>✓</span>
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
                    color: "#4ade80",
                    fontSize: 11,
                    fontFamily: "monospace",
                    marginTop: 1,
                  }}
                >
                  {finalAddress.slice(0, 6)}...{finalAddress.slice(-4)}
                </div>
              </div>
            </div>
            <PrimaryButton
              tokens={tokens}
              fullWidth
              disabled={processing}
              onClick={onConfirm}
            >
              {processing
                ? "Processing..."
                : `Confirm — Pay $${price.toFixed(2)} ${acceptedToken}`}
            </PrimaryButton>
          </div>
        ) : (
          <div>
            <div
              style={{
                color: tokens.mutedColor,
                fontSize: tokens.size - 1,
                marginBottom: 12,
              }}
            >
              Connect your wallet to pay with {acceptedToken}
            </div>
            {typeof window !== "undefined" &&
            (window as unknown as { ethereum?: unknown }).ethereum ? (
              <PrimaryButton
                tokens={tokens}
                fullWidth
                disabled={connecting}
                onClick={connectWindowEthereum}
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </PrimaryButton>
            ) : (
              <div
                style={{
                  fontSize: tokens.size - 2,
                  color: tokens.mutedColor,
                  padding: "10px 12px",
                  background: "#f9fafb",
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                }}
              >
                No wallet detected. Install MetaMask or another Web3 wallet to
                pay on-chain.
              </div>
            )}
          </div>
        )}
      </Card>

      <div style={{ fontSize: 11, color: tokens.mutedColor, lineHeight: 1.5 }}>
        {acceptedToken} payments are processed on-chain.
      </div>
    </div>
  );
}

// ─── Unsubscribe content (inline) ─────────────────────────────────────────────

function UnsubscribeContent({
  data,
  processing,
  tokens,
  onConfirm,
  onBack,
}: {
  data: ComponentRenderData;
  processing: boolean;
  tokens: Tokens;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const activePlan = data.activePlan;
  return (
    <div>
      <ViewHeader title="Cancel Subscription" onBack={onBack} tokens={tokens} />

      <div
        style={{
          color: tokens.mutedColor,
          fontSize: tokens.size - 1,
          lineHeight: 1.7,
          marginBottom: 20,
        }}
      >
        You will retain access until the end of the billing period. After that,
        your account will be moved to the Free plan.
      </div>

      {activePlan ? (
        <Card tokens={tokens} style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}
            >
              Current plan
            </span>
            <span style={{ fontWeight: 600, color: tokens.textColor }}>
              {activePlan.name}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span
              style={{ fontSize: tokens.size - 1, color: tokens.mutedColor }}
            >
              Charge
            </span>
            <span style={{ fontWeight: 600, color: tokens.textColor }}>
              {fmtPrice(activePlan.price, activePlan.billingInterval)}
            </span>
          </div>
        </Card>
      ) : null}

      <div style={{ display: "flex", gap: 12 }}>
        <SecondaryButton tokens={tokens} onClick={onBack} style={{ flex: 1 }}>
          Keep plan
        </SecondaryButton>
        <button
          onClick={onConfirm}
          disabled={processing}
          style={{
            flex: 1,
            padding: "10px 0",
            background: "#ef4444",
            border: "none",
            borderRadius: tokens.radius / 1.5,
            cursor: processing ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: tokens.size - 1,
            color: "#fff",
            opacity: processing ? 0.7 : 1,
          }}
        >
          {processing ? "Cancelling..." : "Cancel subscription"}
        </button>
      </div>
    </div>
  );
}

// ─── Success content ──────────────────────────────────────────────────────────

function SuccessContent({
  data,
  selectedPlanId,
  successMsg,
  tokens,
  onDone,
}: {
  data: ComponentRenderData;
  selectedPlanId: string | null;
  successMsg: string | null;
  tokens: Tokens;
  onDone: () => void;
}) {
  const selectedPlan =
    data.plans.find((p: ComponentPlanSummary) => p.id === selectedPlanId) ??
    data.activePlan;

  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✓</div>
      <div
        style={{
          fontWeight: 800,
          fontSize: tokens.size + 10,
          color: tokens.textColor,
          marginBottom: 8,
        }}
      >
        {successMsg ?? "Plan activated!"}
      </div>
      {selectedPlan ? (
        <div
          style={{
            color: tokens.mutedColor,
            fontSize: tokens.size,
            marginBottom: 24,
          }}
        >
          {selectedPlan.name} —{" "}
          {fmtPrice(selectedPlan.price, selectedPlan.billingInterval)}
        </div>
      ) : null}
      <PrimaryButton tokens={tokens} onClick={onDone}>
        Done
      </PrimaryButton>
      <div style={{ fontSize: 11, color: tokens.mutedColor, marginTop: 12 }}>
        Returning to portal in 3 seconds…
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
}: ArcenEmbedProps) {
  const resolvedId = componentId ?? id ?? "";
  const [state, dispatch] = useReducer(
    reducer,
    initialView ?? "portal",
    (v) => ({ ...initialState, view: v as PortalView }),
  );
  const tokenRef = useRef(accessToken);
  const baseRef = useRef(baseUrl);

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
    async (planId: string) => {
      dispatch({ type: "PROCESSING_START" });
      try {
        await callApi("/api/v1/companies/plan", { planId });
        await fetchData();
        dispatch({ type: "GOTO_SUCCESS", successMsg: "Plan activated!" });
      } catch (e: unknown) {
        dispatch({
          type: "PROCESSING_ERR",
          error: e instanceof Error ? e.message : "Failed to switch plan",
        });
      }
    },
    [callApi, fetchData],
  );

  const handleUnsubscribe = useCallback(async () => {
    dispatch({ type: "PROCESSING_START" });
    try {
      await callApi("/api/v1/companies/unsubscribe");
      await fetchData();
      dispatch({
        type: "GOTO_PORTAL",
        flashMsg: "Subscription cancelled. You are now on the Free plan.",
      });
    } catch (e: unknown) {
      dispatch({
        type: "PROCESSING_ERR",
        error: e instanceof Error ? e.message : "Failed to cancel subscription",
      });
    }
  }, [callApi, fetchData]);

  const {
    data,
    loading,
    error,
    view,
    selectedPlanId,
    processing,
    flashMsg,
    successMsg,
  } = state;

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
    return (
      <div
        className={className}
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
          color: "#6b7280",
          ...style,
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Portal not found</div>
        <div style={{ fontSize: 13 }}>{error}</div>
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
    <div className={className} style={containerStyle}>
      {view === "portal" && (
        <PortalContent
          data={data}
          tokens={tokens}
          flashMsg={flashMsg}
          onChangePlan={() => dispatch({ type: "OPEN_CHECKOUT" })}
          onUnsubscribe={() => dispatch({ type: "OPEN_UNSUBSCRIBE" })}
        />
      )}
      {view === "checkout" && (
        <CheckoutContent
          data={data}
          selectedPlanId={selectedPlanId}
          processing={processing}
          tokens={tokens}
          onSelectPlan={(planId) => dispatch({ type: "SELECT_PLAN", planId })}
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
          processing={processing}
          tokens={tokens}
          onConfirm={() => {
            if (selectedPlanId) handleSwitchPlan(selectedPlanId);
          }}
          onBack={() => dispatch({ type: "OPEN_CHECKOUT" })}
        />
      )}
      {view === "unsubscribe" && (
        <UnsubscribeContent
          data={data}
          processing={processing}
          tokens={tokens}
          onConfirm={handleUnsubscribe}
          onBack={() => dispatch({ type: "GOTO_PORTAL" })}
        />
      )}
      {view === "success" && (
        <SuccessContent
          data={data}
          selectedPlanId={selectedPlanId}
          successMsg={successMsg}
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
