"use client";

import { useState, useEffect, useCallback } from "react";
import { FACILITATOR_BASE_URL, truncateAddress } from "@/lib/contracts";

interface DeliveryLog {
  id: string;
  event: string;
  url: string;
  statusCode: number | null;
  attemptNumber: number;
  deliveredAt: number;
  success: boolean;
  error?: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  description: string;
}

export default function WebhooksPage() {
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [webhooksConfigured, setWebhooksConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [brandName, setBrandName] = useState("MEAP");
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [testingSend, setTestingSend] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const facilitatorBase = FACILITATOR_BASE_URL.replace(/\/$/, "");

  const fetchData = useCallback(async () => {
    try {
      const [logRes, templateRes] = await Promise.all([
        fetch(`${facilitatorBase}/api/webhooks/log`),
        fetch(`${facilitatorBase}/api/email/templates`),
      ]);

      if (logRes.ok) {
        const data = await logRes.json();
        setWebhooksConfigured(data.configured);
        setLogs(data.log || []);
      }

      if (templateRes.ok) {
        const data = await templateRes.json();
        setEmailConfigured(data.configured);
        setBrandName(data.brandName || "MEAP");
        setTemplates(data.templates || []);
      }
    } catch {
      // Facilitator not reachable
    } finally {
      setLoading(false);
    }
  }, [facilitatorBase]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleReplay = async (id: string) => {
    setReplayingId(id);
    try {
      const res = await fetch(`${facilitatorBase}/api/webhooks/replay/${id}`, {
        method: "POST",
      });
      const data = await res.json();
      setFlashMessage(data.success ? `Replayed ${id}` : data.error);
      setTimeout(() => setFlashMessage(null), 3000);
      void fetchData();
    } catch {
      setFlashMessage("Replay failed — facilitator unreachable");
      setTimeout(() => setFlashMessage(null), 3000);
    } finally {
      setReplayingId(null);
    }
  };

  const handleTestWebhook = async () => {
    setTestingSend(true);
    try {
      const res = await fetch(`${facilitatorBase}/api/webhooks/test`, {
        method: "POST",
      });
      const data = await res.json();
      setFlashMessage(data.success ? "Test webhook sent" : data.error);
      setTimeout(() => setFlashMessage(null), 3000);
      void fetchData();
    } catch {
      setFlashMessage("Test failed — facilitator unreachable");
      setTimeout(() => setFlashMessage(null), 3000);
    } finally {
      setTestingSend(false);
    }
  };

  const successCount = logs.filter((l) => l.success).length;
  const failCount = logs.filter((l) => !l.success).length;

  return (
    <>
      <div className="page-header">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1>Webhooks & Notifications</h1>
            <p>
              Monitor webhook deliveries, replay failed events, and manage email
              templates
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleTestWebhook}
            disabled={testingSend || !webhooksConfigured}
          >
            {testingSend ? "Sending..." : "🧪 Send Test Webhook"}
          </button>
        </div>
      </div>

      {flashMessage && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          {flashMessage}
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Webhook Status</div>
          <div className="value">
            <span
              className={`badge ${webhooksConfigured ? "active" : "inactive"}`}
            >
              {webhooksConfigured ? "Active" : "Not Configured"}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Delivered</div>
          <div className="value">{loading ? "—" : successCount}</div>
          <div className="change positive">
            {successCount > 0
              ? `${((successCount / logs.length) * 100).toFixed(0)}% success`
              : "No deliveries"}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Failed</div>
          <div className="value">{loading ? "—" : failCount}</div>
          <div className="change negative">
            {failCount > 0 ? `${failCount} require attention` : "All delivered"}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Email Service</div>
          <div className="value">
            <span
              className={`badge ${emailConfigured ? "active" : "inactive"}`}
            >
              {emailConfigured ? "Active" : "Not Configured"}
            </span>
          </div>
          <div className="change">{brandName}</div>
        </div>
      </div>

      {/* Delivery Log Table */}
      <div className="data-table">
        <div className="table-header">
          <h3>Delivery Log</h3>
          <button className="btn" onClick={() => void fetchData()}>
            Refresh
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Status</th>
              <th>Attempt</th>
              <th>Endpoint</th>
              <th>Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24 }}>
                  <div
                    className="skeleton"
                    style={{ width: "100%", height: 20 }}
                  />
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No webhook deliveries yet.{" "}
                  {webhooksConfigured
                    ? "Events will appear when subscriptions are created."
                    : "Configure webhooks in Settings to enable."}
                </td>
              </tr>
            ) : (
              logs.map((entry) => (
                <tr key={`${entry.id}-${entry.deliveredAt}`}>
                  <td>
                    <code style={{ fontSize: 12 }}>{entry.event}</code>
                  </td>
                  <td>
                    <span
                      className={`badge ${entry.success ? "active" : "inactive"}`}
                    >
                      {entry.success
                        ? `${entry.statusCode}`
                        : entry.statusCode || "Error"}
                    </span>
                  </td>
                  <td>{entry.attemptNumber}</td>
                  <td
                    className="address"
                    title={entry.url}
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {entry.url}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {new Date(entry.deliveredAt).toLocaleString()}
                  </td>
                  <td>
                    {!entry.success && (
                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        onClick={() => handleReplay(entry.id)}
                        disabled={replayingId === entry.id}
                      >
                        {replayingId === entry.id ? "..." : "Replay"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Email Templates */}
      <div className="data-table" style={{ marginTop: 24 }}>
        <div className="table-header">
          <h3>Email Templates</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No templates loaded. Ensure the facilitator is running.
                </td>
              </tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <br />
                    <code style={{ fontSize: 11 }}>{t.id}</code>
                  </td>
                  <td>{t.description}</td>
                  <td>
                    <span
                      className={`badge ${emailConfigured ? "active" : "inactive"}`}
                    >
                      {emailConfigured ? "Ready" : "Needs Config"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
