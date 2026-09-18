import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, baseSepolia } from "@reown/appkit/networks";
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

export const networks = [botMainnet, botTestnet, arcTestnet, base, baseSepolia] as const;

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
  networks: networks as unknown as [typeof botMainnet, ...typeof networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
