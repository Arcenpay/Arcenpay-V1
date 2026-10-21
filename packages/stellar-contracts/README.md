# ArcenPay Stellar Soroban Contracts

Soroban Rust implementation of the ArcenPay Web3 Entitlement Layer smart contracts, ported from Solidity/EVM to Stellar Soroban.

> **Status: deployed on Stellar Testnet (`9000001`) only.** Stellar Mainnet (`9000000`) is not deployed yet. Contract ids for the testnet deployment are registered in `packages/internal-core/src/addresses.ts` and `packages/contracts/deployments/environment-manifest.json`.

## Architecture

```
packages/stellar-contracts/
├── Cargo.toml                          # Workspace manifest
├── common/                             # Shared crate (auth, token helpers, types)
│   └── src/
│       ├── lib.rs
│       ├── auth.rs                     # Admin, reentrancy, pause
│       ├── errors.rs                   # 41 error codes
│       ├── events.rs                   # Shared events
│       ├── token.rs                    # Stellar Asset Contract helpers
│       ├── types.rs                    # All shared data structures
│       └── upgrade.rs                  # Wasm upgrade utilities
└── contracts/
    ├── flag-registry/                  # On-chain feature flag defaults
    ├── plan-factory/                   # Provider registration + plan CRUD
    ├── fee-collector/                  # Protocol fee collection (tiered rates)
    ├── session-vault/                  # Pre-funded ZKVUB settlement vault
    ├── subscription-registry/          # Subscription ledger (replaces ERC-5643)
    ├── autopay-account/                # Auto-payment execution (replaces ERC-7579)
    ├── usage-verifier/                 # ZK proof verification + settlement
    └── mirror-registry/                # Multi-sig cross-chain bridge
```

## Contracts

| Contract | Lines | Solidity Original | Key Changes for Soroban |
|----------|-------|-------------------|------------------------|
| **flag-registry** | 210 | FlagRegistry (204 LOC) | Instance storage, `require_auth`, no NFT needed |
| **plan-factory** | 280 | PlanFactory (331 LOC) | Persistent entries per plan, no EIP-712 (native relay supported) |
| **fee-collector** | 310 | FeeCollector (293 LOC) | SAC transfers, instance storage for tier rates |
| **session-vault** | 340 | SessionVault (267 LOC) | SAC integration, deterministic session IDs, agent balance aggregation |
| **subscription-registry** | 450 | SubscriptionRegistry (493 LOC) | No ERC-721; Persistent ledger entries, cross-contract plan tier resolution |
| **autopay-account** | 460 | ERC7579AutopayModule (543 LOC) | No ERC-7579 module system; standalone account contract with velocity limits |
| **usage-verifier** | 340 | ZKUsageVerifier (225 LOC) | Native BLS12-381 Groth16, cross-contract settlement calls |
| **mirror-registry** | 440 | MirrorRegistry (279 LOC) | Multi-sig bridge with validator threshold (no Axelar/CCIP) |

## Key Differences from Solidity

| EVM/Solidity | Stellar/Soroban |
|---|---|
| `msg.sender` implicit | `address.require_auth()` explicit |
| `mapping(address => uint256)` | Persistent storage keys per entity |
| ERC-721 NFT standard | Subscription ledger via Persistent entries |
| ERC-7579 modules | Standalone contract account |
| UUPS proxy upgrade | `update_current_contract_wasm()` |
| Axelar/CCIP GMP | Multi-sig validator bridge |
| `onlyOwner` modifier | `read_admin(&env).require_auth()` |
| ERC-20 token calls | SAC (Stellar Asset Contract) built-in |
| `block.timestamp` | `env.ledger().timestamp()` |
| `receive()` fallback | Cross-contract SAC transfers |

## Prerequisites

- Rust 1.84+
- `wasm32v1-none` target: `rustup target add wasm32v1-none`
- Stellar CLI: `cargo install stellar-cli`

## Build

```bash
cd packages/stellar-contracts

# Build all contracts
cargo build --release --target wasm32v1-none

# Build single contract
cargo build --release --target wasm32v1-none -p arcenpay-session-vault

# Optimize with stellar CLI
stellar contract build --package arcenpay-session-vault
```

## Test

```bash
# Run all tests
cargo test --workspace

# Run single contract tests
cargo test --package arcenpay-session-vault
```

## Deploy

```bash
# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/arcenpay_session_vault.wasm \
  --source alice \
  --network testnet

# Initialize (constructor)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- \
  __constructor \
  --admin <ADMIN_ADDRESS>

# Invoke a function
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- \
  fund_session \
  --agent <AGENT_ADDRESS> \
  --amount 10000000 \
  --token <USDC_ADDRESS>
```

## Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_SUBSCRIPTION_FEE_BPS` | 50 | 0.5% protocol fee |
| `DEFAULT_SETTLEMENT_FEE_BPS` | 30 | 0.3% settlement fee |
| `BPS_DENOMINATOR` | 10,000 | Fee calculation base |
| `MIN_BILLING_INTERVAL` | 2,592,000 | 30 days minimum |
| `MONTHLY_INTERVAL` | 2,592,000 | Monthly subscription |
| `YEARLY_INTERVAL` | 31,536,000 | Annual subscription |
| `MAX_FEE_BPS` | 1,000 | 10% fee cap |

## Tiered Fee Structure

| Tier | Subscription Fee | Settlement Fee |
|------|-----------------|----------------|
| Free | 2.0% (200 bps) | 1.0% (100 bps) |
| Plus | 1.0% (100 bps) | 0.5% (50 bps) |
| Pro | 0.5% (50 bps) | 0.3% (30 bps) |

## Cross-Chain Bridge

The `mirror-registry` contract uses a **multi-sig validator bridge** pattern:

1. Validators are added/removed by the contract admin
2. A threshold (e.g., 3 of 5) is configured
3. The `BridgeRelayer` service (part of the facilitator) watches events on both Stellar and EVM chains
4. When a cross-chain event is detected, validators sign the payload
5. `apply_bridge_update_with_signatures()` verifies the threshold of valid signatures and applies the mirror update

This replaces the Axelar/CCIP GMP model used in the EVM version.
