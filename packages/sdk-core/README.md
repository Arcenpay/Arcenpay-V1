# @arcenpay/sdk

> ArcenPay core SDK — shared types, contract ABIs, chain configs, and error utilities.

This is the foundation package used by all other ArcenPay SDK packages. Install it if you're building a custom integration that doesn't use React or Node.js.

## Installation

```bash
npm install @arcenpay/sdk viem
```

## Quick Start

```typescript
import {
  getContractAddresses,
  getChainEnvironment,
  PlanFactoryABI,
  parseContractError,
  ArcenPayError,
} from "@arcenpay/sdk";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "@arcenpay/sdk";

// Get deployed contract addresses for a chain
const addresses = getContractAddresses(84532); // Base Sepolia
console.log(addresses.planFactory); // 0x...

// Create a viem public client with ArcenPay chain config
const client = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

// Use PlanFactory ABI to read a plan
const plan = await client.readContract({
  address: addresses.planFactory,
  abi: PlanFactoryABI,
  functionName: "getPlan",
  args: [1n],
});
```

## Supported Chains

| Chain | Chain ID | Type |
|-------|----------|------|
| Ethereum Sepolia | `11155111` | Testnet |
| Base Sepolia | `84532` | Testnet |
| Base Mainnet | `8453` | Production |

## Contract ABIs

```typescript
import {
  PlanFactoryABI,
  SubscriptionRegistryABI,
  ERC7579AutopayModuleABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  FeeCollectorABI,
  MirrorRegistryABI,
  YieldSessionVaultABI,
} from "@arcenpay/sdk";
```

## Chain Configs

```typescript
import {
  sepolia,        // Ethereum Sepolia (viem Chain)
  baseSepolia,    // Base Sepolia (viem Chain)
  baseMainnet,    // Base Mainnet (viem Chain)
  SUPPORTED_CHAINS,
  TOKENS,         // USDC addresses per chain
  DEFAULT_CHAIN_ID,
  getChain,
  getBlockExplorerUrl,
} from "@arcenpay/sdk";

// USDC addresses
console.log(TOKENS[8453].USDC);  // 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

## Contract Addresses

Addresses are baked in for Sepolia (deployed). For Base Sepolia and Base Mainnet, set environment variables after deployment:

```bash
# Override contract addresses for Base mainnet
ARCENPAY_CONTRACT_8453_planFactory=0xYourAddress
ARCENPAY_CONTRACT_8453_subscriptionRegistry=0xYourAddress
# ...etc
```

## Error Handling

```typescript
import { parseContractError, normalizeError, ArcenPayError } from "@arcenpay/sdk";

try {
  await someContractCall();
} catch (err) {
  const message = parseContractError(err);
  // → "The plan is not currently accepting new subscribers."

  const normalized = normalizeError(err);
  if (normalized.code === "WALLET_REJECTED") {
    // user hit reject in MetaMask
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ARCENPAY_CONTRACT_<chainId>_<key>` | Override deployed contract address |
| `ARCENPAY_RPC_URL_<chainId>` | Override RPC URL for a specific chain |
| `ARCENPAY_RPC_URL` | Global RPC fallback |
| `ARCENPAY_FACILITATOR_URL` | Facilitator service URL |

## Protocol Constants

```typescript
import {
  SUBSCRIPTION_FEE_BPS,  // 50n (0.5%)
  SETTLEMENT_FEE_BPS,    // 30n (0.3%)
  BPS_DENOMINATOR,       // 10_000n
  MONTHLY_INTERVAL,      // 2_592_000 seconds
  YEARLY_INTERVAL,       // 31_536_000 seconds
} from "@arcenpay/sdk";
```

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
