import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { withSentryConfig } from "@sentry/nextjs";

const require = createRequire(import.meta.url);
const outputFileTracingRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot,
  transpilePackages: [
    "@arcenpay/react",
    "@arcenpay/internal-core",
    "@arcenpay/shared-types",
  ],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    // Security headers applied to every route. Deliberately conservative:
    //
    //  * No `frame-ancestors` / `X-Frame-Options` — the dashboard is embedded in
    //    an iframe on purpose (ArcenEmbed, and the go-live embed preview in the
    //    admin console). Framing protection must be scoped to the non-embed
    //    routes, not applied globally, or embedding breaks.
    //  * No `default-src` / `script-src` CSP — Reown/WalletConnect, Turnstile,
    //    GA and Sentry all inject script, so a strict policy needs a report-only
    //    rollout first.
    //
    // The directives below are safe today and close real gaps: transport
    // downgrade (HSTS), MIME sniffing, referrer leakage, device-permission
    // abuse, and <base>/<object> injection.
    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'" },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  serverExternalPackages: [
    "thread-stream",
    "lokijs",
    "encoding",
    "@reclaimprotocol/js-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "thread-stream": "./lib/stubs/thread-stream-stub.js",
      "@reclaimprotocol/js-sdk": "./lib/stubs/reclaim-sdk-stub.js",
    },
  },
  experimental: {
    cpus: 2,
    optimizePackageImports: ["recharts", "lucide-react", "date-fns"],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // WalletConnect's logger also enters the SSR bundle. Use Pino's real
      // console logger there so OpenNext never bundles Node-only transports
      // (including the optional, uninstalled pino-pretty package).
      "pino$": require.resolve("pino/browser"),
      "@react-native-async-storage/async-storage": false,
    };
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push(
      "lokijs",
      "encoding",
      "@reclaimprotocol/js-sdk",
    );
    return config;
  },
};

const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: hasSentryAuth,
  tunnelRoute: "/monitoring",
  sourcemaps: {
    disable: !hasSentryAuth,
  },
  webpack: {
    automaticVercelMonitors: hasSentryAuth,
    reactComponentAnnotation: {
      enabled: hasSentryAuth,
    },
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
