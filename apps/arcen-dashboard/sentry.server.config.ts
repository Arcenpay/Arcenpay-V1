// ============================================================
//  Sentry — Server-Side Configuration (Next.js server)
//  Captures API route errors, SIWE auth failures, and
//  unhandled promise rejections in the Node.js runtime.
//  PRD §13 — Error Tracking & Monitoring
// ============================================================

import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, Exception, StackFrame } from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

    environment: process.env.NODE_ENV,

    enabled: !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),

    // Ignore noise from common Node.js issues
    ignoreErrors: [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "AbortError",
    ],

    beforeSend(event: ErrorEvent) {
        // Strip stack trace internals from 500 error messages
        if (event.exception) {
            event.exception.values = event.exception.values?.map((v: Exception) => ({
                ...v,
                stacktrace: v.stacktrace
                    ? {
                        ...v.stacktrace,
                        frames: v.stacktrace.frames?.filter(
                            (f: StackFrame) => !f.filename?.includes("node_modules"),
                        ),
                    }
                    : v.stacktrace,
            }));
        }
        return event;
    },
});
