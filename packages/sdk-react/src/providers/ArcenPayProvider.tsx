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

function getChainId(): number {
  if (typeof process !== "undefined") {
    const env = process.env.NEXT_PUBLIC_CHAIN_ID;
    if (env) {
      const parsed = parseInt(env, 10);
      if (!isNaN(parsed) && [11155111, 84532, 8453, 5042002].includes(parsed)) {
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
  const configuredChainId =
    chainIdProp && isSupportedChainId(chainIdProp) ? chainIdProp : getChainId();
  const baseUrl = resolveDashboardBaseUrl();
  const wcProjectId = wcProp ?? getWalletConnectProjectId();
  const componentId =
    cidProp ??
    (typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "")
      : "");

  // ── Wagmi config ──────────────────────────────────────────────────────
  const wagmiConfig = useMemo(() => {
    const projectId = wcProjectId || "";

    const getRpcTransport = (id: number) => {
      const specific =
        typeof process !== "undefined"
          ? process.env[`NEXT_PUBLIC_RPC_URL_${id}`]
          : undefined;
      const global_ =
        typeof process !== "undefined"
          ? process.env.NEXT_PUBLIC_RPC_URL
          : undefined;
      const manifestRpc = (() => {
        try {
          return getChainEnvironment(id).services.rpcUrl;
        } catch {
          return "";
        }
      })();
      const url = specific ?? global_ ?? manifestRpc;
      return url ? http(url) : http();
    };

    return createConfig({
      chains: [sepolia, baseSepolia, base, arcTestnet],
      connectors: projectId
        ? [injected(), walletConnect({ projectId })]
        : [injected()],
      transports: {
        [sepolia.id]: getRpcTransport(sepolia.id),
        [baseSepolia.id]: getRpcTransport(baseSepolia.id),
        [base.id]: getRpcTransport(base.id),
        [arcTestnet.id]: getRpcTransport(arcTestnet.id),
      },
      ssr: true,
    });
  }, [wcProjectId]);

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
  publishableKey,
  userConfig,
}: ArcenPayRuntimeProps) {
  const { chainId: walletChainId, isConnected } = useAccount();
  const chainId =
    isConnected && walletChainId && isSupportedChainId(walletChainId)
      ? walletChainId
      : configuredChainId;

  // ── Session state ──────────────────────────────────────────────────────
  const [session, setSession] = useState<ArcenSessionValue>({
    isReady: false,
    token: null,
    company: null,
    user: null,
    identify: async () => {
      throw new Error("ArcenPayProvider is not ready");
    },
  });

  // ── identify() implementation ──────────────────────────────────────────
  const identify = useCallback(
    async (input: ArcenIdentifyInput) => {
      if (!publishableKey) {
        throw new Error(
          "ArcenPayProvider requires publishableKey to identify. Set NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY env var or pass it as a prop.",
        );
      }

      try {
        const res = await fetch(`${baseUrl}/api/v1/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${publishableKey}`,
          },
          body: JSON.stringify({
            event_type: "identify",
            ...(input.company ? { company: input.company } : {}),
            ...(input.user ? { user: input.user } : {}),
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        // Generate a short-lived access token for embed/hook calls
        const tokenRes = await fetch(`${baseUrl}/api/v1/access-tokens`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${publishableKey}`,
          },
          body: JSON.stringify({
            company: input.company ?? {},
            user: input.user ?? {},
            expiresIn: 3600,
          }),
        });

        if (!tokenRes.ok) {
          const err = (await tokenRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `Failed to create session token`);
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
          token: tokenData.data?.token ?? null,
          company: input.company ? { ...input.company } : null,
          user: input.user ? { ...input.user } : null,
          identify,
        });
      } catch (err) {
        console.error("[ArcenPayProvider] identify failed:", err);
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
            const detail = await res
              .json()
              .catch(() => ({} as { error?: string }));
            console.warn("[ArcenPayProvider] smart-account config request failed", {
              chainId,
              route,
              query,
              status: res.status,
              error: detail?.error ?? `HTTP ${res.status}`,
            });
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
      .catch((error) => {
        console.warn("[ArcenPayProvider] smart-account config fetch failed", {
          chainId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

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
    };
  }, [baseUrl, chainId, componentId, session, userConfig, smartAccount]);

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
