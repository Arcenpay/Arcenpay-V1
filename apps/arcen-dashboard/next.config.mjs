import path from "node:path";
import { fileURLToPath } from "node:url";

const outputFileTracingRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot,
  transpilePackages: ["@arcenpay/react"],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
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
      "@react-native-async-storage/async-storage": false,
    };
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push(
      "pino-pretty",
      "lokijs",
      "encoding",
      "@reclaimprotocol/js-sdk",
    );
    return config;
  },
};

export default nextConfig;
