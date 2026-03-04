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
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push("pino-pretty", "encoding");
    return config;
  },
}

export default withSentryConfig(nextConfig, {
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
