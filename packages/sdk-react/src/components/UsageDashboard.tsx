'use client';

import React, { useEffect, useState } from 'react';

// ============================================================
//  UsageDashboard — ZKVUB Session Usage Metrics
//  PRD Section 5.1.3: Displays real-time usage metrics from
//  the Facilitator Node API for ZKVUB sessions.
// ============================================================

interface UsageMetrics {
  sessionId: string;
  callCount: number;
  remainingBalance: string;
  ratePerCall: string;
  estimatedCallsRemaining: number;
  sessionStatus: 'active' | 'settled' | 'withdrawn' | 'expired';
  lastUpdated: number;
}

export interface UsageDashboardProps {
  /** ZKVUB session ID */
  sessionId: string;
  /** Plan ID for rate schedule lookup */
  planId: string;
  /** Facilitator Node API base URL */
  facilitatorUrl?: string;
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** Custom CSS class */
  className?: string;
}

export function UsageDashboard({
  sessionId,
  planId,
  facilitatorUrl = 'http://localhost:3001',
  pollInterval = 5000,
  className = '',
}: UsageDashboardProps) {
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function fetchMetrics() {
      try {
        const res = await fetch(
          `${facilitatorUrl}/api/usage/${sessionId}?planId=${planId}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: UsageMetrics = await res.json();
        setMetrics(data);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
    interval = setInterval(fetchMetrics, pollInterval);

    return () => clearInterval(interval);
  }, [sessionId, planId, facilitatorUrl, pollInterval]);

  if (loading) {
    return (
      <div className={`meap-usage-dashboard meap-loading ${className}`}>
        <div className="meap-spinner" />
        <p>Loading session metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`meap-usage-dashboard meap-error ${className}`}>
        <p>⚠️ Error: {error}</p>
      </div>
    );
  }

  if (!metrics) return null;

  const statusColors: Record<string, string> = {
    active: '#22c55e',
    settled: '#3b82f6',
    withdrawn: '#a855f7',
    expired: '#ef4444',
  };

  return (
    <div className={`meap-usage-dashboard ${className}`}>
      <div className="meap-usage-header">
        <h3>ZKVUB Session Usage</h3>
        <span
          className="meap-status-badge"
          style={{ backgroundColor: statusColors[metrics.sessionStatus] || '#6b7280' }}
        >
          {metrics.sessionStatus}
        </span>
      </div>

      <div className="meap-usage-grid">
        <div className="meap-metric-card">
          <span className="meap-metric-label">API Calls</span>
          <span className="meap-metric-value">{metrics.callCount.toLocaleString()}</span>
        </div>

        <div className="meap-metric-card">
          <span className="meap-metric-label">Remaining Balance</span>
          <span className="meap-metric-value">{metrics.remainingBalance} USDC</span>
        </div>

        <div className="meap-metric-card">
          <span className="meap-metric-label">Rate/Call</span>
          <span className="meap-metric-value">{metrics.ratePerCall} USDC</span>
        </div>

        <div className="meap-metric-card">
          <span className="meap-metric-label">Calls Remaining</span>
          <span className="meap-metric-value">
            ~{metrics.estimatedCallsRemaining.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="meap-usage-footer">
        <span className="meap-session-id">Session: {sessionId.slice(0, 10)}...</span>
        <span className="meap-last-updated">
          Updated: {new Date(metrics.lastUpdated * 1000).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
