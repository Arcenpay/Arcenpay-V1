import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // Allow cross-origin requests to the public v1 API (used by ArcenEmbed in customer apps)
  async headers() {
    return [
      {
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type,Authorization,X-Arcen-Company-Keys,X-Arcen-User-Keys" },
        ],
      },
    ];
  },
  // Server-only packages that should not be bundled (works for both Turbopack and webpack)
  serverExternalPackages: [
    "pino",
    "pino-pretty",
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
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // MetaMask SDK optional RN dependency is not needed for web builds.
      "@react-native-async-storage/async-storage": false,
    };
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
    };
    // @reclaimprotocol/js-sdk is an optional runtime dep — don't bundle it
    config.externals.push("pino-pretty", "lokijs", "encoding", "@reclaimprotocol/js-sdk");
    return config;
  },
}

const sentryBuildEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
);

const sentryWrappedConfig = withSentryConfig(nextConfig, {
  // Sentry organization + project (set via SENTRY_ORG + SENTRY_PROJECT env vars)
  silent: true,

  // Upload source maps only when SENTRY_AUTH_TOKEN is available
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Reduce bundle size by tree-shaking Sentry on the client
  disableLogger: true,
  automaticVercelMonitors: false,
});

export default sentryBuildEnabled ? sentryWrappedConfig : nextConfig;
