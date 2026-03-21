"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Zap, Activity, Shield, BarChart3, FileText, Settings,
  CheckCircle2, XCircle, Loader2, RefreshCw, Send, Eye,
  ChevronRight, AlertTriangle, Terminal, Hexagon, Bell,
} from "lucide-react";
import { useFlag, useFlags, useTrack } from "@meap/react";
import type { SchematicCompany, FlagCheckResult } from "@meap/core";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRecord {
  id: string;
  eventType: string;
  name: string | null;
  traits: Record<string, unknown>;
  sentAt: string;
  company?: { name: string } | null;
}

interface DemoConfig {
  apiKey: string;
  baseUrl: string;
  companyEmail: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cls(...args: (string | boolean | undefined | null)[]) {
  return args.filter(Boolean).join(" ");
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ onSave }: { onSave: (cfg: DemoConfig) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [email, setEmail] = useState("demo@acmescan.xyz");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const testConnection = async () => {
    if (!apiKey.startsWith("api_")) {
      setTestResult({ ok: false, msg: "API key must start with api_" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${baseUrl}/api/v1/companies?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setTestResult({ ok: true, msg: "Connected successfully!" });
      } else {
        const d = await res.json() as { error?: string };
        setTestResult({ ok: false, msg: d.error || `HTTP ${res.status}` });
      }
    } catch {
      setTestResult({ ok: false, msg: "Cannot reach dashboard. Is it running?" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.startsWith("api_")) return;
    onSave({ apiKey, baseUrl, companyEmail: email });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div style={{ background: "linear-gradient(135deg, var(--accent), #a78bfa)", borderRadius: 12, padding: 10 }}>
            <Hexagon size={24} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>AcmeScan</div>
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Powered by ArcenPay SDK</div>
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Connect to ArcenPay</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 24 }}>
            Enter your API key from the dashboard to start the demo. This simulates a real SaaS app using the SDK.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Dashboard URL</div>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                style={inputStyle}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                API Key <span style={{ color: "var(--danger)" }}>*</span>
              </div>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Get this from Settings → Protocol Keys in the dashboard
              </div>
            </label>

            <label>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Demo Company Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="demo@acmescan.xyz"
                style={inputStyle}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                This email identifies your demo company in the system
              </div>
            </label>
          </div>

          {testResult && (
            <div style={{
              marginTop: 16,
              padding: "10px 14px",
              borderRadius: 8,
              background: testResult.ok ? "var(--success-dim)" : "var(--danger-dim)",
              border: `1px solid ${testResult.ok ? "var(--success)" : "var(--danger)"}30`,
              color: testResult.ok ? "var(--success)" : "var(--danger)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {testResult.msg}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button
              onClick={testConnection}
              disabled={testing || !apiKey}
              style={{ ...btnStyle("secondary"), flex: 1 }}
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Test Connection
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.startsWith("api_")}
              style={{ ...btnStyle("primary"), flex: 1 }}
            >
              Launch Demo
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div style={{ marginTop: 20, padding: 16, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border-dim)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Terminal size={12} /> Quick Setup
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8 }}>
            <div style={{ color: "var(--text-muted)" }}># 1. Start the dashboard</div>
            <div>cd apps/arcen-dashboard && pnpm dev</div>
            <div style={{ color: "var(--text-muted)", marginTop: 6 }}># 2. Create API key in dashboard → Settings → Protocol Keys</div>
            <div style={{ color: "var(--text-muted)", marginTop: 6 }}># 3. Create some feature flags in dashboard → Feature Flags</div>
            <div style={{ color: "var(--text-muted)", marginTop: 6 }}># 4. Enter the key above and click Launch Demo</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Flag Card ─────────────────────────────────────────────────────────────────

function FlagCard({
  flagKey,
  label,
  description,
  icon: Icon,
  companyId,
  baseUrl,
  apiKey,
}: {
  flagKey: string;
  label: string;
  description: string;
  icon: React.ElementType;
  companyId: string;
  baseUrl: string;
  apiKey: string;
}) {
  const { value, loading, reason, error, refetch } = useFlag(
    flagKey,
    { id: companyId },
    undefined,
    { baseUrl, apiKey },
  );

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${value === true ? "var(--success)" : value === false ? "var(--border)" : "var(--border)"}30`,
      borderRadius: 12,
      padding: 20,
      position: "relative",
      overflow: "hidden",
    }}>
      {value === true && (
        <div style={{
          position: "absolute", top: 0, right: 0, left: 0, height: 2,
          background: "linear-gradient(90deg, transparent, var(--success), transparent)",
        }} />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: value === true ? "var(--success-dim)" : "var(--surface-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon size={16} color={value === true ? "var(--success)" : "var(--text-muted)"} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{description}</div>
          </div>
        </div>
        {loading ? (
          <Loader2 size={16} color="var(--text-muted)" style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <div style={{
            padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: value === true ? "var(--success-dim)" : "var(--surface-2)",
            color: value === true ? "var(--success)" : "var(--text-muted)",
            border: `1px solid ${value === true ? "var(--success)" : "var(--border)"}40`,
          }}>
            {value === true ? "ENABLED" : value === false ? "DISABLED" : "UNKNOWN"}
          </div>
        )}
      </div>

      {!loading && (
        <div style={{
          marginTop: 14, padding: "8px 12px", borderRadius: 6,
          background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)",
          fontFamily: "monospace",
        }}>
          {error ? (
            <span style={{ color: "var(--danger)" }}>Error: {error}</span>
          ) : (
            <span>{reason || `useFlag("${flagKey}") → ${JSON.stringify(value)}`}</span>
          )}
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <code style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-2)", padding: "2px 6px", borderRadius: 4 }}>
          {flagKey}
        </code>
        <button onClick={refetch} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex" }}>
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Usage Tracker ─────────────────────────────────────────────────────────────

function UsageTracker({ company, onTracked }: { company: SchematicCompany; onTracked: () => void }) {
  const { track } = useTrack({ baseUrl: "" });
  const [scanCount, setScanCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [events, setEvents] = useState<{ id: string; name: string; time: string }[]>([]);

  const doScan = async () => {
    setScanning(true);
    try {
      await track({
        name: "scan",
        company: { id: company.id, email: company.email ?? undefined },
        traits: { source: "demo-app", scanType: "barcode" },
      });
      const scanId = Math.random().toString(36).slice(2, 8).toUpperCase();
      setScanCount((c) => c + 1);
      setLastScan(scanId);
      setEvents((prev) => [
        { id: scanId, name: "scan", time: new Date().toISOString() },
        ...prev.slice(0, 9),
      ]);
      onTracked();
    } finally {
      setScanning(false);
    }
  };

  const doExport = async () => {
    await track({
      name: "export",
      company: { id: company.id },
      traits: { format: "csv", rows: scanCount },
    });
    onTracked();
  };

  const doReport = async () => {
    await track({
      name: "generate_report",
      company: { id: company.id },
      traits: { type: "monthly" },
    });
    onTracked();
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Usage Tracker</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 16 }}>
        Simulate real SaaS usage — every click sends a tracked event via <code style={{ background: "var(--surface-2)", padding: "1px 5px", borderRadius: 4 }}>useTrack()</code>
      </div>

      {/* Scan counter */}
      <div style={{
        background: "var(--surface-2)", borderRadius: 10, padding: "16px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: "var(--accent)" }}>{scanCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>Scans this session</div>
        </div>
        {lastScan && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Last scan</div>
            <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text)" }}>#{lastScan}</div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <button onClick={doScan} disabled={scanning} style={btnStyle("primary")}>
          {scanning ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Zap size={13} />}
          Scan
        </button>
        <button onClick={doExport} style={btnStyle("secondary")}>
          <FileText size={13} />
          Export
        </button>
        <button onClick={doReport} style={btnStyle("secondary")}>
          <BarChart3 size={13} />
          Report
        </button>
      </div>

      {/* Recent events from this tracker */}
      {events.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Tracked This Session
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
            {events.map((e) => (
              <div key={e.id} style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 12, padding: "4px 8px", borderRadius: 6,
                background: "var(--surface-2)",
              }}>
                <span style={{ color: "var(--accent)" }}>{e.name}</span>
                <span style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 11 }}>#{e.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Company Card ─────────────────────────────────────────────────────────────

function CompanyCard({ company, onRefresh }: { company: SchematicCompany; onRefresh: () => void }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent), #a78bfa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 16, color: "white",
          }}>
            {company.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{company.name}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 1, fontFamily: "monospace" }}>
              {company.id.slice(0, 20)}...
            </div>
          </div>
        </div>
        <button onClick={onRefresh} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
          <RefreshCw size={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Email", value: company.email ?? "—" },
          { label: "Wallet", value: company.walletAddress ? `${company.walletAddress.slice(0, 8)}…` : "—" },
          { label: "Plan", value: company.activePlanId ?? "No plan" },
          { label: "Last Seen", value: timeAgo(company.lastSeenAt) },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "var(--surface-2)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
          </div>
        ))}
      </div>

      {Object.keys(company.traits).length > 0 && (
        <div style={{ marginTop: 12, background: "var(--surface-2)", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Traits</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(company.traits).map(([k, v]) => (
              <span key={k} style={{
                background: "var(--accent-dim)", color: "var(--accent)",
                padding: "2px 8px", borderRadius: 12, fontSize: 11, fontFamily: "monospace",
              }}>
                {k}: {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Events Feed ──────────────────────────────────────────────────────────────

function EventsFeed({ refreshTick }: { refreshTick: number }) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events?limit=15");
      if (res.ok) {
        const d = await res.json() as { data: EventRecord[] };
        setEvents(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, refreshTick]);

  useEffect(() => {
    if (live) {
      intervalRef.current = setInterval(fetchEvents, 4000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [live, fetchEvents]);

  const eventTypeColor: Record<string, string> = {
    track: "var(--accent)",
    identify: "#a78bfa",
    flag_check: "var(--success)",
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Live Events</div>
          <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 1 }}>Real-time stream from /api/v1/events</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setLive(!live)}
            style={{
              background: live ? "var(--success-dim)" : "var(--surface-2)",
              border: `1px solid ${live ? "var(--success)" : "var(--border)"}40`,
              color: live ? "var(--success)" : "var(--text-muted)",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <Activity size={11} style={{ animation: live ? "pulse 2s ease infinite" : "none" }} />
            {live ? "Live" : "Paused"}
          </button>
          <button onClick={fetchEvents} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: 6, cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} style={{ height: 36, background: "var(--surface-2)", borderRadius: 6, animation: "pulse 1.5s ease infinite" }} />
          ))
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 13 }}>
            No events yet. Click the buttons above to start tracking!
          </div>
        ) : (
          events.map((e) => (
            <div key={e.id} style={{
              display: "grid",
              gridTemplateColumns: "80px 1fr auto",
              gap: 10,
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 6,
              background: "var(--surface-2)",
              fontSize: 12,
            }}>
              <span style={{
                fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                color: eventTypeColor[e.eventType] ?? "var(--text-muted)",
              }}>
                {e.name ?? e.eventType}
              </span>
              <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.company?.name ?? "—"}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                {timeAgo(e.sentAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Flags Dashboard (useFlags bulk check) ────────────────────────────────────

function FlagsBulkCheck({ companyId, customFlags }: { companyId: string; customFlags: string[] }) {
  const allKeys = customFlags.length > 0 ? customFlags : ["scan", "advanced_analytics", "api_access", "custom_exports", "sso"];
  const { flags, loading } = useFlags(allKeys, { id: companyId }, undefined, { baseUrl: "" });

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {allKeys.map((k) => (
          <div key={k} style={{ height: 32, background: "var(--surface-2)", borderRadius: 6, animation: "pulse 1.5s ease infinite" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {allKeys.map((key) => (
        <div key={key} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", borderRadius: 6,
          background: flags[key] === true ? "var(--success-dim)" : "var(--surface-2)",
          border: `1px solid ${flags[key] === true ? "var(--success)" : "var(--border)"}30`,
        }}>
          <code style={{ fontSize: 12, color: flags[key] === true ? "var(--success)" : "var(--text-dim)" }}>{key}</code>
          <div style={{
            fontSize: 11, fontWeight: 700,
            color: flags[key] === true ? "var(--success)" : flags[key] === false ? "var(--danger)" : "var(--text-muted)",
          }}>
            {flags[key] === null ? "—" : String(flags[key]).toUpperCase()}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        Via <code style={{ background: "var(--surface-2)", padding: "1px 5px", borderRadius: 4 }}>useFlags([...keys], {"{"} id: companyId {"}"})</code>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function DemoApp() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [company, setCompany] = useState<SchematicCompany | null>(null);
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [activeTab, setActiveTab] = useState<"flags" | "usage" | "bulk" | "events">("flags");
  const [customFlagKey, setCustomFlagKey] = useState("");
  const [customFlags, setCustomFlags] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("arcen_demo_config");
    if (saved) {
      try {
        setConfig(JSON.parse(saved) as DemoConfig);
      } catch { /* ignore */ }
    }
  }, []);

  // Persist config
  const handleSaveConfig = (cfg: DemoConfig) => {
    localStorage.setItem("arcen_demo_config", JSON.stringify(cfg));
    // Also post to backend so API routes use the same config
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).catch(() => {});
    setConfig(cfg);
  };

  // Fetch/upsert demo company
  const fetchCompany = useCallback(async () => {
    if (!config) return;
    setLoadingCompany(true);
    setConfigError(null);
    try {
      // Use dashboard directly since demo API routes proxy to it
      const res = await fetch(`${config.baseUrl}/api/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          event_type: "identify",
          company: {
            email: config.companyEmail,
            name: "AcmeScan Demo Co",
          },
          traits: { demo: true, sdk_version: "1.0.0" },
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setConfigError(d.error ?? `HTTP ${res.status}`);
        return;
      }

      // Fetch the company
      const listRes = await fetch(`${config.baseUrl}/api/v1/companies?search=${encodeURIComponent(config.companyEmail)}&limit=1`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (listRes.ok) {
        const d = await listRes.json() as { data: SchematicCompany[] };
        setCompany(d.data[0] ?? null);
      }
    } catch (err) {
      setConfigError(String(err));
    } finally {
      setLoadingCompany(false);
    }
  }, [config]);

  useEffect(() => {
    if (config) fetchCompany();
  }, [config, fetchCompany]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  if (!config) return <SetupScreen onSave={handleSaveConfig} />;

  const tabs = [
    { id: "flags", label: "Feature Flags", icon: Shield },
    { id: "usage", label: "Track Usage", icon: Zap },
    { id: "bulk", label: "Bulk Check", icon: Eye },
    { id: "events", label: "Events", icon: Activity },
  ] as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Notification toast */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 1000,
          background: "var(--success-dim)", border: "1px solid var(--success)40",
          color: "var(--success)", borderRadius: 8, padding: "10px 16px",
          fontSize: 13, display: "flex", alignItems: "center", gap: 6,
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}>
          <CheckCircle2 size={14} />
          {notification}
        </div>
      )}

      {/* Header */}
      <div style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56, position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg, var(--accent), #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Hexagon size={14} color="white" />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>AcmeScan</div>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>ArcenPay SDK Demo</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {company && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
              {company.name}
            </div>
          )}
          <button
            onClick={() => { localStorage.removeItem("arcen_demo_config"); setConfig(null); setCompany(null); }}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "var(--text-dim)", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
          >
            <Settings size={12} /> Settings
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        {/* Config error */}
        {configError && (
          <div style={{
            marginBottom: 20, padding: "12px 16px", borderRadius: 10,
            background: "var(--danger-dim)", border: "1px solid var(--danger)30",
            color: "var(--danger)", fontSize: 13, display: "flex", alignItems: "center", gap: 8,
          }}>
            <AlertTriangle size={14} />
            <span>{configError}</span>
            <button onClick={fetchCompany} style={{ marginLeft: "auto", background: "none", border: "1px solid var(--danger)40", borderRadius: 5, padding: "2px 8px", cursor: "pointer", color: "var(--danger)", fontSize: 11 }}>Retry</button>
          </div>
        )}

        {/* Hero */}
        {!company && !loadingCompany && !configError && (
          <div style={{ textAlign: "center", padding: "40px 0 24px" }}>
            <Loader2 size={24} color="var(--accent)" style={{ animation: "spin 1s linear infinite", margin: "0 auto" }} />
            <div style={{ color: "var(--text-dim)", marginTop: 10, fontSize: 13 }}>Setting up demo company...</div>
          </div>
        )}

        {loadingCompany && !company && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Loader2 size={24} color="var(--accent)" style={{ animation: "spin 1s linear infinite", margin: "0 auto" }} />
            <div style={{ color: "var(--text-dim)", marginTop: 10 }}>Loading company...</div>
          </div>
        )}

        {company && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
            {/* Left sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <CompanyCard company={company} onRefresh={fetchCompany} />

              {/* SDK info box */}
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 12, padding: 16,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>SDK Integration</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { pkg: "@meap/react", hooks: "useFlag, useFlags, useTrack" },
                    { pkg: "@meap/node", hooks: "ArcenClient (server)" },
                    { pkg: "@meap/core", hooks: "TypeScript types" },
                  ].map(({ pkg, hooks }) => (
                    <div key={pkg} style={{ background: "var(--surface-2)", borderRadius: 6, padding: "7px 10px" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--accent)" }}>{pkg}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{hooks}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--surface-2)", borderRadius: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Company ID</div>
                  <code style={{ fontSize: 10, color: "var(--text-dim)", wordBreak: "break-all" }}>{company.id}</code>
                </div>
              </div>

              {/* Custom flag checker */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Check a Flag Key</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={customFlagKey}
                    onChange={(e) => setCustomFlagKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customFlagKey.trim()) {
                        setCustomFlags((prev) => [...new Set([...prev, customFlagKey.trim()])]);
                        setCustomFlagKey("");
                        setActiveTab("bulk");
                      }
                    }}
                    placeholder="my_flag_key"
                    style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "6px 10px", fontFamily: "monospace" }}
                  />
                  <button
                    onClick={() => {
                      if (customFlagKey.trim()) {
                        setCustomFlags((prev) => [...new Set([...prev, customFlagKey.trim()])]);
                        setCustomFlagKey("");
                        setActiveTab("bulk");
                      }
                    }}
                    style={{ ...btnStyle("primary"), padding: "6px 10px" }}
                  >
                    <Send size={12} />
                  </button>
                </div>
                {customFlags.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {customFlags.map((f) => (
                      <span
                        key={f}
                        onClick={() => setCustomFlags((prev) => prev.filter((x) => x !== f))}
                        style={{
                          background: "var(--accent-dim)", color: "var(--accent)",
                          padding: "2px 8px", borderRadius: 12, fontSize: 11,
                          cursor: "pointer", fontFamily: "monospace",
                        }}
                        title="Click to remove"
                      >{f} ×</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right main content */}
            <div>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)", width: "fit-content" }}>
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    style={{
                      background: activeTab === id ? "var(--surface-2)" : "transparent",
                      border: "none",
                      borderRadius: 7,
                      padding: "6px 14px",
                      cursor: "pointer",
                      color: activeTab === id ? "var(--text)" : "var(--text-dim)",
                      fontSize: 13,
                      fontWeight: activeTab === id ? 600 : 400,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "all 0.15s",
                    }}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab: Feature Flags */}
              {activeTab === "flags" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{
                    padding: "12px 16px", borderRadius: 10,
                    background: "var(--accent-dim)", border: "1px solid var(--accent)20",
                    fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6,
                  }}>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>useFlag() </span>
                    checks a single flag via{" "}
                    <code style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 4 }}>GET /api/v1/flags/check?key=...</code>.
                    Results are cached 30s. Create flags in your dashboard → Feature Flags section.
                  </div>
                  {["scan", "advanced_analytics", "api_access", "custom_exports", "sso"].map((key, i) => (
                    <FlagCard
                      key={key}
                      flagKey={key}
                      label={["Scan Feature", "Advanced Analytics", "API Access", "Custom Exports", "Single Sign-On"][i]}
                      description={[
                        "Core scanning functionality",
                        "Usage charts and insights",
                        "Programmatic API access",
                        "Export data as CSV/PDF",
                        "SAML/OIDC SSO login",
                      ][i]}
                      icon={[Zap, BarChart3, Terminal, FileText, Shield][i]}
                      companyId={company.id}
                      baseUrl={config.baseUrl}
                      apiKey={config.apiKey}
                    />
                  ))}
                </div>
              )}

              {/* Tab: Usage Tracking */}
              {activeTab === "usage" && (
                <UsageTracker
                  company={company}
                  onTracked={() => {
                    setRefreshTick((t) => t + 1);
                    showNotification("Event tracked via useTrack() ✓");
                  }}
                />
              )}

              {/* Tab: Bulk Check */}
              {activeTab === "bulk" && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Bulk Flag Check</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 16 }}>
                    <code style={{ background: "var(--surface-2)", padding: "1px 5px", borderRadius: 4 }}>useFlags([...keys], companyKeys)</code> checks all flags in parallel.
                    Add custom flags using the input in the sidebar.
                  </div>
                  <FlagsBulkCheck companyId={company.id} customFlags={customFlags} />
                </div>
              )}

              {/* Tab: Events */}
              {activeTab === "events" && (
                <EventsFeed refreshTick={refreshTick} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
};

function btnStyle(variant: "primary" | "secondary"): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    background: variant === "primary" ? "var(--accent)" : "var(--surface-2)",
    color: variant === "primary" ? "white" : "var(--text)",
    transition: "opacity 0.15s",
  };
}
