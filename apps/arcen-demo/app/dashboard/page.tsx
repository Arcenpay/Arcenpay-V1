"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "./useWallet";
import styles from "./page.module.css";

interface FlagInfo {
  flag: string; value: boolean; reason: string;
  allocation: number | null; usage: number; exceeded: boolean;
}

interface PlanInfo {
  id: string; name: string; tier: string; price: string; billingInterval: number;
}

interface CompanyData {
  plan: PlanInfo | null;
  availablePlans: PlanInfo[];
  flags: Record<string, FlagInfo | null>;
}

export default function DashboardPage() {
  const { address, isConnected, connecting } = useWallet();
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [trackMsg, setTrackMsg] = useState<{ text: string; error: boolean } | null>(null);

  const walletShort = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : null;

  const loadCompany = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/company?wallet=${address}`, { cache: "no-store" });
      if (res.ok) setCompany(await res.json());
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [address]);

  useEffect(() => {
    if (isConnected) loadCompany();
    else setLoading(false);
  }, [isConnected, loadCompany]);

  async function callApi(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, error: data.error as string | undefined, data };
  }

  async function handleScan() {
    if (!address) return;
    setTracking(true); setTrackMsg(null);
    const { ok, error } = await callApi("/api/track", { name: "scan", wallet: address });
    setTrackMsg({ text: ok ? "Scan tracked ✓" : error ?? "Failed", error: !ok });
    if (ok) await loadCompany();
    setTracking(false);
  }

  async function handleConsume() {
    if (!address) return;
    setTracking(true); setTrackMsg(null);
    const { ok, error } = await callApi("/api/consume", { featureKey: "scan", wallet: address });
    setTrackMsg({ text: ok ? "Consumed ✓" : error ?? "Failed", error: !ok });
    if (ok) await loadCompany();
    setTracking(false);
  }

  if (connecting) return null;

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          {walletShort && <p className={styles.subtitle}>Connected: {walletShort}</p>}
        </div>
        <button className={styles.btnSecondary} onClick={loadCompany} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div className={styles.statsGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.statCard}>
              <div style={{ height: 12, width: 80, background: "var(--surface-secondary,#e5e7eb)", borderRadius: 4, animation: "shimmer 1.5s infinite", marginBottom: 8 }} />
              <div style={{ height: 28, width: 48, background: "var(--surface-secondary,#e5e7eb)", borderRadius: 4, animation: "shimmer 1.5s infinite" }} />
              <style>{`@keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Current Plan Card */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Your Plan</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              {company?.plan ? (
                <div style={{
                  flex: 1, minWidth: 260, padding: 20,
                  border: "1px solid var(--border, rgba(255,255,255,0.10))",
                  borderRadius: 12, background: "var(--surface, rgba(255,255,255,0.04))",
                }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted,#9ca3af)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                    Current Plan
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
                    {company.plan.name}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-muted,#9ca3af)", marginBottom: 12 }}>
                    {Number(company.plan.price) === 0 ? "Free" : `$${company.plan.price}/mo`}
                    <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "rgba(99,196,235,0.15)", color: "var(--accent,#63c4eb)" }}>
                      {company.plan.tier}
                    </span>
                  </div>
                  <Link href="/dashboard/billing" className={styles.btnPrimary} style={{ display: "inline-block" }}>
                    Manage Plan →
                  </Link>
                </div>
              ) : (
                <div style={{
                  flex: 1, minWidth: 260, padding: 20, textAlign: "center",
                  border: "1px dashed var(--border, rgba(255,255,255,0.10))",
                  borderRadius: 12,
                  color: "var(--text-muted,#9ca3af)", fontSize: 14,
                }}>
                  No active plan found.
                  <br />
                  <Link href="/dashboard/billing" style={{ color: "var(--accent,#63c4eb)", fontWeight: 600 }}>
                    Subscribe to a plan →
                  </Link>
                </div>
              )}

              {/* Available Plans */}
              {company?.availablePlans && company.availablePlans.length > 0 && (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted,#9ca3af)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Available Plans
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {company.availablePlans.map((p) => (
                      <div key={p.id} style={{
                        padding: "10px 14px",
                        border: p.id === company.plan?.id
                          ? "1px solid var(--accent, #63c4eb)"
                          : "1px solid var(--border, rgba(255,255,255,0.08))",
                        borderRadius: 8,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        background: p.id === company.plan?.id
                          ? "rgba(99,196,235,0.08)"
                          : "transparent",
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted,#9ca3af)" }}>
                            {p.tier}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {Number(p.price) === 0 ? "Free" : `$${p.price}`}
                          {Number(p.price) > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted,#9ca3af)" }}>/mo</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Scan Access</div>
              <div className={`${styles.statValue} ${company?.flags?.scan?.value ? styles.statGood : styles.statBad}`}>
                {company?.flags?.scan?.value ? "Enabled" : "Disabled"}
              </div>
              {company?.flags?.scan?.allocation != null && (
                <div className={styles.statNote}>
                  {company.flags.scan!.usage} / {company.flags.scan!.allocation} used
                </div>
              )}
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>API Access</div>
              <div className={`${styles.statValue} ${company?.flags?.["api-access"]?.value ? styles.statGood : styles.statBad}`}>
                {company?.flags?.["api-access"]?.value ? "Enabled" : "Disabled"}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Export PDF</div>
              <div className={`${styles.statValue} ${company?.flags?.["export-pdf"]?.value ? styles.statGood : styles.statBad}`}>
                {company?.flags?.["export-pdf"]?.value ? "Enabled" : "Disabled"}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Usage Tracking</h2>
            <p className={styles.sectionDesc}>
              Each scan uses one metered entitlement. Test tracking and consuming below.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className={styles.btnPrimary} onClick={handleScan} disabled={tracking}>
                {tracking ? "Sending…" : "Track a Scan"}
              </button>
              <button className={styles.btnSecondary} onClick={handleConsume} disabled={tracking}>
                {tracking ? "Sending…" : "Consume Entitlement"}
              </button>
            </div>
            {trackMsg && (
              <p className={styles.trackStatus} style={{ color: trackMsg.error ? "#dc2626" : "#16a34a" }}>
                {trackMsg.text}
              </p>
            )}
          </div>

          {/* Feature Gates */}
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Feature Gates</h2>
            <div className={styles.flagGrid}>
              {Object.entries(company?.flags ?? {}).map(([key, flag]) => (
                <div key={key} className={styles.flagCard}>
                  <div className={styles.flagName}>{key}</div>
                  <div className={`${styles.flagBadge} ${flag?.value ? styles.flagEnabled : styles.flagDisabled}`}>
                    {flag?.value ? "Enabled" : "Disabled"}
                  </div>
                  {flag?.reason && <div className={styles.flagReason}>{flag.reason}</div>}
                  {flag?.allocation != null && (
                    <div className={styles.flagUsage}>Usage: {flag.usage ?? 0} / {flag.allocation}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
