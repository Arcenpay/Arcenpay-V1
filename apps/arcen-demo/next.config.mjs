/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace SDK packages from source.
  // @arcenpay/node is intentionally excluded — it's server-only and pre-built.
  transpilePackages: ["@arcenpay/react", "@arcenpay/sdk"],

  // Keep server-only packages external (required at runtime, not bundled).
  serverExternalPackages: [
    "@arcenpay/node",
    "pino",
    "pino-pretty",
    "thread-stream",
    "lokijs",
    "encoding",
    "@reclaimprotocol/js-sdk",
  ],

  webpack(config) {
    // MetaMask SDK pulls in React Native async-storage as an optional dep.
    // The demo app doesn't use wallet connections, so stub it out.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
      "encoding": false,
      "@reclaimprotocol/js-sdk": false,
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding", "@reclaimprotocol/js-sdk");
    return config;
  },
};

export default nextConfig;
