// ============================================================
//  Sentry — Edge Runtime Configuration
//  Covers middleware.ts execution on the Vercel Edge runtime.
//  PRD §13 — Error Tracking & Monitoring
// ============================================================

import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Lower sample rate for high-volume edge calls
    tracesSampleRate: 0.05,

    environment: process.env.NODE_ENV,

    enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
});
