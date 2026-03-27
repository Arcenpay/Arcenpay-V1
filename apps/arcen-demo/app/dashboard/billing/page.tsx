"use client";

import { useState, useEffect } from "react";
import { ArcenEmbed } from "@arcenpay/react";
import Link from "next/link";
import styles from "./page.module.css";

interface AccessTokenResponse {
  token?: { token: string; expiresAt: string };
  error?: string;
}

interface Config {
  componentId: string;
  baseUrl: string;
  demoCompanyWallet: string;
  hasApiKey: boolean;
}

export default function BillingPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: Config) => {
        setConfig(cfg);
        if (!cfg.hasApiKey) {
          setError("ARCENPAY_API_KEY is not set. Add it to .env.local to enable billing features.");
          setLoading(false);
          return;
        }
        return fetch("/api/access-token", { method: "POST" });
      })
      .then((res) => {
        if (!res) return;
        return res.json() as Promise<AccessTokenResponse>;
      })
      .then((data) => {
        if (!data) return;
        if (data.error) setError(data.error);
        else if (data.token) setAccessToken(data.token.token);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load billing data");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Billing &amp; Plan</h1>
          <p className={styles.subtitle}>
            Manage your subscription, usage, and payment settings.
          </p>
        </div>
      </div>

      {/* ArcenEmbed — Custom Component */}
      <div className={styles.embedSection}>
        <div className={styles.embedHeader}>
          <h2 className={styles.embedTitle}>Your Plan</h2>
          <div className={styles.embedMeta}>
            <code className={styles.code}>&lt;ArcenEmbed /&gt;</code>
            {config?.componentId ? (
              <span className={styles.compId}>
                id: {config.componentId.slice(0, 14)}…
              </span>
            ) : (
              <span className={styles.compIdMissing}>component ID not set</span>
            )}
          </div>
        </div>

        <div className={styles.embedContainer}>
          {loading ? (
            <div className={styles.embedLoading}>
              <div className={styles.spinner} />
              <span>Loading billing portal…</span>
            </div>
          ) : error ? (
            <div className={styles.embedError}>
              <div className={styles.errorIcon}>⚠</div>
              <div className={styles.errorTitle}>Configuration needed</div>
              <p className={styles.errorDesc}>{error}</p>
              <Link href="/dashboard/settings" className={styles.btnPrimary}>
                Configure Settings
              </Link>
            </div>
          ) : !config?.componentId ? (
            <div className={styles.embedPlaceholder}>
              <div className={styles.placeholderIcon}>◆</div>
              <div className={styles.placeholderTitle}>No component configured</div>
              <p className={styles.placeholderDesc}>
                Create a component in your ArcenPay dashboard under{" "}
                <strong>Connections → Components</strong>, then set its ID as{" "}
                <code>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code> in <code>.env.local</code>.
              </p>
              <div className={styles.placeholderLinks}>
                <a
                  href="http://localhost:3000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.btnPrimary}
                >
                  Open Dashboard →
                </a>
                <Link href="/dashboard/settings" className={styles.btnSecondary}>
                  Set Component ID
                </Link>
              </div>
            </div>
          ) : accessToken ? (
            <ArcenEmbed
              accessToken={accessToken}
              componentId={config.componentId}
              baseUrl={config.baseUrl}
              className={styles.embed}
              onPlanChange={(planId) => {
                console.log("Plan changed to:", planId);
              }}
            />
          ) : (
            <div className={styles.embedLoading}>
              <span>Waiting for access token…</span>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className={styles.howSection}>
        <h2 className={styles.sectionTitle}>How ArcenEmbed works</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Build your component</div>
              <p className={styles.stepDesc}>
                Go to Connections → Components in your dashboard. Design the billing portal with plan
                manager, usage meters, plan tables, and more.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Generate an access token</div>
              <p className={styles.stepDesc}>
                Your backend calls <code>ArcenClient.createAccessToken()</code> with the company
                wallet/ID. This creates a short-lived, scoped token.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Render &lt;ArcenEmbed /&gt;</div>
              <p className={styles.stepDesc}>
                Pass the access token + component ID to <code>&lt;ArcenEmbed /&gt;</code>. It fetches
                the component config and company data, then renders the billing portal inline.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.codeBlock}>
          <div className={styles.codeTitle}>Full integration — app/dashboard/billing/page.tsx</div>
          <pre className={styles.codePre}>
            <code>{INTEGRATION_CODE}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

const INTEGRATION_CODE = `// 1. Backend: generate access token (API route)
const client = new ArcenClient({ apiKey: process.env.ARCENPAY_API_KEY });
const token = await client.createAccessToken({ wallet: "0x..." });

// 2. Frontend: fetch the token, render the embed
const { token } = await fetch("/api/access-token", { method: "POST" })
  .then(r => r.json());

<ArcenEmbed
  accessToken={token.token}
  componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
  baseUrl={process.env.ARCENPAY_BASE_URL}
  onPlanChange={(planId) => console.log("Plan changed:", planId)}
/>`;
