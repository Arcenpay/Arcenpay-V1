import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, baseSepolia } from "@reown/appkit/networks";
import { arcTestnet, botMainnet, botTestnet } from "@arcenpay/internal-core";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_CHAIN_ID,
} from "@/lib/default-chain";

export const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const networks = [arcTestnet, botTestnet, botMainnet, baseSepolia, base] as const;

export const defaultNetwork =
  DEFAULT_CHAIN_ID === BASE_MAINNET_CHAIN_ID
    ? base
    : DEFAULT_CHAIN_ID === BASE_SEPOLIA_CHAIN_ID
      ? baseSepolia
      : arcTestnet;

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks: networks as unknown as [typeof arcTestnet, ...typeof networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
