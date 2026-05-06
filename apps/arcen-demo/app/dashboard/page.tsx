"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "./useWallet";
import styles from "./page.module.css";

interface FlagInfo {
  flag: string;
  value: boolean;
  reason: string;
  allocation: number | null;
  usage: number;
  exceeded: boolean;
}

interface CompanyData {
  companyKeys: { wallet: string; id?: string };
  flags: Record<string, FlagInfo | null>;
}

export default function DashboardPage() {
  const { address, isConnected, connecting } = useWallet();
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);

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

  async function handleScan() {
    if (!address) return;
    setTracking(true);
    setTrackMsg(null);
    try {
      await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "scan", wallet: address }),
      });
      setTrackMsg("Scan tracked ✓");
      await loadCompany();
    } catch {
      setTrackMsg("Failed to track scan");
    } finally {
      setTracking(false);
    }
  }

  async function handleConsume() {
    if (!address) return;
    setTracking(true);
    setTrackMsg(null);
    try {
      await fetch("/api/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureKey: "scan", wallet: address }),
      });
      setTrackMsg("Entitlement consumed ✓");
      await loadCompany();
    } catch {
      setTrackMsg("Failed to consume");
    } finally {
      setTracking(false);
    }
  }

  if (connecting) return null;

  return (
    <div className={styles.root}>
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
          {/* Stats */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Scan Access</div>
              <div className={`${styles.statValue} ${company?.flags?.scan?.value ? styles.statGood : styles.statBad}`}>
                {company?.flags?.scan?.value ? "Enabled" : "Disabled"}
              </div>
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
              Each scan uses one metered entitlement from your plan. Test tracking and consuming below.
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
              <p style={{ marginTop: 10, fontSize: 13, color: trackMsg.includes("✓") ? "#16a34a" : "#dc2626" }}>
                {trackMsg}
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
