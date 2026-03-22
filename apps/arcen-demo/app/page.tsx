"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  process.env.NEXT_PUBLIC_DEMO_COMPANY_EMAIL || "demo@acmescan.xyz";
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
    default: "bg-[var(--surface-3)] text-[var(--text-dim)] border-[var(--border-dim)]",
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
        <span className="text-lg">{icon}</span>
        <h2 className="text-base font-bold text-[var(--text)]">{title}</h2>
      </div>
      <p className="text-xs text-[var(--text-muted)] pl-7">{sub}</p>
    </div>
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
          Connect wallet for on-chain components
        </span>
        <button
          onClick={() => connect({ connector: injected() })}
          className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-85 transition-opacity"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--success-dim)] border border-[var(--border-dim)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block" />
        <span className="text-xs text-[var(--success)] font-semibold">
          {truncateAddress(address!)}
        </span>
      </div>
      {chain && <Badge variant="warning">{chain.name}</Badge>}
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
        icon="💳"
        title="Subscription Plans"
        sub="PricingTable fetches plans from the PlanFactory contract. CheckoutModal handles the full on-chain subscribe flow with smart account support."
      />

      {walletAddress && (
        <div>
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Current Subscription
          </p>
          {/* SDK: SubscriptionStatus */}
          <SubscriptionStatus walletAddress={walletAddress} />
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          Available Plans
        </p>
        {/* SDK: PricingTable */}
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
            ⚠️ Connect a wallet to subscribe to a plan
          </p>
        )}
      </div>

      {/* SDK: CheckoutModal */}
      {checkoutPlanId !== null && walletAddress && (
        <CheckoutModal
          planId={checkoutPlanId}
          isOpen
          onClose={() => setCheckoutPlanId(null)}
          onSuccess={(tokenId) => {
            console.log("[AcmeScan] Checkout success, tokenId:", tokenId);
            setCheckoutPlanId(null);
          }}
          onError={(err) => {
            console.error("[AcmeScan] Checkout error:", err);
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

  // SDK Hook: useFlag
  const scanFlag = useFlag("scan", companyKeys, undefined, {
    baseUrl: API_BASE,
  });

  // SDK Hook: useFlags
  const { flags: bulkFlags, loading: bulkLoading } = useFlags(
    ["advanced_analytics", "api_access", "custom_exports", "sso"],
    companyKeys,
    undefined,
    { baseUrl: API_BASE }
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="🚩"
        title="Feature Flags"
        sub="useFlag / useFlags check flags via /api/v1/flags/check. FeatureFlagGuard renders children or fallback based on entitlement."
      />

      {/* SDK: FeatureFlagGuard */}
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          FeatureFlagGuard — &quot;scan&quot; feature gate
        </p>
        {walletAddress ? (
          <FeatureFlagGuard
            featureKey="scan"
            walletAddress={walletAddress}
            fallback={
              <Card className="border-[var(--warning)]">
                <div className="flex items-start gap-3">
                  <span className="text-xl">🔒</span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--warning)]">
                      Scan Feature Locked
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      This feature requires an active subscription with the
                      scan entitlement. Upgrade your plan to unlock.
                    </p>
                  </div>
                </div>
              </Card>
            }
          >
            <Card className="border-[var(--success)]">
              <div className="flex items-start gap-3">
                <span className="text-xl">✅</span>
                <div>
                  <p className="text-sm font-semibold text-[var(--success)]">
                    Scan Feature Unlocked
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Your subscription includes document scanning.
                  </p>
                  <div className="mt-3 p-3 rounded-lg bg-[var(--surface-3)] border border-[var(--border-dim)]">
                    <p className="text-xs font-mono text-[var(--accent)]">
                      📄 Protected content — only visible to entitled users
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </FeatureFlagGuard>
        ) : (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Connect a wallet to test FeatureFlagGuard with on-chain
              entitlement checking.
            </p>
          </Card>
        )}
      </div>

      {/* useFlag single */}
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          useFlag — Single flag check
        </p>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">
                Flag: <code>scan</code>
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {walletAddress
                  ? `wallet=${truncateAddress(walletAddress)}`
                  : `email=${DEMO_COMPANY_EMAIL}`}
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
                    <p className="text-[10px] text-[var(--text-muted)] max-w-[180px]">
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

      {/* useFlags bulk */}
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          useFlags — Bulk check (4 flags)
        </p>
        <Card>
          {bulkLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <div className="meap-spinner" />
              Checking flags…
            </div>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(bulkFlags).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <code className="text-xs text-[var(--accent)]">{key}</code>
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

  // SDK Hook: useTrack
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
          traits: { source: "arcen-demo", ts: Date.now() },
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
    [track, walletAddress]
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        icon="📊"
        title="Usage Tracking"
        sub="useTrack sends events to /api/v1/events. UsageDashboard reads live ZKVUB session metrics from the on-chain SessionVault contract."
      />

      {/* useTrack buttons */}
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          useTrack — Send usage events
        </p>
        <Card>
          <p className="text-xs text-[var(--text-dim)] mb-4">
            Calls{" "}
            <code>{"track({ name, company, traits })"}</code> → POST{" "}
            <code>/api/v1/events</code>
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {["scan", "advanced_analytics", "api_call", "export", "login"].map(
              (evt) => (
                <button
                  key={evt}
                  disabled={tracking !== null}
                  onClick={() => sendEvent(evt)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-85 disabled:opacity-50 transition-all"
                >
                  {tracking === evt ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          border: "2px solid rgba(255,255,255,0.3)",
                          borderTopColor: "white",
                          borderRadius: "50%",
                          display: "inline-block",
                          animation: "spin 0.8s linear infinite",
                        }}
                      />
                      {evt}
                    </span>
                  ) : (
                    `"${evt}"`
                  )}
                </button>
              )
            )}
          </div>
          {trackLog.length > 0 && (
            <div className="border-t border-[var(--border-dim)] pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Event Log
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {trackLog.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span>{entry.ok ? "✅" : "❌"}</span>
                      <code className="text-[var(--accent)]">{entry.name}</code>
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

      {/* SDK: UsageDashboard */}
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
          UsageDashboard — On-chain ZKVUB metrics
        </p>
        {walletAddress ? (
          <UsageDashboard pollInterval={10_000} />
        ) : (
          <Card>
            <p className="text-sm text-[var(--text-muted)]">
              Connect a wallet to view ZKVUB session usage from the on-chain
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
        icon="🧾"
        title="Billing History"
        sub="BillingHistory queries SubscriptionRegistry events (Minted, Renewed, Cancelled) on-chain via viem getLogs."
      />

      {walletAddress ? (
        /* SDK: BillingHistory */
        <BillingHistory walletAddress={walletAddress} maxEvents={25} />
      ) : (
        <Card>
          <div className="flex items-center gap-3 py-3">
            <span className="text-2xl">🔗</span>
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">
                Wallet Required
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Connect a wallet to view on-chain billing history and
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
        icon="🏗️"
        title="Embedded Billing Portal"
        sub="ArcenEmbed renders a self-serve billing portal. Uses a short-lived access token from ArcenClient.createAccessToken() on your backend."
      />

      {!walletAddress ? (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Connect a wallet to generate an access token and render the
            embedded ArcenEmbed billing portal.
          </p>
        </Card>
      ) : !accessToken ? (
        <Card>
          <p className="text-xs text-[var(--text-dim)] mb-4">
            Generate a short-lived access token to load the embedded component.
            In production this happens server-side via{" "}
            <code>arcen.createAccessToken()</code>.
          </p>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Component ID
              </label>
              <input
                value={componentId}
                onChange={(e) => setComponentId(e.target.value)}
                className="w-full bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                placeholder="cmpn_xxx"
              />
            </div>
            <button
              onClick={fetchAccessToken}
              disabled={tokenLoading}
              className="self-end px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-85 disabled:opacity-50 transition-all"
            >
              {tokenLoading ? "Generating…" : "Generate Token"}
            </button>
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
          {/* SDK: ArcenEmbed */}
          <ArcenEmbed
            accessToken={accessToken}
            componentId={componentId}
            baseUrl={
              process.env.NEXT_PUBLIC_ARCEN_BASE_URL || "http://localhost:3000"
            }
            onPlanChange={(planId) => {
              console.log("[AcmeScan] Plan changed via embed:", planId);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Setup Screen ─────────────────────────────────────────────
function SetupScreen({
  onComplete,
}: {
  onComplete: (apiKey: string, baseUrl: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    await onComplete(apiKey.trim(), baseUrl.trim());
    setSaving(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-3xl mx-auto mb-4">
            🔬
          </div>
          <h1 className="text-2xl font-bold text-[var(--text)]">AcmeScan</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            ArcenPay SDK Demo App
          </p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-[var(--text)] mb-1">
              Quick Setup
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Enter your ArcenPay API key to connect this demo to your
              dashboard. Create keys in{" "}
              <strong>Settings → Protocol Keys</strong>.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-dim)] block">
              Dashboard URL
            </label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              placeholder="http://localhost:3000"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-dim)] block">
              API Key{" "}
              <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              type="password"
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] font-mono"
              placeholder="api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <p className="text-[10px] text-[var(--text-muted)]">
              Stored in memory only — never sent to third parties
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || saving}
            className="w-full py-2.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm hover:opacity-85 disabled:opacity-40 transition-all"
          >
            {saving ? "Connecting…" : "Launch Demo App →"}
          </button>
        </div>

        <p className="text-center text-[10px] text-[var(--text-muted)] mt-4">
          Or set <code>ARCEN_API_KEY</code> in <code>.env.local</code> to skip
          this screen
        </p>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function DemoPage() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("plans");
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => {
        if (d.configured) setConfigured(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleSetup = async (apiKey: string, baseUrl: string) => {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, baseUrl }),
    });
    setConfigured(true);
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="meap-spinner" />
      </div>
    );
  }

  if (!configured) {
    return <SetupScreen onComplete={handleSetup} />;
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "plans", label: "Plans", icon: "💳" },
    { id: "features", label: "Features", icon: "🚩" },
    { id: "usage", label: "Usage", icon: "📊" },
    { id: "billing", label: "Billing", icon: "🧾" },
    { id: "portal", label: "Portal", icon: "🏗️" },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border-dim)] bg-[var(--surface)] sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-sm">
              🔬
            </div>
            <span className="text-sm font-bold text-[var(--text)]">
              AcmeScan
            </span>
            <span className="text-[10px] bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--border-dim)] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
              SDK Demo
            </span>
          </div>
          <WalletBar />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* SDK Banner */}
        <div className="mb-6 px-4 py-3 rounded-xl bg-[var(--accent-dim)] border border-[var(--border-dim)] flex items-start gap-3">
          <span className="text-base mt-0.5">ℹ️</span>
          <p className="text-xs text-[var(--text-dim)]">
            <strong className="text-[var(--accent)]">@meap/react</strong>{" "}
            components are live here:{" "}
            <code>PricingTable</code>, <code>CheckoutModal</code>,{" "}
            <code>SubscriptionStatus</code>, <code>FeatureFlagGuard</code>,{" "}
            <code>UsageDashboard</code>, <code>BillingHistory</code>,{" "}
            <code>ArcenEmbed</code> + hooks.{" "}
            {isConnected
              ? "Wallet connected — on-chain components active."
              : "Connect a wallet to enable on-chain components."}
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 mb-6 p-1 bg-[var(--surface-2)] rounded-xl border border-[var(--border-dim)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t.id
                  ? "bg-[var(--surface)] text-[var(--text)] shadow-sm border border-[var(--border-dim)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-dim)]"
              }`}
            >
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {tab === "plans" && <PlansTab walletAddress={address} />}
          {tab === "features" && <FeaturesTab walletAddress={address} />}
          {tab === "usage" && <UsageTab walletAddress={address} />}
          {tab === "billing" && <BillingTab walletAddress={address} />}
          {tab === "portal" && <PortalTab walletAddress={address} />}
        </div>
      </div>
    </div>
  );
}
