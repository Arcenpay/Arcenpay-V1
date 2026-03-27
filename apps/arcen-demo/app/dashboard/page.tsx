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
  flags: {
    scan: FlagResult | null;
    "export-pdf": FlagResult | null;
    "api-access": FlagResult | null;
  };
}

export default function DashboardPage() {
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanCount, setScanCount] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [trackStatus, setTrackStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/company")
      .then((r) => r.json())
      .then((data: CompanyData) => setCompany(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleScan() {
    setTracking(true);
    setTrackStatus(null);
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "scan", traits: { source: "demo" } }),
      });
      if (res.ok) {
        setScanCount((c) => c + 1);
        setTrackStatus("Scan tracked via ArcenClient.track()");
      } else {
        setTrackStatus("Error: Could not track event");
      }
    } catch {
      setTrackStatus("Error: Network request failed");
    } finally {
      setTracking(false);
      setTimeout(() => setTrackStatus(null), 3000);
    }
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Overview</h1>
          <p className={styles.subtitle}>
            Welcome back. Here&apos;s your ScanBot dashboard.
          </p>
        </div>
        <Link href="/dashboard/billing" className={styles.btnPrimary}>
          Manage Plan
        </Link>
      </div>

      {/* Config notice */}
      {!loading && !company?.flags?.scan && (
        <div className={styles.configNotice}>
          <span className={styles.configIcon}>⚙</span>
          <div>
            <strong>Connect ArcenPay to see live data.</strong> Copy{" "}
            <code>.env.local.example</code> → <code>.env.local</code> and set
            your <code>ARCENPAY_API_KEY</code>.
          </div>
          <Link href="/dashboard/settings" className={styles.configLink}>
            Settings →
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Scans this session</div>
          <div className={styles.statValue}>{scanCount}</div>
          <div className={styles.statNote}>Click &quot;Run Scan&quot; below to track</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Scan feature</div>
          <div className={`${styles.statValue} ${company?.flags?.scan?.value ? styles.green : styles.muted}`}>
            {loading ? "—" : company?.flags?.scan?.value ? "Enabled" : "Disabled"}
          </div>
          <div className={styles.statNote}>
            {company?.flags?.scan?.reason ?? "Via ArcenPay flag evaluation"}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>PDF Export</div>
          <div className={`${styles.statValue} ${company?.flags?.["export-pdf"]?.value ? styles.green : styles.muted}`}>
            {loading ? "—" : company?.flags?.["export-pdf"]?.value ? "Enabled" : "Disabled"}
          </div>
          <div className={styles.statNote}>Plan entitlement</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>API Access</div>
          <div className={`${styles.statValue} ${company?.flags?.["api-access"]?.value ? styles.green : styles.muted}`}>
            {loading ? "—" : company?.flags?.["api-access"]?.value ? "Enabled" : "Disabled"}
          </div>
          <div className={styles.statNote}>Pro+ feature</div>
        </div>
      </div>

      {/* Demo action area */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Try it live</h2>
        <p className={styles.sectionDesc}>
          This button calls <code>/api/track</code> → <code>ArcenClient.track(&#123; name: &quot;scan&quot; &#125;)</code>{" "}
          on your ArcenPay dashboard. Open the Events stream in your dashboard to see it appear in real time.
        </p>
        <div className={styles.demoArea}>
          <button
            onClick={handleScan}
            disabled={tracking}
            className={styles.btnScan}
          >
            {tracking ? "Scanning..." : "◈ Run Scan"}
          </button>
          {trackStatus && (
            <div className={styles.trackStatus}>{trackStatus}</div>
          )}
        </div>
      </div>

      {/* Feature gate demo */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Feature gates</h2>
        <p className={styles.sectionDesc}>
          Features below are gated by ArcenPay flag evaluation. The flags are
          checked server-side via <code>ArcenClient.checkFlag()</code>.
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
          Here&apos;s how ArcenPay is integrated in this demo. Check{" "}
          <code>lib/arcen-client.ts</code> and <code>app/api/</code>.
        </p>
        <CodeBlock
          title="Server-side tracking (app/api/track/route.ts)"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

await client.track({
  name: "scan",
  company: { wallet: "0x..." },
});`}
        />
        <CodeBlock
          title="Flag check (app/api/flags/route.ts)"
          code={`const result = await client.checkFlag(
  "scan",          // feature key
  { wallet: "0x..." },  // company keys
);
// → { flag: "scan", value: true, reason: "Pro plan" }`}
        />
        <CodeBlock
          title="ArcenEmbed in billing page"
          code={`import { ArcenEmbed } from "@arcenpay/react";

// 1. Get access token from your backend
const { token } = await fetch("/api/access-token", {
  method: "POST",
}).then(r => r.json());

// 2. Render the custom component you built in the dashboard
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
  name,
  flagKey,
  enabled,
  loading,
  description,
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
          {loading ? "..." : enabled ? "Enabled" : "Disabled"}
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
