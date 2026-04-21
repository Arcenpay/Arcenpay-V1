"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

interface Config {
  componentId: string;
  baseUrl: string;
  demoCompanyWallet: string;
  hasApiKey: boolean;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [copied, setCopied] = useState(false);
  const dashboardUrl = config?.baseUrl ?? "http://localhost:3000";

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {});
  }, []);

  // Derive webhook URL from current environment
  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhook`
      : "http://localhost:3001/api/webhook";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Configure your ArcenPay integration credentials.</p>
      </div>

      {/* ── Webhook URL ─────────────────────────────────────────────── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Webhook Endpoint</h2>
        <div className={styles.webhookBox}>
          <div className={styles.webhookLabel}>POST endpoint</div>
          <p className={styles.webhookDesc}>
            Add this URL to your ArcenPay dashboard under{" "}
            <strong>Settings → Webhooks</strong> to receive real-time payment and
            usage events.
          </p>
          <div className={styles.webhookUrlRow}>
            <div className={styles.webhookUrl}>{webhookUrl}</div>
            <button
              onClick={handleCopy}
              className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ""}`}
            >
              {copied ? "✓ Copied!" : "Copy URL"}
            </button>
          </div>
          <p className={styles.webhookNote}>
            Optionally set <code>ARCENPAY_WEBHOOK_SECRET</code> in{" "}
            <code>.env.local</code> to enable HMAC-SHA256 signature verification.
          </p>
        </div>
      </div>

      {/* ── Connection Status ────────────────────────────────────────── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Connection Status</h2>
        <div className={styles.statusGrid}>
          <StatusItem
            label="API Key"
            status={config?.hasApiKey ? "connected" : "missing"}
            value={config?.hasApiKey ? "Configured (hidden)" : "Not set"}
            envVar="ARCENPAY_API_KEY"
          />
          <StatusItem
            label="Dashboard URL"
            status={config?.baseUrl ? "connected" : "missing"}
            value={config?.baseUrl ?? "Not set"}
            envVar="ARCENPAY_BASE_URL"
          />
          <StatusItem
            label="Component ID"
            status={config?.componentId ? "connected" : "warning"}
            value={config?.componentId || "Not set — billing embed won't load"}
            envVar="NEXT_PUBLIC_ARCENPAY_COMPONENT_ID"
          />
          <StatusItem
            label="Demo Company Wallet"
            status="connected"
            value={config?.demoCompanyWallet ?? "—"}
            envVar="DEMO_COMPANY_WALLET"
          />
        </div>
      </div>

      {/* ── Setup Instructions ───────────────────────────────────────── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Setup Instructions</h2>
        <div className={styles.instructions}>
          <div className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Copy the env file</div>
              <div className={styles.codeInline}>
                cp apps/arcen-demo/.env.local.example apps/arcen-demo/.env.local
              </div>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Get your API key</div>
              <p className={styles.stepDesc}>
                Open your{" "}
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  ArcenPay dashboard
                </a>{" "}
                → Agent → API Keys → Create a new key. It starts with <code>api_</code>.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Add webhook URL (optional)</div>
              <p className={styles.stepDesc}>
                Copy the webhook URL above and paste it into{" "}
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  Settings → Webhooks
                </a>{" "}
                in your dashboard.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Create a component (optional)</div>
              <p className={styles.stepDesc}>
                Go to{" "}
                <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  Connections → Components
                </a>{" "}
                in the dashboard. Create a new component and copy its ID into{" "}
                <code>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code>.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>5</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Restart the dev server</div>
              <div className={styles.codeInline}>npm --workspace apps/arcen-demo run dev</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Environment Reference ────────────────────────────────────── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Environment Variables</h2>
        <div className={styles.envTable}>
          <div className={styles.envRow}>
            <code className={styles.envKey}>ARCENPAY_API_KEY</code>
            <span className={styles.envRequired}>Required</span>
            <span className={styles.envDesc}>Your ArcenPay API key (starts with <code>api_</code>)</span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>ARCENPAY_BASE_URL</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>Dashboard URL. Default: <code>https://dashboard.arcenpay.xyz</code></span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>ARCENPAY_WEBHOOK_SECRET</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>HMAC-SHA256 secret for verifying webhook signatures</span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>Component ID for <code>&lt;ArcenEmbed /&gt;</code> on the billing page</span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>DEMO_COMPANY_WALLET</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>Wallet address used as the demo company identity</span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>DEMO_COMPANY_ID</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>Alternative: use a company ID instead of wallet</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusItem({
  label, status, value, envVar,
}: {
  label: string;
  status: "connected" | "missing" | "warning";
  value: string;
  envVar: string;
}) {
  return (
    <div className={styles.statusItem}>
      <div className={styles.statusHeader}>
        <div className={styles.statusLabel}>{label}</div>
        <div
          className={`${styles.statusBadge} ${
            status === "connected"
              ? styles.statusConnected
              : status === "warning"
                ? styles.statusWarning
                : styles.statusMissing
          }`}
        >
          {status === "connected" ? "✓ Connected" : status === "warning" ? "⚠ Not set" : "✗ Missing"}
        </div>
      </div>
      <div className={styles.statusValue}>{value}</div>
      <code className={styles.statusEnvVar}>{envVar}</code>
    </div>
  );
}
