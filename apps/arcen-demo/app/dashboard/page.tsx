"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  useConsumeEntitlement,
  useEntitlement,
  useFlags,
  useTrack,
} from "@arcenpay/react";
import { useWallet } from "./useWallet";
import { useDemoArcenSession } from "./useDemoArcenSession";
import styles from "./page.module.css";

interface FlagInfo {
  flag: string;
  value: boolean;
  reason: string;
  allocation: number | null;
  usage: number;
  exceeded: boolean;
}

interface PlanInfo {
  id: string;
  name: string;
  tier: string;
  price: string;
  billingInterval: number;
}

interface CompanyData {
  plan: PlanInfo | null;
  availablePlans: PlanInfo[];
  flags: Record<string, FlagInfo | null>;
}

const FLAG_KEYS = ["scan", "api-access", "export-pdf", "ai_summery"] as const;

export default function DashboardPage() {
  const { address, isConnected, connecting } = useWallet();
  const {
    identified,
    loading: sessionLoading,
    error: sessionError,
  } = useDemoArcenSession(address, {
    companyName: "ArcenPay Demo Studio",
    userName: "Dashboard Operator",
  });
  const { planTier, isSubscribed } = useEntitlement(address ?? undefined);
  const flagMap = useFlags([...FLAG_KEYS]);
  const { track } = useTrack();
  const { consume, loading: consumeLoading } = useConsumeEntitlement();

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [trackMsg, setTrackMsg] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const walletShort = address
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : null;

  const loadCompany = useCallback(async () => {
    if (!address || !identified) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/company?wallet=${address}`, {
        cache: "no-store",
      });
      if (res.ok) {
        setCompany((await res.json()) as CompanyData);
      }
    } catch {
      // Ignore demo fetch failures and keep the page interactive.
    } finally {
      setLoading(false);
    }
  }, [address, identified]);

  useEffect(() => {
    if (!isConnected || !address) {
      setLoading(false);
      setCompany(null);
      return;
    }

    if (!identified) {
      setLoading(sessionLoading);
      return;
    }

    void loadCompany();
  }, [address, identified, isConnected, loadCompany, sessionLoading]);

  async function handleTrackScan() {
    if (!identified) return;
    setTracking(true);
    setTrackMsg(null);

    try {
      await track("scan", {
        source: "dashboard",
        surface: "usage-tracking-card",
      });
      setTrackMsg({
        text: "Tracked `scan` through useTrack()",
        error: false,
      });
    } catch (error) {
      setTrackMsg({
        text:
          error instanceof Error ? error.message : "Failed to track the event",
        error: true,
      });
    } finally {
      setTracking(false);
    }
  }

  async function handleConsume() {
    if (!identified) return;
    setTracking(true);
    setTrackMsg(null);

    try {
      const result = await consume("scan");
      setTrackMsg({
        text:
          result.allocation != null
            ? `Consumed via useConsumeEntitlement() ✓ ${result.usage} / ${result.allocation} used`
            : `Consumed via useConsumeEntitlement() ✓ ${result.usage} used`,
        error: false,
      });
      await loadCompany();
    } catch (error) {
      setTrackMsg({
        text:
          error instanceof Error
            ? error.message
            : "Failed to consume entitlement",
        error: true,
      });
    } finally {
      setTracking(false);
    }
  }

  if (connecting) return null;

  const scanUsage = company?.flags.scan;
  const actionBusy = tracking || consumeLoading;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          {walletShort && (
            <p className={styles.subtitle}>Connected: {walletShort}</p>
          )}
        </div>
        <button
          className={styles.btnSecondary}
          onClick={() => void loadCompany()}
          disabled={loading || !identified}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {sessionError && (
        <div className={styles.section}>
          <p className={styles.trackStatus} style={{ color: "#dc2626" }}>
            {sessionError}
          </p>
        </div>
      )}

      {loading ? (
        <div className={styles.statsGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.statCard}>
              <div
                style={{
                  height: 12,
                  width: 80,
                  background: "var(--surface-secondary,#e5e7eb)",
                  borderRadius: 4,
                  animation: "shimmer 1.5s infinite",
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  height: 28,
                  width: 48,
                  background: "var(--surface-secondary,#e5e7eb)",
                  borderRadius: 4,
                  animation: "shimmer 1.5s infinite",
                }}
              />
              <style>{`@keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Your Plan</h2>
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}
            >
              {isSubscribed ? (
                <div
                  style={{
                    flex: 1,
                    minWidth: 260,
                    padding: 20,
                    border: "1px solid var(--border, rgba(255,255,255,0.10))",
                    borderRadius: 12,
                    background: "var(--surface, rgba(255,255,255,0.04))",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted,#9ca3af)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 4,
                    }}
                  >
                    Current Plan
                  </div>
                  <div
                    style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}
                  >
                    {planTier}
                  </div>
                  <Link
                    href="/dashboard/billing"
                    className={styles.btnPrimary}
                    style={{ display: "inline-block" }}
                  >
                    Manage Plan →
                  </Link>
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    minWidth: 260,
                    padding: 20,
                    textAlign: "center",
                    border: "1px dashed var(--border, rgba(255,255,255,0.10))",
                    borderRadius: 12,
                    color: "var(--text-muted,#9ca3af)",
                    fontSize: 14,
                  }}
                >
                  No active plan found.
                  <br />
                  <Link
                    href="/dashboard/billing"
                    style={{ color: "var(--accent,#63c4eb)", fontWeight: 600 }}
                  >
                    Subscribe to a plan →
                  </Link>
                </div>
              )}

              {company?.availablePlans && company.availablePlans.length > 0 && (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted,#9ca3af)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 8,
                    }}
                  >
                    Available Plans
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {company.availablePlans.map((plan) => (
                      <div
                        key={plan.id}
                        style={{
                          padding: "10px 14px",
                          border:
                            plan.id === company.plan?.id
                              ? "1px solid var(--accent, #63c4eb)"
                              : "1px solid var(--border, rgba(255,255,255,0.08))",
                          borderRadius: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background:
                            plan.id === company.plan?.id
                              ? "rgba(99,196,235,0.08)"
                              : "transparent",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {plan.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted,#9ca3af)",
                            }}
                          >
                            {plan.tier}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {Number(plan.price) === 0 ? "Free" : `$${plan.price}`}
                          {Number(plan.price) > 0 && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 400,
                                color: "var(--text-muted,#9ca3af)",
                              }}
                            >
                              /mo
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Scan Access</div>
              <div
                className={`${styles.statValue} ${flagMap.scan ? styles.statGood : styles.statBad}`}
              >
                {flagMap.scan ? "Enabled" : "Disabled"}
              </div>
              {scanUsage?.allocation != null && (
                <div className={styles.statNote}>
                  {scanUsage.usage} / {scanUsage.allocation} used
                </div>
              )}
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>API Access</div>
              <div
                className={`${styles.statValue} ${flagMap["api-access"] ? styles.statGood : styles.statBad}`}
              >
                {flagMap["api-access"] ? "Enabled" : "Disabled"}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Export PDF</div>
              <div
                className={`${styles.statValue} ${flagMap["export-pdf"] ? styles.statGood : styles.statBad}`}
              >
                {flagMap["export-pdf"] ? "Enabled" : "Disabled"}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>AI Access</div>
              <div
                className={`${styles.statValue} ${flagMap["ai_summery"] ? styles.statGood : styles.statBad}`}
              >
                {flagMap["ai_summery"] ? "Enabled" : "Disabled"}
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Usage Tracking</h2>
            <p className={styles.sectionDesc}>
              This demo now uses the React SDK hooks directly:{" "}
              <code>useTrack()</code> for analytics and{" "}
              <code>useConsumeEntitlement()</code> for metered usage.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className={styles.btnPrimary}
                onClick={() => void handleTrackScan()}
                disabled={actionBusy || !identified}
              >
                {tracking ? "Sending…" : "Track a Scan"}
              </button>
              <button
                className={styles.btnSecondary}
                onClick={() => void handleConsume()}
                disabled={actionBusy || !identified}
              >
                {consumeLoading ? "Consuming…" : "Consume Entitlement"}
              </button>
            </div>
            {trackMsg && (
              <p
                className={styles.trackStatus}
                style={{ color: trackMsg.error ? "#dc2626" : "#16a34a" }}
              >
                {trackMsg.text}
              </p>
            )}
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Feature Gates</h2>
            <div className={styles.flagGrid}>
              {FLAG_KEYS.map((key) => {
                const snapshot = company?.flags[key] ?? null;
                const enabled = flagMap[key];

                return (
                  <div key={key} className={styles.flagCard}>
                    <div className={styles.flagName}>{key}</div>
                    <div
                      className={`${styles.flagBadge} ${enabled ? styles.flagEnabled : styles.flagDisabled}`}
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </div>
                    {snapshot?.reason && (
                      <div className={styles.flagReason}>{snapshot.reason}</div>
                    )}
                    {snapshot?.allocation != null && (
                      <div className={styles.flagUsage}>
                        Usage: {snapshot.usage} / {snapshot.allocation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
