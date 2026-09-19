import { cookieStorage, createStorage, connect, reconnect } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { ChainController } from "@reown/appkit-controllers";
import { base, baseSepolia, mainnet, sepolia } from "@reown/appkit/networks";
import { arcTestnet, botMainnet, botTestnet } from "@arcenpay/internal-core";
import {
  ARC_TESTNET_CHAIN_ID,
  BOT_MAINNET_CHAIN_ID,
  BOT_TESTNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_CHAIN_ID,
} from "@/lib/default-chain";

export const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const networks = [
  baseSepolia,
  base,
  mainnet,
  sepolia,
  arcTestnet,
  botMainnet,
  botTestnet,
] as const;

export const defaultNetwork =
  (DEFAULT_CHAIN_ID as number) === ARC_TESTNET_CHAIN_ID
    ? arcTestnet
    : (DEFAULT_CHAIN_ID as number) === BASE_SEPOLIA_CHAIN_ID
      ? baseSepolia
      : (DEFAULT_CHAIN_ID as number) === BASE_MAINNET_CHAIN_ID
        ? base
        : (DEFAULT_CHAIN_ID as number) === BOT_MAINNET_CHAIN_ID
          ? botMainnet
          : (DEFAULT_CHAIN_ID as number) === BOT_TESTNET_CHAIN_ID
            ? botTestnet
            : baseSepolia;

type StorageDriver = {
  getItem(key: string): string | null | undefined | Promise<string | null | undefined>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

/**
 * Hybrid storage ensures session persistence across mobile app-switching.
 * Next.js SSR uses cookieStorage for server hydration, while localStorage
 * retains connection state when mobile browsers (Safari/Chrome) suspend
 * or freeze background tabs while switching to external wallet apps.
 */
const hybridStorage: StorageDriver = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    const cookieVal = cookieStorage.getItem(key);
    if (cookieVal) return cookieVal;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    try {
      cookieStorage.setItem(key, value);
    } catch {}
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    try {
      cookieStorage.removeItem(key);
    } catch {}
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
};

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: hybridStorage }),
  ssr: true,
  projectId,
  networks: networks as unknown as [typeof baseSepolia, ...typeof networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

/**
 * Patch UniversalProvider instances to automatically restore lost sessions from
 * SignClient storage and prevent "Please call connect() before request()" errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function patchUniversalProvider(provider: any) {
  if (!provider || provider.__arcenUniversalPatched) return;
  provider.__arcenUniversalPatched = true;

  const ensureSession = () => {
    if (!provider.session && provider.client?.session?.getAll) {
      try {
        const sessions = provider.client.session.getAll();
        if (Array.isArray(sessions) && sessions.length > 0) {
          provider.session = sessions[sessions.length - 1];
          if (typeof provider.createProviders === "function") {
            try {
              provider.createProviders();
            } catch {}
          }
        }
      } catch {}
    }
  };

  ensureSession();

  const origRequest = provider.request?.bind(provider);
  if (origRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.request = async function (payload: any, chain?: string, expiry?: number) {
      ensureSession();
      try {
        return await origRequest(payload, chain, expiry);
      } catch (err: any) {
        if (
          err?.message?.includes("before request()") ||
          err?.message?.includes("before enable()") ||
          err?.message?.includes("connect()")
        ) {
          ensureSession();
          if (provider.session) {
            return await origRequest(payload, chain, expiry);
          }
        }
        throw err;
      }
    };
  }

  const origEnable = provider.enable?.bind(provider);
  if (origEnable) {
    provider.enable = async function () {
      ensureSession();
      if (provider.session) {
        return await provider.requestAccounts?.();
      }
      try {
        return await origEnable();
      } catch (err: any) {
        if (
          err?.message?.includes("before enable") ||
          err?.message?.includes("connect()") ||
          err?.message?.includes("Session not initialized")
        ) {
          ensureSession();
          if (provider.session) {
            return await provider.requestAccounts?.();
          }
        }
        throw err;
      }
    };
  }

  const origDisconnect = provider.disconnect?.bind(provider);
  if (origDisconnect) {
    provider.disconnect = async function () {
      if (!provider.session) {
        try {
          await provider.cleanup?.();
        } catch {}
        return;
      }
      try {
        return await origDisconnect();
      } catch (err: any) {
        if (
          err?.message?.includes("before enable") ||
          err?.message?.includes("connect()") ||
          err?.message?.includes("Session not initialized")
        ) {
          try {
            await provider.cleanup?.();
          } catch {}
          return;
        }
        throw err;
      }
    };
  }
}

/**
 * Intercept and fix connector.getChainId to eliminate undefined return values
 * and chain mismatches caused by Reown AppKit's WalletConnectConnector bug.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function patchConnectorChainId(connector: any) {
  if (!connector || connector.__arcenChainIdPatched) return;
  connector.__arcenChainIdPatched = true;

  // 0. Disable isChainsStale to prevent Reown AppKit from destroying active sessions
  // when mobile wallets only approve a subset of chains (e.g. Ethereum Mainnet only)
  if (typeof connector.isChainsStale === "function") {
    connector.isChainsStale = async function () {
      return false;
    };
  }

  // 1. Wrap connector.getProvider to always patch the universalProvider instance
  const origGetProvider = connector.getProvider?.bind(connector);
  if (origGetProvider) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connector.getProvider = async function (...args: any[]) {
      const provider = await origGetProvider(...args);
      if (provider) {
        patchUniversalProvider(provider);
      }
      return provider;
    };
  }

  const origGetChainId = connector.getChainId?.bind(connector);

  connector.getChainId = async function () {
    let id: number | undefined;

    // 1. Try original getChainId
    try {
      if (origGetChainId) {
        id = await origGetChainId();
      }
    } catch {}

    if (typeof id === "number" && !isNaN(id) && id > 0) {
      return id;
    }

    // 2. Resolve from connector provider
    try {
      const provider = await connector.getProvider?.();
      if (provider) {
        // UniversalProvider (WalletConnect) direct property
        if (typeof provider.chainId === "number" && provider.chainId > 0) {
          id = provider.chainId;
        } else if (typeof provider.chainId === "string" && !isNaN(Number(provider.chainId))) {
          id = Number(provider.chainId);
        } else if (typeof provider.getDefaultChain === "function") {
          const defaultChain = provider.getDefaultChain();
          if (typeof defaultChain === "number" && defaultChain > 0) {
            id = defaultChain;
          } else if (typeof defaultChain === "string") {
            const parsed = parseInt(defaultChain.split(":").pop() || defaultChain, 10);
            if (!isNaN(parsed) && parsed > 0) id = parsed;
          }
        }

        // WalletConnect session namespaces
        if (!id && provider.session?.namespaces) {
          const eip155 =
            provider.session.namespaces.eip155 ||
            provider.session.namespaces["eip155"];
          // Try accounts first: e.g. "eip155:1:0xabc..." - tells us what chain the active account is on
          if (eip155?.accounts?.[0]) {
            const parts = eip155.accounts[0].split(":");
            if (parts.length >= 2) {
              const parsed = parseInt(parts[1], 10);
              if (!isNaN(parsed) && parsed > 0) id = parsed;
            }
          }
          // Try chains next: e.g. ["eip155:1", ...]
          if (!id && eip155?.chains?.[0]) {
            const parsed = parseInt(eip155.chains[0].split(":").pop() || "", 10);
            if (!isNaN(parsed) && parsed > 0) id = parsed;
          }
        }

        // Standard EVM provider RPC
        if (!id && typeof provider.request === "function") {
          try {
            const hexChainId = await provider.request({ method: "eth_chainId" });
            if (hexChainId) {
              const parsed =
                typeof hexChainId === "string"
                  ? parseInt(hexChainId, 16)
                  : Number(hexChainId);
              if (!isNaN(parsed) && parsed > 0) id = parsed;
            }
          } catch {}
        }
      }
    } catch {}

    // 3. Resolve from Wagmi connection state for this connector
    if (!id && typeof window !== "undefined") {
      try {
        const conn =
          wagmiConfig.state.connections.get(connector.uid) ??
          wagmiConfig.state.connections.get(wagmiConfig.state.current ?? "");
        if (conn?.chainId && typeof conn.chainId === "number" && conn.chainId > 0) {
          id = conn.chainId;
        }
      } catch {}
    }

    // 4. Resolve from wagmiConfig.state.chainId
    if (!id && typeof wagmiConfig.state.chainId === "number" && wagmiConfig.state.chainId > 0) {
      id = wagmiConfig.state.chainId;
    }

    // 5. Fallback to default network or Ethereum Mainnet (1)
    if (!id || isNaN(id) || id <= 0) {
      id = (DEFAULT_CHAIN_ID as number) || 1;
    }

    // Synchronize AppKit ChainController if needed so AppKit UI stays in sync
    try {
      const activeNetwork = ChainController.getActiveCaipNetwork();
      if (!activeNetwork || activeNetwork.id !== id) {
        const caipNetworks = ChainController.getCaipNetworks();
        const match = caipNetworks?.find(
          (c) => c.id === id || Number(c.id) === id || c.caipNetworkId === `eip155:${id}`,
        );
        if (match) {
          ChainController.setActiveCaipNetwork(match);
        }
      }
    } catch {}

    return id;
  };
}

// Immediately patch all current connectors
wagmiConfig.connectors.forEach(patchConnectorChainId);

// Intercept connector store to automatically patch any newly created/registered connectors
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internalConnectors = (wagmiConfig as any)._internal?.connectors;
  if (internalConnectors) {
    if (typeof internalConnectors.subscribe === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      internalConnectors.subscribe((connectors: any[]) => {
        if (Array.isArray(connectors)) {
          connectors.forEach(patchConnectorChainId);
        }
      });
    }
    if (typeof internalConnectors.setup === "function") {
      const origSetup = internalConnectors.setup.bind(internalConnectors);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      internalConnectors.setup = function (connector: any) {
        const result = origSetup(connector);
        patchConnectorChainId(result);
        return result;
      };
    }
  }
} catch {}


const EIP155_CHAINS = [
  "eip155:1",
  "eip155:8453",
  "eip155:84532",
  "eip155:11155111",
  "eip155:5042002",
  "eip155:677",
  "eip155:968",
];

const EIP155_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "eth_sign",
  "eth_accounts",
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_getPermissions",
  "wallet_requestPermissions",
  "wallet_watchAsset",
  "wallet_getCapabilities",
  "wallet_getCallsStatus",
  "wallet_sendCalls",
];

const EIP155_EVENTS = ["accountsChanged", "chainChanged"];

const EIP155_RPC_MAP: Record<string, string> = {
  "1": "https://ethereum-rpc.publicnode.com",
  "8453": "https://mainnet.base.org",
  "84532": "https://base-sepolia-rpc.publicnode.com",
  "11155111": "https://ethereum-sepolia-rpc.publicnode.com",
  "5042002": "https://rpc.testnet.arc.network",
  "677": "https://rpc.botchain.ai",
  "968": "https://rpc.testnet.botchain.ai",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchSignClient(client: any) {
  if (!client || client.__arcenPatched) return;
  client.__arcenPatched = true;

  // Clean metadata redirect to prevent wallet attempts to open non-existent native schemes
  try {
    if (client.metadata?.redirect?.native === "arcenpay://") {
      delete client.metadata.redirect.native;
    }
  } catch {}

  const origClientConnect = client.connect.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.connect = async function (params: any = {}) {
    const existingOptional = params?.optionalNamespaces || {};
    const existingEip155 = existingOptional.eip155 || {};
    const mergedEip155 = {
      ...existingEip155,
      chains: Array.from(
        new Set([...(existingEip155.chains || []), ...EIP155_CHAINS]),
      ),
      methods: Array.from(
        new Set([...(existingEip155.methods || []), ...EIP155_METHODS]),
      ),
      events: Array.from(
        new Set([...(existingEip155.events || []), ...EIP155_EVENTS]),
      ),
      rpcMap: { ...EIP155_RPC_MAP, ...(existingEip155.rpcMap || {}) },
    };
    const enhancedParams = {
      ...params,
      optionalNamespaces: {
        ...existingOptional,
        eip155: mergedEip155,
      },
    };
    return origClientConnect(enhancedParams);
  };
}

// Ensure Wagmi immediately reconnects when universalProvider emits 'connect' or session updates.
// Also intercepts universalProvider.connect / client.connect to guarantee EVM namespaces
// are never omitted (preventing MetaMask Mobile "Permission updated (empty)" scan bug).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origSetUniversalProvider = (wagmiAdapter as any).setUniversalProvider.bind(wagmiAdapter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(wagmiAdapter as any).setUniversalProvider = async function (universalProvider: any) {
  if (universalProvider) {
    patchUniversalProvider(universalProvider);
    // 0. Intercept universalProvider.disconnect and enable to prevent the WalletConnect bug:
    // "Please call connect() before enable()" when session is uninitialized or already disconnected.
    if (typeof universalProvider.disconnect === "function") {
      const origDisconnect = universalProvider.disconnect.bind(universalProvider);
      universalProvider.disconnect = async function () {
        if (!universalProvider.session) {
          try {
            await universalProvider.cleanup?.();
          } catch {}
          return;
        }
        try {
          return await origDisconnect();
        } catch (err: any) {
          if (
            err?.message?.includes("before enable") ||
            err?.message?.includes("connect()") ||
            err?.message?.includes("Session not initialized")
          ) {
            console.warn("[WagmiAdapter] Suppressed universalProvider.disconnect error:", err?.message);
            try {
              await universalProvider.cleanup?.();
            } catch {}
            return;
          }
          throw err;
        }
      };
    }

    if (typeof universalProvider.enable === "function") {
      const origEnable = universalProvider.enable.bind(universalProvider);
      universalProvider.enable = async function () {
        try {
          return await origEnable();
        } catch (err: any) {
          if (
            err?.message?.includes("before enable") ||
            err?.message?.includes("connect()") ||
            err?.message?.includes("Session not initialized")
          ) {
            console.warn("[WagmiAdapter] Handled universalProvider.enable error:", err?.message);
            if (!universalProvider.session && typeof universalProvider.connect === "function") {
              await universalProvider.connect();
              return await universalProvider.requestAccounts?.();
            }
          }
          throw err;
        }
      };
    }

    // 1. Intercept universalProvider.connect to inject complete EIP-155 namespaces
    if (typeof universalProvider.connect === "function") {
      const origConnect = universalProvider.connect.bind(universalProvider);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      universalProvider.connect = async function (opts: any = {}) {
        const existingOptional = opts?.optionalNamespaces || {};
        const existingEip155 = existingOptional.eip155 || {};
        const mergedEip155 = {
          ...existingEip155,
          chains: Array.from(
            new Set([...(existingEip155.chains || []), ...EIP155_CHAINS]),
          ),
          methods: Array.from(
            new Set([...(existingEip155.methods || []), ...EIP155_METHODS]),
          ),
          events: Array.from(
            new Set([...(existingEip155.events || []), ...EIP155_EVENTS]),
          ),
          rpcMap: { ...EIP155_RPC_MAP, ...(existingEip155.rpcMap || {}) },
        };
        const enhancedOpts = {
          ...opts,
          optionalNamespaces: {
            ...existingOptional,
            eip155: mergedEip155,
          },
        };

        if (universalProvider.client) {
          patchSignClient(universalProvider.client);
        }

        return origConnect(enhancedOpts);
      };
    }

    if (universalProvider.client) {
      patchSignClient(universalProvider.client);
    }

    // 2. Ensure Wagmi connects whenever the session is approved, updated, or accounts change
    const syncWagmiSession = async () => {
      try {
        const connector = wagmiConfig.connectors.find(
          (c) => c.id === "walletConnect",
        );
        if (connector) {
          patchConnectorChainId(connector);
        }

        // Synchronize AppKit's ChainController with the active chain from session
        try {
          const eip155 = universalProvider.session?.namespaces?.eip155;
          let sessionChainId: number | undefined;
          if (typeof universalProvider.chainId === "number" && universalProvider.chainId > 0) {
            sessionChainId = universalProvider.chainId;
          } else if (eip155?.accounts?.[0]) {
            const parsed = parseInt(eip155.accounts[0].split(":")[1] || "", 10);
            if (!isNaN(parsed) && parsed > 0) sessionChainId = parsed;
          } else if (eip155?.chains?.[0]) {
            const parsed = parseInt(eip155.chains[0].split(":").pop() || "", 10);
            if (!isNaN(parsed) && parsed > 0) sessionChainId = parsed;
          }
          if (sessionChainId) {
            const match = ChainController.getCaipNetworks().find(
              (c) => c.id === sessionChainId || Number(c.id) === sessionChainId || c.caipNetworkId === `eip155:${sessionChainId}`,
            );
            if (match) {
              ChainController.setActiveCaipNetwork(match);
            }
          }
        } catch {}

        if (!connector) return;

        if (wagmiConfig.state.status !== "connected") {
          console.info(
            "[WagmiAdapter] WalletConnect session event received. Reconnecting Wagmi...",
          );
          try {
            await reconnect(wagmiConfig, { connectors: [connector] });
          } catch {
            await connect(wagmiConfig, { connector });
          }
        }
      } catch (err) {
        console.warn("[WagmiAdapter] Auto-reconnect failed:", err);
      } finally {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any)?.__ARCEN_APPKIT__?.close();
        } catch {}
      }
    };

    if (typeof universalProvider.on === "function") {
      universalProvider.on("connect", syncWagmiSession);
      universalProvider.on("accountsChanged", syncWagmiSession);
      universalProvider.on("chainChanged", syncWagmiSession);
    }
    if (universalProvider.client?.on) {
      universalProvider.client.on("session_update", syncWagmiSession);
      universalProvider.client.on("session_extend", syncWagmiSession);
      universalProvider.client.on("session_event", syncWagmiSession);
    }
  }
  return await origSetUniversalProvider(universalProvider);
};

// Safely wrap connectWalletConnect to prevent post-connection switchChain failures
// from aborting the connection when mobile wallets (e.g. MetaMask Mobile) connect
// on their active chain (e.g. Mainnet/Sepolia) instead of the requested chain.
const originalConnectWalletConnect = wagmiAdapter.connectWalletConnect.bind(wagmiAdapter);
wagmiAdapter.connectWalletConnect = async function (chainId: number | string | undefined) {
  try {
    return await originalConnectWalletConnect(chainId);
  } catch (err) {
    // If the connector actually succeeded in connecting (connection exists in wagmiConfig),
    // do not throw! The switchChain failure should not abort the successful wallet connection.
    const connections = Array.from(wagmiConfig.state.connections.values());
    const wcConn = connections.find((c) => c.connector.id === "walletConnect");
    if (wcConn && wcConn.accounts && wcConn.accounts.length > 0) {
      console.warn(
        "[WagmiAdapter] switchChain failed after connect, but wallet is connected:",
        err,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wcConnector = (wagmiAdapter as any).getWalletConnectConnector?.();
      let clientId: string | null = null;
      try {
        clientId = await wcConnector?.provider?.client?.core?.crypto?.getClientId();
      } catch {}
      return { clientId: clientId ?? "" };
    }
    throw err;
  }
};

