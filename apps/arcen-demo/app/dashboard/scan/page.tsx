"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConsumeEntitlement, useFlags, useTrack } from "@arcenpay/react";
import { useWallet } from "../useWallet";
import { useDemoArcenSession } from "../useDemoArcenSession";
import styles from "./page.module.css";

const MOCK_RESULT = `Invoice #INV-2024-0032
Date:     March 15, 2024
Amount:   $2,450.00
Vendor:   Acme Corp
Status:   Due`;

interface CompanyData {
  flags: {
    scan: {
      value: boolean;
      reason: string;
      allocation: number | null;
      usage: number;
      exceeded: boolean;
    } | null;
  };
}

export default function ScanPage() {
  const { address } = useWallet();
  const { identified, loading: sessionLoading } = useDemoArcenSession(address, {
    companyName: "ArcenPay Demo Studio",
    userName: "Scan Operator",
  });
  const { consume, loading: consumeLoading } = useConsumeEntitlement();
  const { track } = useTrack();
  const flagMap = useFlags(identified ? ["scan"] : []);

  const [step, setStep] = useState<"idle" | "scanning" | "done">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyData | null>(null);

  const loadCompany = useCallback(async () => {
    if (!address || !identified) return;

    try {
      const response = await fetch(`/api/company?wallet=${address}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as CompanyData;
      setCompany(data);
    } catch {
      // Ignore demo fetch failures and keep the scan experience usable.
    }
  }, [address, identified]);

  useEffect(() => {
    if (!identified) return;
    void loadCompany();
  }, [identified, loadCompany]);

  async function handleScan() {
    if (!identified) {
      setTrackMsg("Waiting for ArcenPay session setup. Try again in a moment.");
      return;
    }

    if (flagMap.scan === false) {
      setTrackMsg(company?.flags.scan?.reason ?? "Scan limit reached");
      return;
    }

    setStep("scanning");
    setResult(null);
    setTrackMsg(null);

    try {
      const consumeResult = await consume("scan");

      await track("document_scanned", {
        source: "scan-page",
        format: "pdf",
        meteredFeature: "scan",
      });

      await new Promise((resolve) => setTimeout(resolve, 1600));

      setResult(MOCK_RESULT);
      setStep("done");
      setTrackMsg(
        consumeResult.allocation != null
          ? `Consumed via useConsumeEntitlement() and recorded analytics via useTrack() · ${consumeResult.usage} / ${consumeResult.allocation} used`
          : `Consumed via useConsumeEntitlement() and recorded analytics via useTrack() · ${consumeResult.usage} used`,
      );
      await loadCompany();
      setTimeout(() => setTrackMsg(null), 4500);
    } catch (error) {
      setStep("idle");
      setTrackMsg(
        error instanceof Error
          ? error.message
          : "Could not consume scan entitlement",
      );
      setTimeout(() => setTrackMsg(null), 4500);
      await loadCompany();
    }
  }

  function handleReset() {
    setStep("idle");
    setResult(null);
  }

  const scanUsage = company?.flags.scan ?? null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>New Scan</h1>
        <p className={styles.subtitle}>
          Upload a document to extract data using AI.
        </p>
      </div>

      <div className={styles.scanArea}>
        {step === "idle" && (
          <div className={styles.dropzone}>
            <div className={styles.dropBorder}>
              <div className={styles.dropIcon}>◈</div>
            </div>
            <div className={styles.dropTitle}>Drop your document here</div>
            <p className={styles.dropDesc}>
              Supports PDF, PNG, JPG, TIFF · up to 50 MB
            </p>
            <div className={styles.dropOr}>or</div>
            <button
              onClick={() => void handleScan()}
              className={styles.btnPrimary}
              disabled={
                !identified || sessionLoading || consumeLoading || !flagMap.scan
              }
            >
              {sessionLoading
                ? "Preparing session…"
                : consumeLoading
                  ? "Consuming…"
                  : "Simulate Scan"}
            </button>
            <p className={styles.dropNote}>
              Demo mode: simulates a scan and uses ArcenPay React SDK hooks
              directly
            </p>
            {scanUsage?.allocation != null && (
              <p className={styles.dropNote}>
                Current usage: {scanUsage.usage} / {scanUsage.allocation}
              </p>
            )}
            {trackMsg && <p className={styles.dropNote}>{trackMsg}</p>}
          </div>
        )}

        {step === "scanning" && (
          <div className={styles.scanning}>
            <div className={styles.scanSpinner} />
            <div className={styles.scanningText}>Scanning document…</div>
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
          This demo page now calls <code>useConsumeEntitlement()</code> to
          enforce scan quota and <code>useTrack()</code> to record a separate
          analytics event. The browser no longer proxies those actions through
          custom demo API routes.
        </p>
      </div>
    </div>
  );
}
