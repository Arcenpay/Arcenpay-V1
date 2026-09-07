import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base, baseSepolia } from "@reown/appkit/networks";
import { arcTestnet, botMainnet, botTestnet } from "@arcenpay/internal-core";
import {
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
  (DEFAULT_CHAIN_ID as number) === BOT_MAINNET_CHAIN_ID
    ? botMainnet
    : (DEFAULT_CHAIN_ID as number) === BOT_TESTNET_CHAIN_ID
      ? botTestnet
      : (DEFAULT_CHAIN_ID as number) === BASE_MAINNET_CHAIN_ID
        ? base
        : (DEFAULT_CHAIN_ID as number) === BASE_SEPOLIA_CHAIN_ID
          ? baseSepolia
          : botTestnet;

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks: networks as unknown as [typeof botMainnet, ...typeof networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
