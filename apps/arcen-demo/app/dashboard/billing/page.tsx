"use client";

import { useState, useEffect } from "react";
import { ArcenEmbed } from "@arcenpay/react";
import Link from "next/link";
import styles from "./page.module.css";

interface AccessTokenResponse {
  // Our /api/access-token returns { token: EmbedAccessTokenResponse }
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
    // Load config first
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: Config) => {
        setConfig(cfg);
        if (!cfg.hasApiKey) {
          setError(
            "ARCENPAY_API_KEY is not set. Add it to .env.local to enable billing features.",
          );
          setLoading(false);
          return;
        }
        // Then fetch access token
        return fetch("/api/access-token", { method: "POST" });
      })
      .then((res) => {
        if (!res) return;
        return res.json() as Promise<AccessTokenResponse>;
      })
      .then((data) => {
        if (!data) return;
        if (data.error) {
          setError(data.error);
        } else if (data.token) {
          setAccessToken(data.token.token);
        }
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
          <h1 className={styles.title}>Billing & Plan</h1>
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
            Rendered by{" "}
            <code className={styles.code}>&lt;ArcenEmbed /&gt;</code>
            {config?.componentId ? (
              <span className={styles.compId}>
                componentId: {config.componentId.slice(0, 16)}...
              </span>
            ) : (
              <span className={styles.compIdMissing}>
                Set NEXT_PUBLIC_ARCENPAY_COMPONENT_ID to load your custom component
              </span>
            )}
          </div>
        </div>

        <div className={styles.embedContainer}>
          {loading ? (
            <div className={styles.embedLoading}>
              <div className={styles.spinner} />
              <span>Loading billing portal...</span>
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
                <code>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code> in{" "}
                <code>.env.local</code>.
              </p>
              <div className={styles.placeholderLinks}>
                <a
                  href="http://localhost:3000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.btnPrimary}
                >
                  Open Dashboard
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
              <span>Waiting for access token...</span>
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className={styles.howSection}>
        <h2 className={styles.sectionTitle}>How ArcenEmbed works</h2>
        <div className={styles.steps}>
          <Step
            num="1"
            title="Build your component"
            desc='Go to Connections → Components in your dashboard. Design the billing portal with the elements you want (Plan Manager, Usage, Plans Table, etc.).'
          />
          <Step
            num="2"
            title="Generate an access token"
            desc="Your backend calls ArcenClient.createAccessToken() with the company's wallet/ID. This creates a short-lived token scoped to that company."
          />
          <Step
            num="3"
            title="Render <ArcenEmbed />"
            desc="Pass the access token + component ID to <ArcenEmbed />. It fetches the component config and company data, then renders the billing portal."
          />
        </div>

        <div className={styles.codeBlock}>
          <div className={styles.codeTitle}>
            Full integration (app/dashboard/billing/page.tsx)
          </div>
          <pre className={styles.codePre}>
            <code>{INTEGRATION_CODE}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

function Step({
  num,
  title,
  desc,
}: {
  num: string;
  title: string;
  desc: string;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.stepNum}>{num}</div>
      <div className={styles.stepContent}>
        <div className={styles.stepTitle}>{title}</div>
        <p className={styles.stepDesc}>{desc}</p>
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
