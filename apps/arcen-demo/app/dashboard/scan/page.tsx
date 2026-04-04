"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

const MOCK_RESULT = `Invoice #INV-2024-0032
Date:     March 15, 2024
Amount:   $2,450.00
Vendor:   Acme Corp
Status:   Due`;

interface CompanyData {
  usage: {
    scan: {
      allocation: number | null;
      usage: number;
      exceeded: boolean;
    } | null;
  };
  flags: {
    scan:
      | {
          value: boolean;
          reason: string;
        }
      | null;
  };
}

export default function ScanPage() {
  const [step, setStep] = useState<"idle" | "scanning" | "done">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyData | null>(null);

  async function loadCompany() {
    try {
      const response = await fetch("/api/company", { cache: "no-store" });
      const data = (await response.json()) as CompanyData;
      setCompany(data);
    } catch {
      // ignore demo fetch failures
    }
  }

  useEffect(() => {
    void loadCompany();
  }, []);

  async function handleScan() {
    if (company?.flags.scan?.value === false) {
      setTrackMsg(company.flags.scan.reason ?? "Scan limit reached");
      return;
    }

    setStep("scanning");
    setResult(null);

    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `scan-${Date.now()}`;

      const res = await fetch("/api/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey: "scan",
          traits: { source: "scan-page", format: "pdf" },
          idempotencyKey,
        }),
      });
      const consumeResult = (await res.json()) as {
        consumed?: boolean;
        reason?: string;
        error?: string;
      };

      if (!res.ok || !consumeResult.consumed) {
        setStep("idle");
        setTrackMsg(
          consumeResult.error ??
            consumeResult.reason ??
            "Could not consume scan entitlement",
        );
        setTimeout(() => setTrackMsg(null), 4500);
        await loadCompany();
        return;
      }
    } catch {
      setStep("idle");
      setTrackMsg("Could not track event");
      setTimeout(() => setTrackMsg(null), 4500);
      return;
    }

    await new Promise((r) => setTimeout(r, 1600));

    setResult(MOCK_RESULT);
    setStep("done");
    setTrackMsg("Usage consumed via ArcenClient.consumeEntitlement()");
    await loadCompany();
    setTimeout(() => setTrackMsg(null), 4500);
  }

  function handleReset() {
    setStep("idle");
    setResult(null);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Scan</h1>
        <p className={styles.subtitle}>Upload a document to extract data using AI.</p>
      </div>

      <div className={styles.scanArea}>
        {step === "idle" && (
          <div className={styles.dropzone}>
            <div className={styles.dropBorder}>
              <div className={styles.dropIcon}>◈</div>
            </div>
            <div className={styles.dropTitle}>Drop your document here</div>
            <p className={styles.dropDesc}>Supports PDF, PNG, JPG, TIFF · up to 50 MB</p>
            <div className={styles.dropOr}>or</div>
            <button
              onClick={handleScan}
              className={styles.btnPrimary}
              disabled={company?.flags.scan?.value === false}
            >
              Simulate Scan
            </button>
            <p className={styles.dropNote}>
              Demo mode: simulates a scan and consumes usage via ArcenPay
            </p>
            {trackMsg && <p className={styles.dropNote}>{trackMsg}</p>}
          </div>
        )}

        {step === "scanning" && (
          <div className={styles.scanning}>
            <div className={styles.scanSpinner} />
            <div className={styles.scanningText}>Scanning document…</div>
            <div className={styles.scanningSubtext}>AI extraction in progress</div>
          </div>
        )}

        {step === "done" && result && (
          <div className={styles.result}>
            <div className={styles.resultHeader}>
              <div className={styles.resultTitle}>
                <span className={styles.resultIcon}>✓</span>
                Scan complete
              </div>
              {trackMsg && (
                <div className={styles.trackBadge}>✓ {trackMsg}</div>
              )}
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultCardHeader}>Extracted Data</div>
              <pre className={styles.resultText}>{result}</pre>
            </div>
            <div className={styles.resultActions}>
              <button className={styles.btnPrimary} onClick={handleReset}>
                Scan another
              </button>
              <Link href="/dashboard/billing" className={styles.btnSecondary}>
                View plan limits
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className={styles.infoBox}>
        <div className={styles.infoTitle}>How usage tracking works</div>
        <p className={styles.infoDesc}>
          Every scan calls <code>/api/consume</code> on your backend, which calls{" "}
          <code>ArcenClient.consumeEntitlement({"scan"})</code>. ArcenPay denies the
          request when the plan limit is exhausted, so the scan never runs past
          the server-side quota.
        </p>
      </div>
    </div>
  );
}
