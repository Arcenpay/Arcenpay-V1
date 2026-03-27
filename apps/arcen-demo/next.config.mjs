/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace SDK packages from source.
  // @arcenpay/node is intentionally excluded — it's server-only and pre-built.
  transpilePackages: ["@arcenpay/react", "@arcenpay/sdk"],

  // Keep server-only packages external (required at runtime, not bundled).
  serverExternalPackages: ["@arcenpay/node"],

  webpack(config) {
    // MetaMask SDK pulls in React Native async-storage as an optional dep.
    // The demo app doesn't use wallet connections, so stub it out.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@react-native-async-storage/async-storage": false,
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
