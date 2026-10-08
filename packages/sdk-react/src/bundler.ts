/**
 * Bundler integration helpers.
 *
 * WHY THIS EXISTS
 * ---------------
 * `@arcenpay/react` depends on `wagmi`, which depends on `@wagmi/connectors`,
 * which pulls in `@base-org/account`, `@walletconnect/*` and provider SDKs.
 * Some of those packages contain *optional* `require()` calls for modules they
 * only need on specific platforms:
 *
 *   - `@x402/*`                              (dynamic, inside @base-org/account)
 *   - `@react-native-async-storage/async-storage`  (React Native persistence)
 *   - `pino-pretty`                          (Node-only log transport)
 *
 * Webpack statically analyses every `require()` in `node_modules/` and *fails
 * the build* when one cannot be resolved — even when the call sits inside a
 * `try`/`catch` or an `if (process.env)` branch. The result is a hard
 * `Module not found: Can't resolve '@x402/fetch'` from an app that never
 * mentioned ArcenPay.
 *
 * These packages are already declared as OPTIONAL peer dependencies of this
 * package, which is the correct signal. Not every bundler honours that, so this
 * helper applies the equivalent alias configuration for you instead of making
 * every integrating team rediscover it:
 *
 * ```js
 * // next.config.mjs
 * import { withArcenPayNextConfig } from "@arcenpay/react/bundler";
 *
 * export default withArcenPayNextConfig({
 *   reactStrictMode: true,
 *   // ...your config
 * });
 * ```
 */

/**
 * Optional modules that must never break a consumer build.
 *
 * Aliasing a module to `false` tells webpack to replace the import with an empty
 * module. That is safe for all of these because they are only reached on
 * platforms/branches this SDK does not exercise in a browser bundle.
 */
export const ARCENPAY_OPTIONAL_MODULES = [
  "@x402/core",
  "@x402/fetch",
  "@x402/client",
  "@x402/server",
  "@x402/agent",
  "@react-native-async-storage/async-storage",
  "pino-pretty",
] as const;

/**
 * The alias map, framework-neutral. Drop this straight into any webpack
 * `resolve.alias`, or into a Turbopack/SWC configuration.
 */
export function arcenpayWebpackAliases(): Record<string, false> {
  const aliases: Record<string, false> = {};
  for (const moduleName of ARCENPAY_OPTIONAL_MODULES) {
    aliases[moduleName] = false;
  }
  return aliases;
}

interface WebpackResolvable {
  resolve?: { alias?: Record<string, unknown> };
  [key: string]: unknown;
}

/**
 * Applies the aliases to an existing webpack config object, preserving anything
 * already present. Returns the same object for chaining.
 */
export function applyArcenPayWebpackAliases<T extends WebpackResolvable>(config: T): T {
  const alias = { ...(config.resolve?.alias ?? {}) };
  for (const [moduleName, value] of Object.entries(arcenpayWebpackAliases())) {
    // Never clobber an alias the application set deliberately.
    if (!(moduleName in alias)) {
      alias[moduleName] = value;
    }
  }
  config.resolve = { ...(config.resolve ?? {}), alias };
  return config;
}

interface NextConfigShape {
  webpack?: (config: any, options: any) => any;
  turbopack?: { resolveAlias?: Record<string, unknown> };
  [key: string]: unknown;
}

/**
 * Wraps a Next.js config so ArcenPay's optional modules resolve cleanly under
 * both webpack and Turbopack, without the application writing any aliases.
 *
 * Existing `webpack` and `turbopack` configuration is preserved and composed.
 */
export function withArcenPayNextConfig<T extends NextConfigShape>(
  nextConfig: T = {} as T,
): T {
  const previousWebpack = nextConfig.webpack;

  return {
    ...nextConfig,

    webpack: (config: any, options: any) => {
      const resolved =
        typeof previousWebpack === "function"
          ? previousWebpack(config, options)
          : config;
      return applyArcenPayWebpackAliases(resolved ?? config);
    },

    turbopack: {
      ...(nextConfig.turbopack ?? {}),
      resolveAlias: {
        ...(nextConfig.turbopack?.resolveAlias ?? {}),
        // Turbopack has no "false" alias. Point the optional modules at an
        // empty module instead, which is the supported equivalent.
        ...Object.fromEntries(
          ARCENPAY_OPTIONAL_MODULES.map((moduleName) => [
            moduleName,
            "arcenpay:empty",
          ]),
        ),
      },
    },
  };
}
