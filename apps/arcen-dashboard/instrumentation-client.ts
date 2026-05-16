import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentryEnabled = process.env.NODE_ENV === "production" && !!sentryDsn;

Sentry.init({
  dsn: sentryDsn,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  environment: process.env.NODE_ENV,
  enabled: sentryEnabled,
  beforeSend(event: ErrorEvent) {
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((breadcrumb: Breadcrumb) => ({
        ...breadcrumb,
        data: breadcrumb.data
          ? Object.fromEntries(
              Object.entries(breadcrumb.data).map(([key, value]) => [
                key,
                typeof value === "string" &&
                value.startsWith("0x") &&
                value.length === 42
                  ? `${value.slice(0, 6)}...${value.slice(-4)}`
                  : value,
              ]),
            )
          : breadcrumb.data,
      }));
    }

    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
