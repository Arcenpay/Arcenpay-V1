import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
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
    config.externals.push("pino-pretty", "encoding");
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
