import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@arcenpay/react"],
  serverExternalPackages: ["pino", "pino-pretty"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.dribbble.com",
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Suppress warnings for OpenTelemetry instrumentation packages used by Inngest
    if (isServer) {
      config.ignoreWarnings = [
        { module: /opentelemetry/ },
        { module: /require-in-the-middle/ },
      ];
    }

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "wagmi/connectors": require.resolve("./lib/wagmi-connectors-shim.ts"),
      "zod$": require.resolve("zod/v4"),
      "zod/mini": require.resolve("zod/mini"),
      "zod/v3": require.resolve("zod/v3"),
      "zod/v4": require.resolve("zod/v4"),
      "zod/v4-mini": require.resolve("zod/v4-mini"),
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };

    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      net: false,
      tls: false,
    };

    config.externals.push("pino-pretty");

    return config;
  },
};

export default nextConfig;
