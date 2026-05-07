"use client";

import { useEffect, useState } from "react";
import { ArcenEmbed, useArcenPay } from "@arcenpay/react";
import { useWallet } from "../useWallet";
import styles from "./page.module.css";

function Skeleton() {
  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <SkeletonBox h={140} flex={1} />
        <SkeletonBox h={140} flex={1} />
      </div>
      <SkeletonBox h={80} />
      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        <SkeletonBox h={100} flex={1} />
        <SkeletonBox h={100} flex={2} />
      </div>
      <SkeletonBox h={60} />
      <SkeletonBox h={60} />
      <style>{`@keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </div>
  );
}

function SkeletonBox({ h, flex }: { h: number; flex?: number }) {
  return (
    <div
      style={{
        flex,
        height: h,
        background: "var(--surface-secondary, #e5e7eb)",
        borderRadius: 10,
        animation: "shimmer 1.5s ease-in-out infinite",
        marginBottom: 16,
      }}
    />
  );
}

function BillingContent() {
  const { identify, session } = useArcenPay();
  const { address, connecting } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const identified =
    !!address &&
    !!session.token &&
    session.company?.wallet?.toLowerCase() === address.toLowerCase();

  useEffect(() => {
    if (connecting) return;
    if (!address) {
      setLoading(false);
      setError(null);
      return;
    }
    if (identified) {
      setLoading(false);
      setError(null);
      return;
    }
    const wallet = address; // narrow type
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        await identify({
          company: { id: `company-${wallet.slice(2, 10)}`, wallet },
        });
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [address, connecting, identified, identify]);

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.embedLoading}>
          <h2 className={styles.embedTitle}>Billing Portal</h2>
          <div
            style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 13,
              maxWidth: 500,
              margin: "16px auto 0",
            }}
          >
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
        <ArcenEmbed className={styles.embed} mode="modal" />
      </div>

    </div>
  );
}

export default function BillingPage() {
  return <BillingContent />;
}
