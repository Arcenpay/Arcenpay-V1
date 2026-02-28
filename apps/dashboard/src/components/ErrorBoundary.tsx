"use client";

import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — Catch rendering errors in contract UI sections.
 * PRD §16 — React ErrorBoundary around all contract-dependent UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    // Report to Sentry for production error tracking (if configured)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = require("@sentry/nextjs") as {
        captureException: (
          error: Error,
          opts?: { extra?: Record<string, unknown> },
        ) => void;
      };
      Sentry.captureException(error, {
        extra: { componentStack: errorInfo.componentStack },
      });
    } catch {
      // @sentry/nextjs not installed — silently skip
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            padding: 24,
            border: "1px solid var(--error, #ef4444)",
            borderRadius: 12,
            background: "rgba(239, 68, 68, 0.05)",
            textAlign: "center",
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </p>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 16,
            }}
          >
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            className="btn"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
