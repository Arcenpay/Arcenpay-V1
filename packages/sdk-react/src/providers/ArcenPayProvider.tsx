"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
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

function getRpcTransport(id: number) {
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
  const url = specific ?? global_ ?? manifestRpc;

  return url ? http(url) : http();
}

function getOrCreateWagmiConfig(walletConnectProjectId?: string) {
  const cacheKey = walletConnectProjectId ?? "";
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
      [sepolia.id]: getRpcTransport(sepolia.id),
      [baseSepolia.id]: getRpcTransport(baseSepolia.id),
      [base.id]: getRpcTransport(base.id),
      [arcTestnet.id]: getRpcTransport(arcTestnet.id),
      [botTestnet.id]: getRpcTransport(botTestnet.id),
      [botMainnet.id]: getRpcTransport(botMainnet.id),
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
}

interface ArcenPayRuntimeProps {
  children: ReactNode;
  baseUrl: string;
  componentId: string;
  configuredChainId: number;
  lockChainId: boolean;
  publishableKey: string;
  userConfig?: Partial<ArcenPayConfig>;
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
    () => getOrCreateWagmiConfig(wcProjectId),
    [wcProjectId],
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
}: ArcenPayRuntimeProps) {
  const { chainId: walletChainId, isConnected } = useAccount();
  const chainId =
    !lockChainId &&
    isConnected &&
    walletChainId &&
    isSupportedChainId(walletChainId)
      ? walletChainId
      : configuredChainId;

  // ── Session state ──────────────────────────────────────────────────────
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

  // ── identify() implementation ──────────────────────────────────────────
  const identify = useCallback(
    async (input: ArcenIdentifyInput) => {
      if (!publishableKey) {
        const msg =
          "ArcenPayProvider requires publishableKey to identify. Set NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY env var or pass it as a prop.";
        setSession((current) => ({
          ...current,
          isIdentifying: false,
          identifyError: msg,
        }));
        throw new Error(msg);
      }

      setSession((current) => ({
        ...current,
        isIdentifying: true,
        identifyError: null,
      }));

      try {
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publishableKey}`,
        };

        const res = await fetchWithTimeout(`${baseUrl}/api/v1/events`, {
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
        const tokenRes = await fetchWithTimeout(`${baseUrl}/api/v1/access-tokens`, {
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
          };
        };

        setSession({
          isReady: true,
          isIdentifying: false,
          identifyError: null,
          token: tokenData.data?.token ?? null,
          company: input.company ? { ...input.company } : null,
          user: input.user ? { ...input.user } : null,
          identify,
        });
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === "TimeoutError"
            ? "ArcenPay identify timed out. Check your network connection."
            : err instanceof Error
              ? err.message
              : "Failed to identify billing session.";

        setSession((current) => ({
          ...current,
          isIdentifying: false,
          identifyError: message,
        }));
        throw err;
      }
    },
    [publishableKey, baseUrl],
  );

  // Update identify reference in session state
  useEffect(() => {
    setSession((current) => ({
      ...current,
      identify,
    }));
  }, [identify]);

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
      rpcUrl: manifest.services.rpcUrl,
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
      identify: session.identify,
      baseUrl,
      config,
      contracts,
      network,
      isTestnet: manifest.isTestnet,
      componentId,
      smartAccount,
      publishableKey,
    };
  }, [baseUrl, chainId, componentId, session, userConfig, smartAccount, publishableKey]);

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
