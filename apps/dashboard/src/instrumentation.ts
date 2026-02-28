// Sentry instrumentation for Next.js dashboard
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
// Requires: npm install @sentry/nextjs
//
// This file is auto-loaded by Next.js 15+ if present in the project root.
// To activate, set SENTRY_DSN in .env.local and install @sentry/nextjs.

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Skip if no DSN configured

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/nextjs") as {
      init: (opts: Record<string, unknown>) => void;
    };

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    });
  } catch {
    // @sentry/nextjs not installed — instrumentation disabled
  }
}
