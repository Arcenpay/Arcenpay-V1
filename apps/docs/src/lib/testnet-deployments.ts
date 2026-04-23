import { getContractAddresses } from "@arcenpay/sdk";

const sepolia = getContractAddresses(11155111);
const baseSepolia = getContractAddresses(84532);

export const TESTNET_NETWORK_ROWS = [
  { label: "Ethereum Sepolia", chainId: 11155111, contracts: sepolia },
  { label: "Base Sepolia", chainId: 84532, contracts: baseSepolia },
] as const;

export function getTestnetContractValue(
  key: keyof (typeof TESTNET_NETWORK_ROWS)[number]["contracts"],
  chainId: 11155111 | 84532,
) {
  const row = TESTNET_NETWORK_ROWS.find((network) => network.chainId === chainId);
  return row?.contracts[key] ?? "—";
}
