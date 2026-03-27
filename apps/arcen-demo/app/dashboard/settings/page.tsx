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

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Config) => setConfig(data))
      .catch(() => {});
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Configure your ArcenPay integration credentials.
        </p>
      </div>

      {/* Connection status */}
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

      {/* Setup instructions */}
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
                  href="http://localhost:3000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  ArcenPay dashboard
                </a>{" "}
                → Agent → API Keys tab → Create a new key. It starts with{" "}
                <code>api_</code>.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>
                Create a component (optional)
              </div>
              <p className={styles.stepDesc}>
                Go to{" "}
                <a
                  href="http://localhost:3000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  Connections → Components
                </a>{" "}
                in the dashboard. Create a new component and copy its ID into{" "}
                <code>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code>.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Restart the dev server</div>
              <div className={styles.codeInline}>
                pnpm --filter arcen-demo dev
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Environment reference */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Environment Variables Reference</h2>
        <div className={styles.envTable}>
          <div className={styles.envRow}>
            <code className={styles.envKey}>ARCENPAY_API_KEY</code>
            <span className={styles.envRequired}>Required</span>
            <span className={styles.envDesc}>
              Your ArcenPay API key (starts with <code>api_</code>)
            </span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>ARCENPAY_BASE_URL</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>
              Dashboard URL. Default: <code>https://dashboard.arcenpay.xyz</code>
            </span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>
              Component ID for <code>&lt;ArcenEmbed /&gt;</code> on billing page
            </span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>DEMO_COMPANY_WALLET</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>
              Wallet address to use as the demo company identity
            </span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>DEMO_COMPANY_ID</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>
              Alternative: use a company ID instead of wallet
            </span>
          </div>
          <div className={styles.envRow}>
            <code className={styles.envKey}>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code>
            <span className={styles.envOptional}>Optional</span>
            <span className={styles.envDesc}>
              WalletConnect project ID for wallet connections
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusItem({
  label,
  status,
  value,
  envVar,
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
          {status === "connected" ? "✓" : status === "warning" ? "⚠" : "✗"}
          {status === "connected"
            ? " Connected"
            : status === "warning"
              ? " Not set"
              : " Missing"}
        </div>
      </div>
      <div className={styles.statusValue}>{value}</div>
      <code className={styles.statusEnvVar}>{envVar}</code>
    </div>
  );
}
