"use client";

import React, { useState, useCallback } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  PricingTable,
  CheckoutModal,
  SubscriptionStatus,
  FeatureFlagGuard,
  UsageDashboard,
  BillingHistory,
  ArcenEmbed,
  useFlag,
  useFlags,
  useTrack,
} from "@meap/react";

// ─── Constants ───────────────────────────────────────────────
const DEMO_COMPANY_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_COMPANY_EMAIL || "demo@arcenpay.xyz";
const API_BASE = "";

// ─── Types ───────────────────────────────────────────────────
type Tab = "plans" | "features" | "usage" | "billing" | "portal";

// ─── Helpers ─────────────────────────────────────────────────
function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  const cls: Record<string, string> = {
    default:
      "bg-[var(--surface-3)] text-[var(--text-dim)] border-[var(--border-dim)]",
    success:
      "bg-[var(--success-dim)] text-[var(--success)] border-[var(--border-dim)]",
    warning:
      "bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--border-dim)]",
    danger:
      "bg-[var(--danger-dim)] text-[var(--danger)] border-[var(--border-dim)]",
    accent:
      "bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--border-dim)]",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls[variant]}`}
    >
      {children}
    </span>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-[var(--radius)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  sub,
}: {
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">{icon}</span>
        <h2 className="text-sm font-bold text-[var(--text)] tracking-tight">
          {title}
        </h2>
      </div>
      <p className="text-xs text-[var(--text-muted)] pl-[26px] leading-relaxed">
        {sub}
      </p>
    </div>
  );
}

// ─── Primary Button ───────────────────────────────────────────
function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:opacity-85 disabled:opacity-40 transition-all tracking-tight ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Wallet Connect Bar ───────────────────────────────────────
function WalletBar() {
  const { address, isConnected, chain } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--text-muted)] hidden sm:block">
          Connect wallet to enable on-chain features
        </span>
        <PrimaryButton onClick={() => connect({ connector: injected() })}>
          Connect Wallet
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--success-dim)] border border-[var(--border-dim)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block" />
        <span className="text-xs text-[var(--success)] font-semibold font-mono">
          {truncateAddress(address!)}
        </span>
      </div>
      {chain && <Badge variant="default">{chain.name}</Badge>}
      <button
        onClick={() => disconnect()}
        className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-3)] border border-[var(--border-dim)] text-[var(--text-dim)] text-xs hover:text-[var(--text)] transition-all"
      >
        Disconnect
      </button>
    </div>
  );
}

// ─── Plans Tab ────────────────────────────────────────────────
function PlansTab({ walletAddress }: { walletAddress?: string }) {
  const [checkoutPlanId, setCheckoutPlanId] = useState<bigint | null>(null);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="◎"
        title="Subscription Plans"
        sub="On-chain subscription plans powered by Arcenpay. Payments are processed in USDC stablecoin across all supported chains — no credit cards."
      />

      {walletAddress && (
        <div>
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">
            Your Subscription
          </p>
          <SubscriptionStatus walletAddress={walletAddress} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
            Available Plans
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block" />
            USDC · Stablecoin only
          </div>
        </div>

        <PricingTable
          onSelectPlan={(planId) => {
            if (walletAddress) {
              setCheckoutPlanId(planId);
            } else {
              alert("Connect a wallet first to subscribe.");
            }
          }}
        />

        {!walletAddress && (
          <p className="mt-3 text-xs text-[var(--text-muted)] text-center">
            ↑ Connect a wallet to subscribe
          </p>
        )}
      </div>

      {checkoutPlanId !== null && walletAddress && (
        <CheckoutModal
          planId={checkoutPlanId}
          isOpen
          onClose={() => setCheckoutPlanId(null)}
          onSuccess={(tokenId) => {
            console.log("[Arcenpay] Subscription minted, tokenId:", tokenId);
            setCheckoutPlanId(null);
          }}
          onError={(err) => {
            console.error("[Arcenpay] Checkout error:", err);
          }}
        />
      )}
    </div>
  );
}

// ─── Features Tab ─────────────────────────────────────────────
function FeaturesTab({ walletAddress }: { walletAddress?: string }) {
  const companyKeys = walletAddress
    ? { wallet: walletAddress }
    : { email: DEMO_COMPANY_EMAIL };

  const scanFlag = useFlag("scan", companyKeys, undefined, {
    baseUrl: API_BASE,
  });

  const { flags: bulkFlags, loading: bulkLoading } = useFlags(
    ["advanced_analytics", "api_access", "custom_exports", "sso"],
    companyKeys,
    undefined,
    { baseUrl: API_BASE },
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="◈"
        title="Feature Entitlements"
        sub="On-chain entitlement checks via useFlag / useFlags. FeatureFlagGuard conditionally renders content based on active subscription tier."
      />

      <div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          FeatureFlagGuard — scan feature gate
        </p>
        {walletAddress ? (
          <FeatureFlagGuard
            featureKey="scan"
            walletAddress={walletAddress}
            fallback={
              <Card className="border-[var(--warning)]">
                <div className="flex items-start gap-3">
                  <span className="text-base leading-none mt-0.5">◉</span>
                  <div>
                    <p className="text-sm font-bold text-[var(--warning)] tracking-tight">
                      Feature Locked
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                      This feature requires an active subscription with the scan
                      entitlement. Upgrade your plan to unlock access.
                    </p>
                  </div>
                </div>
              </Card>
            }
          >
            <Card className="border-[var(--success)]">
              <div className="flex items-start gap-3">
                <span className="text-base leading-none mt-0.5 text-[var(--success)]">
                  ✓
                </span>
                <div>
                  <p className="text-sm font-bold text-[var(--success)] tracking-tight">
                    Feature Unlocked
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                    Your subscription includes full scan access.
                  </p>
                  <div className="mt-3 p-3 rounded-lg bg-[var(--surface-3)] border border-[var(--border-dim)]">
                    <p className="text-xs font-mono text-[var(--text-dim)]">
                      ◎ Protected content — visible to entitled subscribers only
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </FeatureFlagGuard>
        ) : (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Connect a wallet to test on-chain entitlement gating.
            </p>
          </Card>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          useFlag — Single flag check
        </p>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-[var(--text)] tracking-tight">
                <code>scan</code>
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
                {walletAddress
                  ? truncateAddress(walletAddress)
                  : DEMO_COMPANY_EMAIL}
              </p>
            </div>
            <div className="text-right">
              {scanFlag.loading ? (
                <div className="meap-spinner" />
              ) : (
                <div className="space-y-1">
                  <Badge variant={scanFlag.value ? "success" : "danger"}>
                    {scanFlag.value === null
                      ? "null"
                      : scanFlag.value
                        ? "true"
                        : "false"}
                  </Badge>
                  {scanFlag.reason && (
                    <p className="text-[10px] text-[var(--text-muted)] max-w-[180px] text-right">
                      {scanFlag.reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          {scanFlag.error && (
            <p className="text-xs text-[var(--danger)] mt-2">
              {scanFlag.error}
            </p>
          )}
          <button
            onClick={scanFlag.refetch}
            className="mt-3 px-2.5 py-1 rounded-md bg-[var(--surface-3)] border border-[var(--border-dim)] text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
          >
            Refetch
          </button>
        </Card>
      </div>

      <div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          useFlags — Bulk check (4 flags)
        </p>
        <Card>
          {bulkLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <div className="meap-spinner" />
              Checking entitlements…
            </div>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(bulkFlags).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <code className="text-xs text-[var(--text-dim)]">{key}</code>
                  <Badge variant={value ? "success" : "default"}>
                    {value === null ? "null" : value ? "true" : "false"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Usage Tab ────────────────────────────────────────────────
function UsageTab({ walletAddress }: { walletAddress?: string }) {
  const companyKeys = walletAddress
    ? { wallet: walletAddress }
    : { email: DEMO_COMPANY_EMAIL };

  const { track } = useTrack({ baseUrl: API_BASE });

  const [tracking, setTracking] = useState<string | null>(null);
  const [trackLog, setTrackLog] = useState<
    Array<{ name: string; ts: number; ok: boolean }>
  >([]);

  const sendEvent = useCallback(
    async (eventName: string) => {
      setTracking(eventName);
      try {
        await track({
          name: eventName,
          company: companyKeys,
          traits: { source: "arcenpay-sdk", ts: Date.now() },
        });
        setTrackLog((log) => [
          { name: eventName, ts: Date.now(), ok: true },
          ...log.slice(0, 9),
        ]);
      } catch {
        setTrackLog((log) => [
          { name: eventName, ts: Date.now(), ok: false },
          ...log.slice(0, 9),
        ]);
      } finally {
        setTracking(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track, walletAddress],
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="⬡"
        title="Usage Metering"
        sub="useTrack sends usage events for metered billing. UsageDashboard reads live session metrics from the on-chain SessionVault contract."
      />

      <div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          useTrack — Send usage events
        </p>
        <Card>
          <p className="text-xs text-[var(--text-dim)] mb-4 leading-relaxed">
            Fires <code>track({"{ name, company, traits }"})</code> → POST{" "}
            <code>/api/v1/events</code>
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {["api_call", "scan", "export", "analytics", "login"].map((evt) => (
              <button
                key={evt}
                disabled={tracking !== null}
                onClick={() => sendEvent(evt)}
                className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-bold hover:opacity-80 disabled:opacity-40 transition-all"
              >
                {tracking === evt ? (
                  <span className="flex items-center gap-1.5">
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        border: "2px solid rgba(0,0,0,0.2)",
                        borderTopColor: "#000",
                        borderRadius: "50%",
                        display: "inline-block",
                        animation: "spin 0.7s linear infinite",
                      }}
                    />
                    {evt}
                  </span>
                ) : (
                  `"${evt}"`
                )}
              </button>
            ))}
          </div>

          {trackLog.length > 0 && (
            <div className="border-t border-[var(--border-dim)] pt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                Event Log
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {trackLog.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={
                          entry.ok
                            ? "text-[var(--success)]"
                            : "text-[var(--danger)]"
                        }
                      >
                        {entry.ok ? "✓" : "✕"}
                      </span>
                      <code className="text-[var(--text-dim)]">
                        {entry.name}
                      </code>
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div>
        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
          UsageDashboard — On-chain ZKVUB metrics
        </p>
        {walletAddress ? (
          <UsageDashboard pollInterval={10_000} />
        ) : (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Connect a wallet to view live session usage from the on-chain
              SessionVault contract.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Billing Tab ──────────────────────────────────────────────
function BillingTab({ walletAddress }: { walletAddress?: string }) {
  return (
    <div className="space-y-6">
      <SectionHeading
        icon="↻"
        title="Billing History"
        sub="On-chain billing records. Queries SubscriptionRegistry events — Minted, Renewed, Cancelled — directly from the blockchain via viem."
      />

      {walletAddress ? (
        <BillingHistory walletAddress={walletAddress} maxEvents={25} />
      ) : (
        <Card>
          <div className="flex items-center gap-3 py-2">
            <span className="text-xl leading-none">⛓</span>
            <div>
              <p className="text-sm font-bold text-[var(--text)] tracking-tight">
                Wallet Required
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                Connect a wallet to view on-chain billing history and stablecoin
                transaction records from SubscriptionRegistry events.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Portal Tab ───────────────────────────────────────────────
function PortalTab({ walletAddress }: { walletAddress?: string }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [componentId, setComponentId] = useState("cmpn_default");

  const fetchAccessToken = useCallback(async () => {
    if (!walletAddress) return;
    setTokenLoading(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/access-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: { wallet: walletAddress },
          expiresIn: 3600,
        }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (data.token) {
        setAccessToken(data.token);
      } else {
        setTokenError(data.error ?? "Failed to generate access token");
      }
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Network error");
    } finally {
      setTokenLoading(false);
    }
  }, [walletAddress]);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="◫"
        title="Billing Portal"
        sub="ArcenEmbed renders a self-serve billing portal for your users. Drop it into any app with a short-lived access token from your backend."
      />

      {!walletAddress ? (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Connect a wallet to generate an access token and render the embedded
            billing portal.
          </p>
        </Card>
      ) : !accessToken ? (
        <Card>
          <p className="text-xs text-[var(--text-dim)] mb-4 leading-relaxed">
            Generate a short-lived access token to load the embedded billing
            portal. In production, call <code>arcen.createAccessToken()</code>{" "}
            server-side.
          </p>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] block mb-1.5">
                Component ID
              </label>
              <input
                value={componentId}
                onChange={(e) => setComponentId(e.target.value)}
                className="w-full bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[rgba(255,255,255,0.3)] font-mono"
                placeholder="cmpn_xxx"
              />
            </div>
            <PrimaryButton
              onClick={fetchAccessToken}
              disabled={tokenLoading}
              className="self-end py-2.5"
            >
              {tokenLoading ? "Generating…" : "Generate Token"}
            </PrimaryButton>
          </div>
          {tokenError && (
            <p className="text-xs text-[var(--danger)]">{tokenError}</p>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="success">Token Active</Badge>
              <span className="text-xs text-[var(--text-muted)]">
                expires in 1 hour
              </span>
            </div>
            <button
              onClick={() => setAccessToken(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Regenerate
            </button>
          </div>
          <ArcenEmbed
            accessToken={accessToken}
            componentId={componentId}
            baseUrl={
              process.env.NEXT_PUBLIC_ARCEN_BASE_URL || "http://localhost:3000"
            }
            onPlanChange={(planId) => {
              console.log("[Arcenpay] Plan changed via embed:", planId);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function DemoPage() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("plans");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "plans", label: "Plans", icon: "◎" },
    { id: "features", label: "Features", icon: "◈" },
    { id: "usage", label: "Usage", icon: "⬡" },
    { id: "billing", label: "Billing", icon: "↻" },
    { id: "portal", label: "Portal", icon: "◫" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-[var(--border-dim)] bg-[var(--surface)] sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black text-black"
              style={{ background: "#ffffff" }}
            >
              A
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--text)] tracking-tight">
                Arcenpay
              </span>
              <span className="hidden sm:inline text-[10px] text-[var(--text-muted)] border border-[var(--border-dim)] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                SDK
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Chain support indicator */}
            <div className="hidden md:flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block" />
              All chains · Stablecoin only
            </div>
            <WalletBar />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-5 py-6 w-full flex-1">
        {/* ── Status Banner ── */}
        {isConnected && address && (
          <div className="mb-5 px-4 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border-dim)] flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] flex-shrink-0 inline-block" />
            <p className="text-xs text-[var(--text-dim)]">
              Wallet connected —{" "}
              <span className="font-mono text-[var(--accent-2)]">
                {truncateAddress(address)}
              </span>{" "}
              — on-chain components active.
            </p>
          </div>
        )}

        {/* ── Tab Bar ── */}
        <div className="flex gap-1 mb-6 p-1 bg-[var(--surface-2)] rounded-xl border border-[var(--border-dim)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id
                  ? "bg-white text-black shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-dim)]"
              }`}
            >
              <span className="text-[11px] leading-none">{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div>
          {tab === "plans" && <PlansTab walletAddress={address} />}
          {tab === "features" && <FeaturesTab walletAddress={address} />}
          {tab === "usage" && <UsageTab walletAddress={address} />}
          {tab === "billing" && <BillingTab walletAddress={address} />}
          {tab === "portal" && <PortalTab walletAddress={address} />}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-dim)] mt-auto">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <p className="text-[11px] text-[var(--text-muted)]">
            All payments processed on-chain in USDC stablecoin. Multi-chain
            supported.
          </p>
          <a
            href="https://arcenpay.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="arcenpay-badge"
          >
            <span className="arcenpay-badge-dot" />
            Powered by Arcenpay
          </a>
        </div>
      </footer>
    </div>
  );
}
