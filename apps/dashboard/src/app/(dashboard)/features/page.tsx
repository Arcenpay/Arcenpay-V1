// ============================================================
//  Provider Dashboard — Feature Flags Page
//  Tableland-backed feature matrix CRUD
// ============================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FLAGS,
  TIERS,
  type FeatureMatrixFlag,
  type FeatureTier,
} from "@/lib/featureFlags";

interface FeatureResponse {
  ok: boolean;
  source?: "default" | "tableland";
  flags?: FeatureMatrixFlag[];
  error?: string;
}

export default function FeaturesPage() {
  const [flags, setFlags] = useState<FeatureMatrixFlag[]>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"default" | "tableland">("default");
  const [newFlagKey, setNewFlagKey] = useState("");
  const [newFlagDescription, setNewFlagDescription] = useState("");

  const totalEnabled = useMemo(
    () =>
      flags.reduce(
        (acc, flag) =>
          acc + TIERS.reduce((sum, tier) => sum + (flag.tiers[tier] ? 1 : 0), 0),
        0,
      ),
    [flags],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/features", { cache: "no-store" });
        const data = (await res.json()) as FeatureResponse;
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.error || "Failed to load feature flags.");
          return;
        }
        setFlags(data.flags?.length ? data.flags : DEFAULT_FLAGS);
        setSource(data.source || "default");
      } catch {
        if (!cancelled) setError("Failed to load feature flags.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFlag = (flagKey: string, tier: FeatureTier) => {
    setFlags((prev) =>
      prev.map((f) =>
        f.key === flagKey
          ? { ...f, tiers: { ...f.tiers, [tier]: !f.tiers[tier] } }
          : f,
      ),
    );
  };

  const addFlag = () => {
    const key = newFlagKey.trim().toLowerCase().replaceAll(/[^a-z0-9_]/g, "_");
    if (!key) return;
    if (flags.some((f) => f.key === key)) {
      setError(`Flag "${key}" already exists.`);
      return;
    }
    setFlags((prev) => [
      ...prev,
      {
        key,
        description: newFlagDescription.trim() || key.replaceAll("_", " "),
        tiers: { starter: false, pro: false, enterprise: false },
      },
    ]);
    setNewFlagKey("");
    setNewFlagDescription("");
    setError(null);
  };

  const saveFlags = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags }),
      });
      const data = (await res.json()) as FeatureResponse;
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to save feature flags.");
        return;
      }
      setSource("tableland");
    } catch {
      setError("Failed to save feature flags.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
        >
          <div>
            <h1>Feature Flags</h1>
            <p>Configure tier-level access with Tableland-backed persistence</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`badge ${source === "tableland" ? "active" : ""}`}>
              {source === "tableland" ? "Tableland" : "Default"}
            </span>
            <button className="btn btn-primary" onClick={saveFlags} disabled={saving || loading}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="stat-card" style={{ borderColor: "var(--danger)", marginBottom: 16 }}>
          <div className="label" style={{ color: "var(--danger)" }}>
            Error
          </div>
          <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>{error}</div>
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="label">Flags</div>
          <div className="value">{flags.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Tiers</div>
          <div className="value">{TIERS.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Enabled Cells</div>
          <div className="value">{totalEnabled}</div>
        </div>
        <div className="stat-card">
          <div className="label">Storage</div>
          <div className="value">{source === "tableland" ? "Live" : "Fallback"}</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Feature Matrix</h3>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {flags.length} flags × {TIERS.length} tiers
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Feature</th>
              <th>Description</th>
              {TIERS.map((tier) => (
                <th key={tier} style={{ textAlign: "center" }}>
                  <span className={`badge ${tier}`}>{tier}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: 24 }}>
                  <div className="skeleton" style={{ width: "100%", height: 20 }} />
                </td>
              </tr>
            ) : (
              flags.map((flag) => (
                <tr key={flag.key}>
                  <td>
                    <span
                      style={{
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        color: "var(--accent)",
                        fontSize: 13,
                      }}
                    >
                      {flag.key}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    {flag.description}
                  </td>
                  {TIERS.map((tier) => (
                    <td key={tier} style={{ textAlign: "center" }}>
                      <button
                        aria-label={`toggle-${flag.key}-${tier}`}
                        className={`toggle ${flag.tiers[tier] ? "on" : ""}`}
                        onClick={() => toggleFlag(flag.key, tier)}
                        style={{ display: "inline-block", border: "none", cursor: "pointer" }}
                        disabled={saving}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table" style={{ marginTop: 24 }}>
        <div className="table-header">
          <h3>Add Feature Flag</h3>
        </div>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
          <input
            className="form-input"
            placeholder="flag_key"
            value={newFlagKey}
            onChange={(e) => setNewFlagKey(e.target.value)}
            disabled={saving}
          />
          <input
            className="form-input"
            placeholder="Description"
            value={newFlagDescription}
            onChange={(e) => setNewFlagDescription(e.target.value)}
            disabled={saving}
          />
          <button className="btn" onClick={addFlag} disabled={saving || !newFlagKey.trim()}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}
