import { cookieStorage, createStorage, connect, reconnect } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
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

