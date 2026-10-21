import { defineConfig } from "tsup";

/**
 * Keep the published bundle small.
 *
 * These are runtime dependencies of the SDK, not code that belongs in the
 * package. Bundling them produced a ~24 MB tarball that duplicated wagmi,
 * viem, ethers, the Stellar SDK, and the Solana web3 stack for every consumer.
 * `skipNodeModulesBundle` leaves all bare imports external so npm installs
 * them once and the package itself stays small.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/smart-account.ts", "src/bundler.ts"],
  format: ["cjs", "esm"],
  dts: { resolve: true },
  clean: true,
  skipNodeModulesBundle: true,
  external: ["react", "react-dom"],
});
