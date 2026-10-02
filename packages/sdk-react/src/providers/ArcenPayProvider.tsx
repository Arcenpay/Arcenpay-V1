"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { WagmiProvider, createConfig, http, useAccount } from "wagmi";
import { sepolia, baseSepolia, base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContractAddresses, NetworkConfig, PlanTier } from "../sdk";
import {
  arcTestnet,
  botMainnet,
  botTestnet,
  getChainEnvironment,
  DEFAULT_CHAIN_ID,
  isSupportedChainId,
  validateChainEnvironment,
} from "../sdk";

// ============================================================
//  ArcenPayProvider — Simplified Root Provider
//  One prop: publishableKey. Everything else auto-detected.
// ============================================================

export interface ArcenPayContextValue {
  session: ArcenSessionValue;
  identify: ArcenSessionValue["identify"];
  baseUrl: string;
  config: ArcenPayConfig;
  contracts: ContractAddresses;
  network: NetworkConfig;
  isTestnet: boolean;
  /** Resolved component ID for ArcenEmbed. */
  componentId: string;
  /** Smart-account infrastructure config (fetched from ArcenPay backend). */
  smartAccount: SmartAccountInfra;
  /**
   * Publishable key (pk_live_/pk_test_) — safe to expose in the browser.
   * Used as the Authorization credential for client-safe, customer-scoped
   * reads when no identify() session token exists.
   */
  publishableKey: string;
}

export interface SmartAccountInfra {
  /** Hosted provider backing the smart-account RPC endpoints. */
  provider?: "pimlico";
  /** Bundler RPC URL for ERC-4337 user ops. */
  bundlerUrl: string;
  /** Paymaster RPC URL for gas sponsorship. */
  paymasterUrl: string;
  /** True while the config is still loading from the backend. */
  isReady: boolean;
  /** True if the hosted provider is in self-funded mode (account pays own gas). */
  selfFunded?: boolean;
}

export interface ArcenPayConfig {
  network: NetworkConfig;
  litNetwork?: string;
  tablelandConfig?: {
    providerUrl?: string;
    featureFlagsEndpoint?: string;
  };
  tierFeatureFallback?: Partial<
    Record<PlanTier, Record<string, boolean | string | number>>
  >;
}

export interface ArcenSessionValue {
  /** Whether the provider is initialized and ready */
  isReady: boolean;
  /** Current session token (auto-managed) */
  token: string | null;
  /** Identified company */
  company: ArcenCompanyIdentity | null;
  /** Identified user */
  user: ArcenUserIdentity | null;
  /** Last identify error message, or null if identify succeeded */
  identifyError: string | null;
  /** Whether an identify call is currently in flight */
  isIdentifying: boolean;
  /**
   * Identify a company/user to establish context for all hooks/components.
   * Call once after your app's auth flow resolves.
   */
  identify: (input: ArcenIdentifyInput) => Promise<void>;
}

export interface ArcenCompanyIdentity {
  id?: string;
  wallet?: string;
  email?: string;
  name?: string;
  traits?: Record<string, unknown>;
}

export interface ArcenUserIdentity {
  id?: string;
  clerkUserId?: string;
  wallet?: string;
  email?: string;
  name?: string;
}

export interface ArcenIdentifyInput {
  company?: ArcenCompanyIdentity;
  user?: ArcenUserIdentity;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

import { resolveDashboardBaseUrl } from "../lib/api";
import { createIdentifyCoordinator } from "../lib/identify-coordinator";

const ARCENPAY_WAGMI_CHAINS = [sepolia, baseSepolia, base, arcTestnet, botTestnet, botMainnet] as const;
const wagmiConfigCache = new Map<string, ReturnType<typeof createConfig>>();

const IDENTIFY_TIMEOUT_MS = 20_000;

function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? IDENTIFY_TIMEOUT_MS;
  const controller = new AbortController();
  const { signal: callerSignal, ...rest } = options;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const mergedSignal = callerSignal
    ? composeAbortSignals(callerSignal, controller.signal)
    : controller.signal;

  return fetch(url, { ...rest, signal: mergedSignal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

function composeAbortSignals(
  a: AbortSignal,
  b: AbortSignal,
): AbortSignal {
  if (a.aborted || b.aborted) {
    return AbortSignal.abort();
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    detail?: string;
    message?: string;
  };

  return payload.detail ?? payload.error ?? payload.message ?? fallback;
}

function getRpcTransport(id: number, rpcOverrides?: Record<number, string>) {
  // Precedence: explicit provider prop > env var > chain manifest default.
  // The prop exists so applications can point the SDK at their own RPC without
  // being forced to set build-time NEXT_PUBLIC_ env vars.
  const override = rpcOverrides?.[id];
  const specific =
    typeof process !== "undefined"
      ? process.env[`NEXT_PUBLIC_RPC_URL_${id}`]
      : undefined;
  const global_ =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_RPC_URL : undefined;
  const manifestRpc = (() => {
    try {
      return getChainEnvironment(id).services.rpcUrl;
    } catch {
      return "";
    }
  })();
  const url = override ?? specific ?? global_ ?? manifestRpc;

  return url ? http(url) : http();
}

function getOrCreateWagmiConfig(
  walletConnectProjectId?: string,
  rpcUrls?: Record<number, string>,
) {
  // The resolved RPC set is part of the cache key: two providers configured with
  // different overrides must not share a wagmi config.
  const cacheKey = `${walletConnectProjectId ?? ""}|${JSON.stringify(rpcUrls ?? {})}`;
  const cachedConfig = wagmiConfigCache.get(cacheKey);

  if (cachedConfig) {
    return cachedConfig;
  }

  const projectId = walletConnectProjectId || "";
  const config = createConfig({
    chains: ARCENPAY_WAGMI_CHAINS,
    connectors: projectId
      ? [
          injected(),
          walletConnect({
            projectId,
            metadata: {
              name: "ArcenPay",
              description: "ArcenPay Web3 Entitlement & Billing Platform",
              url: "https://app.arcenpay.com",
              icons: ["https://app.arcenpay.com/apple-icon.png"],
            },
          }),
        ]
      : [injected()],
    transports: {
      [sepolia.id]: getRpcTransport(sepolia.id, rpcUrls),
      [baseSepolia.id]: getRpcTransport(baseSepolia.id, rpcUrls),
      [base.id]: getRpcTransport(base.id, rpcUrls),
      [arcTestnet.id]: getRpcTransport(arcTestnet.id, rpcUrls),
      [botTestnet.id]: getRpcTransport(botTestnet.id, rpcUrls),
      [botMainnet.id]: getRpcTransport(botMainnet.id, rpcUrls),
    },
    ssr: true,
  });

  wagmiConfigCache.set(cacheKey, config);

  return config;
}

function getChainId(): number {
  if (typeof process !== "undefined") {
    const env = process.env.NEXT_PUBLIC_CHAIN_ID;
    if (env) {
      const parsed = parseInt(env, 10);
      if (!isNaN(parsed) && isSupportedChainId(parsed)) {
        return parsed;
      }
    }
  }
  return DEFAULT_CHAIN_ID;
}

function getWalletConnectProjectId(): string | undefined {
  if (typeof process !== "undefined") {
    return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;
  }
  return undefined;
}

function getPublishableKey(): string | undefined {
  if (typeof process !== "undefined") {
    return (
      process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY ||
      process.env.ARCENPAY_API_KEY ||
      undefined
    );
  }
  return undefined;
}

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Deduplication key for `identify()`.
 *
 * Two calls with the same key describe the same billing subject, so the second
 * one must be a no-op rather than another pair of network round-trips.
 */
function buildIdentifyKey(input: ArcenIdentifyInput): string {
  const company = input.company ?? {};
  const user = input.user ?? {};
  return [
    company.id ?? "",
    company.wallet?.toLowerCase() ?? "",
    company.email?.toLowerCase() ?? "",
    user.id ?? "",
    user.wallet?.toLowerCase() ?? "",
    user.email?.toLowerCase() ?? "",
  ].join("|");
}

/**
 * True when two session objects carry the same *observable* values.
 *
 * Used to bail out of `setState` when a write would change nothing. Returning
 * the previous object from an updater makes React skip the re-render entirely,
 * which is what keeps the context value referentially stable.
 */
function sessionEquals(a: ArcenSessionValue, b: ArcenSessionValue): boolean {
  return (
    a.isReady === b.isReady &&
    a.isIdentifying === b.isIdentifying &&
    a.identifyError === b.identifyError &&
    a.token === b.token &&
    a.identify === b.identify &&
    companyEquals(a.company, b.company) &&
    userEquals(a.user, b.user)
  );
}

function companyEquals(
  a: ArcenCompanyIdentity | null,
  b: ArcenCompanyIdentity | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.wallet === b.wallet &&
    a.email === b.email &&
    a.name === b.name
  );
}

function userEquals(
  a: ArcenUserIdentity | null,
  b: ArcenUserIdentity | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.clerkUserId === b.clerkUserId &&
    a.wallet === b.wallet &&
    a.email === b.email &&
    a.name === b.name
  );
}

const ArcenPayContext = createContext<ArcenPayContextValue | null>(null);

// ─── Provider Props ──────────────────────────────────────────────────────────

export interface ArcenPayProviderProps {
  children: ReactNode;
  /** Optional config overrides for advanced/custom integrations. */
  config?: Partial<ArcenPayConfig>;
  /**
   * API key from the ArcenPay dashboard (Settings → API Keys).
   * This is the ONLY required prop. Everything else is auto-detected.
   */
  publishableKey?: string;
  /**
   * Component ID for ArcenEmbed.
   * Reads NEXT_PUBLIC_ARCENPAY_COMPONENT_ID env var by default.
   */
  componentId?: string;
  /** @deprecated Use env vars or defaults. Auto-detected from NEXT_PUBLIC_CHAIN_ID, defaults to Base Sepolia. */
  chainId?: number;
  /** @deprecated Auto-detected. */
  walletConnectProjectId?: string;
  /**
   * Per-chain RPC endpoint overrides, keyed by chain ID.
   *
   * Takes precedence over `NEXT_PUBLIC_RPC_URL_<chainId>`, `NEXT_PUBLIC_RPC_URL`,
   * and the built-in chain defaults. Use this to point the SDK at your own
   * node/plan (Alchemy, QuickNode, a private endpoint) or to keep traffic off a
   * default public RPC.
   *
   * @example
   * ```tsx
   * <ArcenPayProvider
   *   publishableKey={pk}
   *   rpcUrls={{ 677: "https://my-botchain-node.example/rpc" }}
   * />
   * ```
   */
  rpcUrls?: Record<number, string>;
}

interface ArcenPayRuntimeProps {
  children: ReactNode;
  baseUrl: string;
  componentId: string;
  configuredChainId: number;
  lockChainId: boolean;
  publishableKey: string;
  userConfig?: Partial<ArcenPayConfig>;
  rpcUrls?: Record<number, string>;
}

// ─── Provider Component ──────────────────────────────────────────────────────

export function ArcenPayProvider(props: ArcenPayProviderProps) {
  const {
    children,
    config: userConfig,
    publishableKey: pkProp,
    chainId: chainIdProp,
    walletConnectProjectId: wcProp,
    componentId: cidProp,
    rpcUrls,
  } = props;

  // Resolve configuration — explicit props first, then env vars, then defaults
  const publishableKey = pkProp ?? getPublishableKey() ?? "";
  const lockChainId = Boolean(
    chainIdProp && isSupportedChainId(chainIdProp),
  );
  const configuredChainId = lockChainId ? chainIdProp! : getChainId();
  const baseUrl = resolveDashboardBaseUrl();
  const wcProjectId = wcProp ?? getWalletConnectProjectId();
  const componentId =
    cidProp ??
    (typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "")
      : "");

  // ── Wagmi config ──────────────────────────────────────────────────────
  const wagmiConfig = useMemo(
    () => getOrCreateWagmiConfig(wcProjectId, rpcUrls),
    [wcProjectId, rpcUrls],
  );

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 5 * 60 * 1000 },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ArcenPayRuntime
          baseUrl={baseUrl}
          componentId={componentId}
          configuredChainId={configuredChainId}
          lockChainId={lockChainId}
          publishableKey={publishableKey}
          userConfig={userConfig}
          rpcUrls={rpcUrls}
        >
          {children}
        </ArcenPayRuntime>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ArcenPayRuntime({
  children,
  baseUrl,
  componentId,
  configuredChainId,
  lockChainId,
  publishableKey,
  userConfig,
  rpcUrls,
}: ArcenPayRuntimeProps) {
  const { chainId: walletChainId, isConnected } = useAccount();
  const [sessionChainId, setSessionChainId] = useState<number | null>(null);
  const chainId =
    sessionChainId ??
    (!lockChainId &&
    isConnected &&
    walletChainId &&
    isSupportedChainId(walletChainId)
      ? walletChainId
      : configuredChainId);

  // ── Session state ──────────────────────────────────────────────────────
  //
  // WHY `identify` MUST BE REFERENTIALLY STABLE
  // -------------------------------------------
  // `identify` is part of the public context value. Consumer code naturally
  // writes `useEffect(() => { arcen.identify(...) }, [arcen, address])` — a
  // completely reasonable React pattern. If `identify` re-mutates session state
  // on every call, that becomes an unbounded loop:
  //
  //   effect -> identify() -> setSession -> new context object
  //         -> effect re-fires -> identify() -> ...
  //
  // Each iteration used to fire TWO network requests (events + access-tokens).
  // Within seconds the browser's socket pool is exhausted and *every* fetch in
  // the host application starts failing with `net::ERR_INSUFFICIENT_RESOURCES`,
  // including unrelated third-party traffic.
  //
  // Three mechanisms make that impossible:
  //   1. `identify` is created once (stable deps) and never changes identity.
  //   2. Repeat calls for the same company/user are a NO-OP that returns the
  //      already-minted token — so an effect that re-fires costs nothing.
  //   3. Concurrent calls share a single in-flight promise, so N effects firing
  //      together produce ONE pair of requests.
  //
  // Callers therefore do NOT need a manual `useRef` latch.
  const [session, setSession] = useState<ArcenSessionValue>({
    isReady: false,
    token: null,
    company: null,
    user: null,
    identifyError: null,
    isIdentifying: false,
    identify: async () => {
      throw new Error("ArcenPayProvider is not ready");
    },
  });

  // Coordinates identify() calls: repeat calls for the same company/user are
  // no-ops, concurrent calls share one in-flight promise. See
  // ../lib/identify-coordinator.ts for the failure mode this prevents.
  const coordinatorRef = useRef(createIdentifyCoordinator<void>());
  const publishableKeyRef = useRef(publishableKey);
  const baseUrlRef = useRef(baseUrl);
  publishableKeyRef.current = publishableKey;
  baseUrlRef.current = baseUrl;

  // Re-arm the latch whenever there is no session token (first mount, logout,
  // expiry) so the next identify() genuinely re-runs.
  useEffect(() => {
    if (!session.token) {
      coordinatorRef.current.reset();
    }
  }, [session.token]);

  /** Writes a session patch, skipping the render when nothing observable changed. */
  const patchSession = useCallback(
    (patch: Partial<ArcenSessionValue>) => {
      setSession((current) => {
        const next = { ...current, ...patch };
        return sessionEquals(current, next) ? current : next;
      });
    },
    [],
  );

  // ── identify() implementation ──────────────────────────────────────────
  const identify = useCallback<ArcenSessionValue["identify"]>(
    async (input: ArcenIdentifyInput) => {
      const pk = publishableKeyRef.current;
      const url = baseUrlRef.current;
      const dedupKey = buildIdentifyKey(input);

      if (!pk) {
        const msg =
          "ArcenPayProvider requires publishableKey to identify. Set NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY env var or pass it as a prop.";
        setSession((current) => {
          const next = {
            ...current,
            isIdentifying: false,
            identifyError: msg,
          };
          return sessionEquals(current, next) ? current : next;
        });
        throw new Error(msg);
      }

      // (2)+(3) Deduplicate and coalesce: repeats replay, concurrent calls join.
      // `run` executes the task at most once per company/user key.
      await coordinatorRef.current.run(dedupKey, async () => {
        patchSession({ isIdentifying: true, identifyError: null });

        try {
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pk}`,
          };

          const res = await fetchWithTimeout(`${url}/api/v1/events`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              event_type: "identify",
              ...(input.company ? { company: input.company } : {}),
              ...(input.user ? { user: input.user } : {}),
            }),
          });

          if (!res.ok) {
            throw new Error(await readErrorMessage(res, `HTTP ${res.status}`));
          }

          // Generate a short-lived access token for embed/hook calls
          const tokenRes = await fetchWithTimeout(`${url}/api/v1/access-tokens`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              company: input.company ?? {},
              user: input.user ?? {},
              expiresIn: 3600,
            }),
          });

          if (!tokenRes.ok) {
            throw new Error(
              await readErrorMessage(tokenRes, "Failed to create session token"),
            );
          }

          const tokenData = (await tokenRes.json()) as {
            data?: {
              token?: string;
              company_id?: string;
              user_id?: string;
              chain_id?: number | null;
              chain_family?: string | null;
            };
          };

          const nextToken = tokenData.data?.token ?? null;
          if (tokenData.data?.chain_id && isSupportedChainId(tokenData.data.chain_id)) {
            setSessionChainId(tokenData.data.chain_id);
          }

          patchSession({
            isReady: true,
            isIdentifying: false,
            identifyError: null,
            token: nextToken,
            company: input.company ? { ...input.company } : null,
            user: input.user ? { ...input.user } : null,
          });
        } catch (err) {
          const message =
            err instanceof DOMException && err.name === "TimeoutError"
              ? "ArcenPay identify timed out. Check your network connection."
              : err instanceof Error
                ? err.message
                : "Failed to identify billing session.";

          setSession((current) => {
            const next = {
              ...current,
              isIdentifying: false,
              identifyError: message,
            };
            return sessionEquals(current, next) ? current : next;
          });
          throw err;
        }
      });
    },
    // Stable: `patchSession` has no dependencies, so this callback is created
    // exactly once. Referencing `identify` here would make it depend on itself.
    [patchSession],
  );

  // Expose `identify` through `session` for backwards compatibility. The
  // bail-out in `patchSession` means this produces at most one extra render,
  // and `identify` never changes identity, so it can never re-trigger itself.
  useEffect(() => {
    patchSession({ identify });
  }, [identify, patchSession]);

  // ── Smart-account infra config ────────────────────────────────────────
  const [smartAccount, setSmartAccount] = useState<SmartAccountInfra>({
    bundlerUrl: "",
    paymasterUrl: "",
    isReady: false,
  });

  useEffect(() => {
    if (!baseUrl || !chainId) {
      setSmartAccount({
        bundlerUrl: "",
        paymasterUrl: "",
        isReady: false,
      });
      return;
    }

    let cancelled = false;
    setSmartAccount({
      bundlerUrl: "",
      paymasterUrl: "",
      isReady: false,
    });

    const candidateRoutes = ["/api/v1/public/smart-account-config"];
    const candidateQueries = [
      `chainId=${chainId}`,
      `chainId=${chainId}&selfFunded=true`,
    ];

    Promise.all(
      candidateRoutes.flatMap((route) =>
        candidateQueries.map(async (query) => {
          const res = await fetch(`${baseUrl}${route}?${query}`);
          if (!res.ok) {
            return null;
          }
          const body = (await res.json()) as {
            data?: {
              provider?: "pimlico";
              bundlerUrl?: string;
              paymasterUrl?: string;
              selfFunded?: boolean;
            };
          };
          if (body.data?.bundlerUrl && body.data?.paymasterUrl) {
            return body.data;
          }
          return null;
        }),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const resolved = results.find((value) => Boolean(value));
        if (!resolved?.bundlerUrl || !resolved?.paymasterUrl) return;
        setSmartAccount({
          provider: resolved.provider,
          bundlerUrl: resolved.bundlerUrl,
          paymasterUrl: resolved.paymasterUrl,
          selfFunded: resolved.selfFunded ?? false,
          isReady: true,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [baseUrl, chainId]);

  // ── Protocol context ───────────────────────────────────────────────────
  const contextValue = useMemo<ArcenPayContextValue>(() => {
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV === "production"
    ) {
      validateChainEnvironment(chainId, {
        production: true,
        requiredServices: ["rpcUrl"],
      });
    }

    const manifest = getChainEnvironment(chainId);
    const contracts = manifest.contracts;

    const network: NetworkConfig = {
      chainId,
      name: manifest.chainName,
      // An explicit provider override wins over the manifest default so the
      // advertised RPC and the one wagmi actually uses cannot diverge.
      rpcUrl: rpcUrls?.[chainId] ?? manifest.services.rpcUrl,
      contracts,
    };

    const litNetwork =
      (typeof process !== "undefined"
        ? (process.env.NEXT_PUBLIC_LIT_NETWORK as string)
        : undefined) ?? "manzano";

    const config: ArcenPayConfig = {
      network,
      litNetwork: userConfig?.litNetwork ?? litNetwork,
      tablelandConfig: {
        providerUrl:
          userConfig?.tablelandConfig?.providerUrl ??
          manifest.services.facilitatorUrl,
        featureFlagsEndpoint: userConfig?.tablelandConfig?.featureFlagsEndpoint,
      },
      tierFeatureFallback: userConfig?.tierFeatureFallback,
    };

    return {
      session,
      // Always the real, stable callback — never a value read back out of
      // session state. Children's effects run BEFORE the parent's, so a child
      // that calls `arcen.identify()` on mount could otherwise observe the
      // placeholder stored in the initial state.
      identify,
      baseUrl,
      config,
      contracts,
      network,
      isTestnet: manifest.isTestnet,
      componentId,
      smartAccount,
      publishableKey,
    };
  }, [baseUrl, chainId, componentId, session, userConfig, smartAccount, publishableKey, rpcUrls]);

  return (
    <ArcenPayContext.Provider value={contextValue}>
      {children}
    </ArcenPayContext.Provider>
  );
}

// ─── useArcenPay hook ────────────────────────────────────────────────────────

/**
 * Access the full ArcenPay context.
 * Must be called inside an <ArcenPayProvider>.
 *
 * @example
 * const { session, identify } = useArcenPay();
 * await identify({ company: { id: "company_1" } });
 */
export function useArcenPay(): ArcenPayContextValue & {
  identify: ArcenSessionValue["identify"];
} {
  const context = useContext(ArcenPayContext);
  if (!context) {
    throw new Error("useArcenPay() must be used within an <ArcenPayProvider>");
  }
  return context;
}

/**
 * Returns ONLY the `identify` action.
 *
 * Prefer this over `useArcenPay().identify` when calling from an effect.
 * `useArcenPay()` returns the whole context object, whose identity changes
 * whenever session state changes — so `useEffect(..., [arcen])` re-runs on
 * every session update. The function returned here is referentially stable and
 * is safe to use as the sole dependency:
 *
 * ```tsx
 * const identify = useIdentify();
 * const { address } = useAccount();
 *
 * useEffect(() => {
 *   if (address) void identify({ company: { wallet: address } }).catch(() => {});
 * }, [identify, address]);   // no loop: identify never changes identity
 * ```
 *
 * Even if the effect does re-fire, the provider deduplicates by company+user,
 * so a repeated call for the same subject performs no network request.
 */
export function useIdentify(): ArcenSessionValue["identify"] {
  return useArcenPay().identify;
}
