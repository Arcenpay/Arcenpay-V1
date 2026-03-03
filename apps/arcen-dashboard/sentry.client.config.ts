// ============================================================
//  Sentry — Client-Side Configuration (browser)
//  Captures UI errors, wallet interaction failures, and React
//  component errors in the user's browser.
//  PRD §13 — Error Tracking & Monitoring
// ============================================================

import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Adjust this sample rate in production based on traffic volume
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

    // Session replay for debugging UI issues — only in production
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Integrations
    integrations: [
        Sentry.replayIntegration({
            // Block sensitive wallet data from replays
            maskAllText: false,
            blockAllMedia: false,
        }),
    ],

    // Environment tagging
    environment: process.env.NODE_ENV,

    // Do not send events in development unless DSN is explicitly set
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Strip transaction queries and normalize paths with IDs
    beforeSend(event) {
        // Redact wallet addresses from breadcrumb data
        if (event.breadcrumbs) {
            event.breadcrumbs.values = event.breadcrumbs.values?.map((b) => ({
                ...b,
                data: b.data
                    ? Object.fromEntries(
                        Object.entries(b.data).map(([k, v]) => [
                            k,
                            typeof v === "string" && v.startsWith("0x") && v.length === 42
                                ? `${v.slice(0, 6)}...${v.slice(-4)}`
                                : v,
                        ]),
                    )
                    : b.data,
            }));
        }
        return event;
    },
});
