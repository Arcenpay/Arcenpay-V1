import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia } from "@reown/appkit/networks";
import { arcTestnet } from "@arcenpay/internal-core";

export const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const networks = [arcTestnet, baseSepolia] as const;
export const defaultNetwork = arcTestnet;

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks: networks as unknown as [typeof arcTestnet, typeof baseSepolia],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
