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
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia, baseSepolia, base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContractAddresses, NetworkConfig, PlanTier } from "../sdk";
import {
  getChainEnvironment,
  DEFAULT_CHAIN_ID,
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
  /** ZeroDev smart-account infrastructure config (fetched from ArcenPay backend). */
  zeroDev: ZeroDevInfra;
}

export interface ZeroDevInfra {
  /** Bundler RPC URL for ERC-4337 user ops. */
  bundlerUrl: string;
  /** Paymaster RPC URL for gas sponsorship. */
  paymasterUrl: string;
  /** True while the config is still loading from the backend. */
  isReady: boolean;
  /** True if the ZeroDev project is in self-funded mode (account pays own gas). */
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
      if (!isNaN(parsed) && [11155111, 84532, 8453].includes(parsed)) {
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
  /** @deprecated Auto-detected. Only pass for local or staging overrides. */
  baseUrl?: string;
  /** @deprecated Auto-detected. */
  walletConnectProjectId?: string;
}

// ─── Provider Component ──────────────────────────────────────────────────────

export function ArcenPayProvider(props: ArcenPayProviderProps) {
  const {
    children,
    config: userConfig,
    publishableKey: pkProp,
    chainId: chainIdProp,
    baseUrl: baseUrlProp,
    walletConnectProjectId: wcProp,
    componentId: cidProp,
  } = props;

  // Resolve configuration — explicit props first, then env vars, then defaults
  const publishableKey = pkProp ?? getPublishableKey() ?? "";
  const chainId = chainIdProp ?? getChainId();
  const baseUrl = baseUrlProp ?? resolveDashboardBaseUrl();
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
      chains: [sepolia, baseSepolia, base],
      connectors: projectId
        ? [injected(), walletConnect({ projectId })]
        : [injected()],
      transports: {
        [sepolia.id]: getRpcTransport(sepolia.id),
        [baseSepolia.id]: getRpcTransport(baseSepolia.id),
        [base.id]: getRpcTransport(base.id),
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

  // ── ZeroDev infra config ───────────────────────────────────────────────
  const [zeroDev, setZeroDev] = useState<ZeroDevInfra>({
    bundlerUrl: "",
    paymasterUrl: "",
    isReady: false,
  });

  useEffect(() => {
    if (!baseUrl || !chainId) return;

    let cancelled = false;
    fetch(`${baseUrl}/api/v1/public/zerodev-config?chainId=${chainId}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { bundlerUrl?: string; paymasterUrl?: string; selfFunded?: boolean };
        };
        if (cancelled) return;
        if (body.data?.bundlerUrl && body.data?.paymasterUrl) {
          setZeroDev({
            bundlerUrl: body.data.bundlerUrl,
            paymasterUrl: body.data.paymasterUrl,
            selfFunded: body.data.selfFunded ?? false,
            isReady: true,
          });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
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
      zeroDev,
    };
  }, [baseUrl, chainId, session, componentId, userConfig, zeroDev]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ArcenPayContext.Provider value={contextValue}>
          {children}
        </ArcenPayContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
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
