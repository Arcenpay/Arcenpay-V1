"use client";

import { useEffect, useState } from "react";
import { ArcenEmbed, ArcenPayProvider, useArcenPay } from "@arcenpay/react";
import styles from "./page.module.css";

function BillingContent() {
  const arcen = useArcenPay();
  const [identified, setIdentified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        await arcen.identify({
          company: {
            id: "arcen-demo-company",
            wallet:
              process.env.NEXT_PUBLIC_DEMO_COMPANY_WALLET ??
              "0xB9EC29600a775eD515ae7B95BF9D0ac79e950388",
          },
        });
        if (!cancelled) setIdentified(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [arcen]);

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.embedContainer}>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, padding: 24 }}>
            <div style={{ flex: 1, height: 120, background: "#e5e7eb", borderRadius: 10, animation: "shimmer 1.5s infinite" }} />
            <div style={{ flex: 1, height: 120, background: "#e5e7eb", borderRadius: 10, animation: "shimmer 1.5s infinite" }} />
          </div>
          <div style={{ height: 80, background: "#e5e7eb", borderRadius: 10, margin: "0 24px 12px", animation: "shimmer 1.5s infinite" }} />
          <div style={{ height: 80, background: "#e5e7eb", borderRadius: 10, margin: "0 24px 12px", animation: "shimmer 1.5s infinite" }} />
          <div style={{ height: 60, background: "#e5e7eb", borderRadius: 10, margin: "0 24px", animation: "shimmer 1.5s infinite" }} />
          <style>{`@keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.embedLoading}>
          <h2 className={styles.embedTitle}>Billing Portal</h2>
          <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#b91c1c", fontSize: 13, marginTop: 16, maxWidth: 500, margin: "16px auto 0" }}>
            <strong>Error:</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  if (!identified) return null;

  return (
    <div className={styles.root}>
      <div className={styles.embedContainer}>
        <ArcenEmbed />
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <ArcenPayProvider componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? ""}>
      <BillingContent />
    </ArcenPayProvider>
  );
}
