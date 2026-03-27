"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function ScanPage() {
  const [step, setStep] = useState<"idle" | "scanning" | "done">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);

  async function handleScan() {
    setStep("scanning");
    setResult(null);

    // Simulate scan processing
    await new Promise((r) => setTimeout(r, 1500));

    // Track the usage event
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "scan",
          traits: { source: "scan-page", format: "pdf" },
        }),
      });
      if (res.ok) {
        setTrackMsg("✓ Usage tracked via ArcenClient.track()");
      }
    } catch {
      setTrackMsg("Could not track event");
    }

    setResult(
      "Invoice #INV-2024-0032\nDate: March 15, 2024\nAmount: $2,450.00\nVendor: Acme Corp\nStatus: Due",
    );
    setStep("done");

    setTimeout(() => setTrackMsg(null), 4000);
  }

  function handleReset() {
    setStep("idle");
    setResult(null);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>New Scan</h1>
          <p className={styles.subtitle}>
            Upload a document to extract text using AI.
          </p>
        </div>
      </div>

      <div className={styles.scanArea}>
        {step === "idle" && (
          <div className={styles.dropzone}>
            <div className={styles.dropIcon}>◈</div>
            <div className={styles.dropTitle}>Drop your document here</div>
            <p className={styles.dropDesc}>
              Supports PDF, PNG, JPG, TIFF — up to 50MB
            </p>
            <div className={styles.dropOr}>or</div>
            <button onClick={handleScan} className={styles.btnPrimary}>
              Simulate Scan
            </button>
            <p className={styles.dropNote}>
              (Demo mode: simulates a scan and tracks usage in ArcenPay)
            </p>
          </div>
        )}

        {step === "scanning" && (
          <div className={styles.scanning}>
            <div className={styles.spinner} />
            <div className={styles.scanningText}>Scanning document...</div>
            <div className={styles.scanningSubtext}>
              AI extraction in progress
            </div>
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
                <div className={styles.trackBadge}>{trackMsg}</div>
              )}
            </div>
            <pre className={styles.resultText}>{result}</pre>
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
          Every scan calls <code>/api/track</code> on your backend, which calls{" "}
          <code>ArcenClient.track(&#123; name: &quot;scan&quot; &#125;)</code>. ArcenPay
          increments the usage counter and evaluates your plan&apos;s limits. When
          you hit your limit, the <code>scan</code> feature flag automatically
          returns <code>false</code>.
        </p>
      </div>
    </div>
  );
}
