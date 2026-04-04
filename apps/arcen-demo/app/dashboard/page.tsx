"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface FlagResult {
  flag: string;
  value: boolean;
  reason: string;
}

interface CompanyData {
  companyKeys: { wallet: string; id?: string };
  usage: {
    scan: {
      allocation: number | null;
      usage: number;
      exceeded: boolean;
    } | null;
  };
  flags: {
    scan: (FlagResult & { allocation?: number | null; usage?: number; exceeded?: boolean }) | null;
    "export-pdf": (FlagResult & { allocation?: number | null; usage?: number; exceeded?: boolean }) | null;
    "api-access": (FlagResult & { allocation?: number | null; usage?: number; exceeded?: boolean }) | null;
  };
}

export default function DashboardPage() {
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionScanCount, setSessionScanCount] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [trackStatus, setTrackStatus] = useState<string | null>(null);

  async function loadCompany() {
    setLoading(true);
    try {
      const response = await fetch("/api/company", { cache: "no-store" });
      const data = (await response.json()) as CompanyData;
      setCompany(data);
    } catch {
      // ignore demo fetch failures
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompany();
  }, []);

  async function handleScan() {
    if (company?.flags.scan?.value === false) {
      setTrackStatus("Scan limit reached. Upgrade or wait for the next usage window.");
      return;
    }

    setTracking(true);
    setTrackStatus(null);
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
          traits: { source: "demo" },
          idempotencyKey,
        }),
      });
      const result = (await res.json()) as {
        consumed?: boolean;
        reason?: string;
        error?: string;
      };
      if (res.ok) {
        if (result.consumed) {
          setSessionScanCount((c) => c + 1);
          setTrackStatus("Scan consumed and synced to usage");
        } else {
          setTrackStatus(result.reason ?? "Scan denied");
        }
        await loadCompany();
      } else {
        setTrackStatus(result.error ?? "Error: Could not consume scan");
      }
    } catch {
      setTrackStatus("Error: Network request failed");
    } finally {
      setTracking(false);
      setTimeout(() => setTrackStatus(null), 3500);
    }
  }

  const wallet = company?.companyKeys?.wallet;
  const walletShort = wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-6)}` : "—";
  const scanUsage = company?.usage.scan;

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Overview</h1>
          <p className={styles.subtitle}>Welcome back. Here&apos;s your ScanBot dashboard.</p>
        </div>
        <Link href="/dashboard/billing" className={styles.btnPrimary}>
          Manage Plan
        </Link>
      </div>

      {/* Config notice */}
      {!loading && !company?.flags?.scan && (
        <div className={styles.configNotice}>
          <span className={styles.configIcon}>⚠</span>
          <div>
            <strong>Connect ArcenPay to see live data.</strong> Copy{" "}
            <code>.env.local.example</code> → <code>.env.local</code> and set your{" "}
            <code>ARCENPAY_API_KEY</code>.
          </div>
          <Link href="/dashboard/settings" className={styles.configLink}>
            Settings →
          </Link>
        </div>
      )}

      {/* Wallet */}
      {wallet && (
        <div className={styles.walletRow}>
          <div className={styles.walletDot} />
          <span className={styles.walletLabel}>Wallet</span>
          <span className={styles.walletAddr}>{walletShort}</span>
        </div>
      )}

      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statLabel}>Scans this session</div>
            <span className={styles.statIcon}>◈</span>
          </div>
          <div className={`${styles.statValue} ${styles.accent}`}>{sessionScanCount}</div>
          <div className={styles.statNote}>Local actions in this browser tab</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statLabel}>Scans this month</div>
            <span className={styles.statIcon}>◎</span>
          </div>
          <div className={`${styles.statValue} ${styles.accent}`}>
            {loading ? "—" : scanUsage?.usage ?? 0}
          </div>
          <div className={styles.statNote}>
            {loading
              ? "Loading usage…"
              : scanUsage?.allocation !== null && scanUsage?.allocation !== undefined
                ? `${scanUsage.usage} / ${scanUsage.allocation} used`
                : "Unlimited or not configured"}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <div className={styles.statLabel}>Scan feature</div>
            <span className={styles.statIcon}>🚩</span>
          </div>
          <div className={`${styles.statValue} ${company?.flags?.scan?.value ? styles.green : styles.muted}`}>
            {loading ? "—" : company?.flags?.scan?.value ? "Enabled" : "Disabled"}
          </div>
          <div className={styles.statNote}>
            {company?.flags?.scan?.reason ?? "Via ArcenPay entitlement evaluation"}
            {scanUsage?.exceeded ? " · limit reached" : ""}
          </div>
        </div>
      </div>

      {/* Demo action area */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Try it live</h2>
        <p className={styles.sectionDesc}>
          Calls <code>/api/consume</code> → <code>ArcenClient.consumeEntitlement({"scan"})</code> on your ArcenPay dashboard.
          Open the Events stream to see it appear in real time.
        </p>
        <div className={styles.demoArea}>
          <button
            onClick={handleScan}
            disabled={tracking || company?.flags.scan?.value === false}
            className={styles.btnScan}
          >
            {tracking ? "⏳ Scanning…" : "◈ Run Scan"}
          </button>
          {trackStatus && (
            <div className={styles.trackStatus}>✓ {trackStatus}</div>
          )}
        </div>
      </div>

      {/* Feature gate demo */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Feature gates</h2>
        <p className={styles.sectionDesc}>
          Features below are gated by ArcenPay flag evaluation, checked server-side via{" "}
          <code>ArcenClient.checkFlag()</code>.
        </p>
        <div className={styles.gateGrid}>
          <FeatureGateCard
            name="Basic Scan"
            flagKey="scan"
            enabled={company?.flags?.scan?.value ?? null}
            loading={loading}
            description="Extract text from documents using basic OCR."
          />
          <FeatureGateCard
            name="PDF Export"
            flagKey="export-pdf"
            enabled={company?.flags?.["export-pdf"]?.value ?? null}
            loading={loading}
            description="Export scanned documents as formatted PDF files."
          />
          <FeatureGateCard
            name="API Access"
            flagKey="api-access"
            enabled={company?.flags?.["api-access"]?.value ?? null}
            loading={loading}
            description="Programmatic access via REST API keys."
          />
        </div>
      </div>

      {/* Integration code */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Integration</h2>
        <p className={styles.sectionDesc}>
          How ArcenPay is wired in this demo. See <code>lib/arcen-client.ts</code> and{" "}
          <code>app/api/</code>.
        </p>
        <CodeBlock
          title="app/api/track/route.ts — server-side event tracking"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
});

await client.consumeEntitlement({
  featureKey: "scan",
  company: { wallet: "0x..." },
});`}
        />
        <CodeBlock
          title="app/api/flags/route.ts — flag evaluation"
          code={`const result = await client.checkFlag(
  "scan",               // feature key
  { wallet: "0x..." },  // company identity
);
// → { flag: "scan", value: true, reason: "Pro plan" }`}
        />
        <CodeBlock
          title="app/dashboard/billing/page.tsx — ArcenEmbed"
          code={`import { ArcenEmbed } from "@arcenpay/react";

const { token } = await fetch("/api/access-token", {
  method: "POST",
}).then(r => r.json());

<ArcenEmbed
  accessToken={token}
  componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
  baseUrl={process.env.ARCENPAY_BASE_URL}
/>`}
        />
      </div>
    </div>
  );
}

function FeatureGateCard({
  name, flagKey, enabled, loading, description,
}: {
  name: string;
  flagKey: string;
  enabled: boolean | null;
  loading: boolean;
  description: string;
}) {
  return (
    <div className={`${styles.gateCard} ${enabled === false ? styles.gateDisabled : ""}`}>
      <div className={styles.gateHeader}>
        <div className={styles.gateName}>{name}</div>
        <div
          className={`${styles.gateBadge} ${
            loading ? styles.gateBadgeLoading
            : enabled ? styles.gateBadgeOn
            : styles.gateBadgeOff
          }`}
        >
          {loading ? "…" : enabled ? "✓ Enabled" : "✗ Disabled"}
        </div>
      </div>
      <p className={styles.gateDesc}>{description}</p>
      <code className={styles.gateKey}>flag: &quot;{flagKey}&quot;</code>
      {!enabled && !loading && (
        <Link href="/dashboard/billing" className={styles.gateUpgrade}>
          Upgrade to unlock →
        </Link>
      )}
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeTitle}>{title}</div>
      <pre className={styles.codePre}><code>{code}</code></pre>
    </div>
  );
}
