# ArcenPay — Complete Codebase Wiki

> **Crypto-first, stablecoin-only (USDC) Web3 subscription billing platform**
> Built on the MEAP + ZKVUB Protocol

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Architecture Overview](#3-architecture-overview)
4. [Smart Contracts](#4-smart-contracts)
   - [PlanFactory](#41-planfactorysol)
   - [SubscriptionRegistry](#42-subscriptionregistrysol)
   - [ERC7579AutopayModule](#43-erc7579autopaymoulesol)
   - [FeeCollector](#44-feecollectorsol)
   - [SessionVault](#45-sessionvaultsol)
   - [ZKUsageVerifier](#46-zkusageverifiersol)
   - [MirrorRegistry](#47-mirrorregistrysol)
   - [Finance Contracts](#48-finance-contracts)
   - [Identity Contracts](#49-identity-contracts)
5. [Money Flow](#5-money-flow)
6. [Database Schema](#6-database-schema)
7. [API Routes](#7-api-routes)
8. [SDK Packages](#8-sdk-packages)
   - [sdk-core](#81-sdk-core-meapcore)
   - [sdk-react](#82-sdk-react-meapreact)
   - [sdk-node](#83-sdk-node-meapnode)
   - [sdk-agent](#84-sdk-agent-meapagent)
9. [Apps](#9-apps)
   - [arcen-dashboard](#91-arcen-dashboard)
   - [facilitator](#92-facilitator)
   - [arcen-landing](#93-arcen-landing)
10. [Authentication & Authorization](#10-authentication--authorization)
11. [Chain & Wallet Configuration](#11-chain--wallet-configuration)
12. [Feature Flags & Entitlements](#12-feature-flags--entitlements)
13. [Billing & Invoicing](#13-billing--invoicing)
14. [ZK Proof System](#14-zk-proof-system)
15. [Cross-Chain Architecture](#15-cross-chain-architecture)
16. [zkTLS & Identity](#16-zktls--identity)
17. [Deployment Guide](#17-deployment-guide)
18. [Environment Variables](#18-environment-variables)
19. [Testing](#19-testing)
20. [Security Model](#20-security-model)
21. [Glossary](#21-glossary)

---

## 1. Project Overview

ArcenPay is a **Web3 subscription billing platform** that allows SaaS builders to charge their users in USDC — with the billing logic living entirely on-chain. It replaces Stripe for crypto-native products.

### What It Does

| Capability | Description |
|------------|-------------|
| **Flat Subscriptions** | Monthly / Quarterly / Annual plans billed in USDC |
| **Usage-Based Billing** | Metered API calls or events, settled via ZK proofs |
| **Credit Packs** | Buy N credits, burn as you use |
| **Feature Flags** | Boolean, event-based, trait-based entitlements per plan |
| **Add-Ons** | One-time or recurring bolt-ons |
| **Free Plans** | Off-chain, no contract interaction |
| **Embeddable UI** | React SDK for customer-facing billing UI |

### Tech Stack at a Glance

```
Frontend:    Next.js 16 + React 19 + TailwindCSS v4 + Radix UI
Smart Contracts: Solidity ^0.8.24, Hardhat + Foundry
Database:    PostgreSQL + Prisma 7
Auth:        SIWE + Clerk
Wallet:      AppKit (Reown) + wagmi + viem
Blockchain:  Ethereum Sepolia, Base Sepolia, Base Mainnet
Stablecoin:  USDC (native on Base, bridged on Sepolia)
Cross-Chain: Axelar GMP + Chainlink CCIP
ZK:          Groth16 (snarkjs + circom)
Email:       Resend
Webhooks:    Svix
Build:       Turbo monorepo
```

---

## 2. Monorepo Structure

```
arcenpay/
├── turbo.json                    # Build orchestration
├── package.json                  # Root workspaces: apps/* packages/*
├── tsconfig.base.json            # Shared TypeScript config
├── docker-compose.yml            # Local dev services (Postgres, Redis)
├── circuits/                     # Circom ZK circuits
│   └── UsageBilling.circom       # Usage proof circuit
│
├── apps/
│   ├── arcen-dashboard/          # Main provider dashboard (Next.js)
│   ├── facilitator/              # Backend payment service (Express)
│   ├── arcen-landing/            # Marketing website (Next.js)
│   └── docs/                     # Protocol documentation (Next.js)
│
├── packages/
│   ├── contracts/                # Smart contracts (Solidity)
│   ├── sdk-core/                 # Shared types, ABIs, chain config
│   ├── sdk-react/                # React component library
│   ├── sdk-node/                 # Node.js middleware + services
│   └── sdk-agent/                # AI agent SDK (minimal)
│
└── subgraph/                     # The Graph subgraph indexer
```

### Build System (Turbo)

The repo uses **Turborepo** for incremental builds and task caching.

```bash
# Build all packages and apps
turbo build

# Run dev servers for all apps
turbo dev

# Run all tests
turbo test

# Type check everything
turbo typecheck
```

Task pipeline (from `turbo.json`):
- `build` → depends on `^build` (dependencies built first)
- `test` → depends on `^build`
- Cached outputs: `dist/**`, `.next/**`, `artifacts/**`, `typechain-types/**`

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         ArcenPay Platform                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │   Provider    │    │  Your App    │    │  Your Customers  │   │
│  │  Dashboard   │    │  (any stack) │    │  (wallets)       │   │
│  │  (Next.js)   │    │              │    │                  │   │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘   │
│         │                   │                     │              │
│  ┌──────▼───────────────────▼─────────────────────▼──────────┐  │
│  │                   ArcenPay API Layer                        │  │
│  │  /api/catalog  /api/invoices  /api/platform  /api/proofs   │  │
│  └────────────────────────────┬────────────────────────────────┘  │
│                               │                                   │
│  ┌────────────────────────────▼────────────────────────────────┐  │
│  │                   Facilitator Service                        │  │
│  │     x402 payment validation · settlement · GMP dispatch      │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                         │                                         │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │              Smart Contract Layer (EVM)                   │   │
│  │                                                            │   │
│  │  PlanFactory  SubscriptionRegistry  ERC7579AutopayModule  │   │
│  │  FeeCollector  SessionVault  ZKUsageVerifier               │   │
│  │  MirrorRegistry  ZKCredentialGate  DIDRegistry             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Chains:  Ethereum Sepolia · Base Sepolia · Base Mainnet          │
│  Bridge:  Axelar GMP (primary) · Chainlink CCIP (fallback)        │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow for a Subscription Payment

```
1. Provider creates a plan in Dashboard
        ↓
2. Plan registered on PlanFactory.sol (on-chain)
        ↓
3. Customer visits your app, sees PricingTable (sdk-react)
        ↓
4. Customer connects wallet → CheckoutModal deploys SmartAccount
        ↓
5. Customer signs → ERC7579AutopayModule installed on their SmartAccount
        ↓
6. Every billing interval → Module pulls USDC from SmartAccount
        ↓
7. USDC → Provider treasury (99.5%) + FeeCollector (0.5%)
        ↓
8. SubscriptionRegistry mints/renews ERC-721 NFT to customer
        ↓
9. BillingEvent recorded → Invoice generated → Email sent
```

---

## 4. Smart Contracts

**Location**: `packages/contracts/contracts/`

**Compiler**: Solidity ^0.8.24
**Test Framework**: Forge (Foundry) + Hardhat
**Networks**: Sepolia, Base Sepolia, Base Mainnet

---

### 4.1 PlanFactory.sol

**Path**: `packages/contracts/contracts/core/PlanFactory.sol`

The plan configuration registry. Providers register their billing plans here. Each plan is stored on-chain with a unique ID.

#### Key Data Structure

```solidity
struct Plan {
    uint256 id;
    address provider;          // Who receives payment (your treasury wallet)
    string name;               // Plan display name
    string tier;               // Slug-style tier identifier
    uint256 price;             // Price in token base units (USDC = 6 decimals)
    uint32 billingInterval;    // Seconds between payments (min 30 days = 2,592,000)
    address acceptedToken;     // Token address (USDC)
    bool active;               // Plan is live
    string metadataURI;        // IPFS/HTTPS metadata link
}
```

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `createPlan(...)` | Provider | Register a new billing plan |
| `createPlanFor(...)` | Owner (EIP-712) | Gasless plan creation via meta-tx |
| `updatePlan(planId, ...)` | Provider | Update price/interval/metadata |
| `deactivatePlan(planId)` | Provider | Archive a plan |
| `getPlan(planId)` | Anyone | Read plan details |
| `getProviderPlans(addr)` | Anyone | List provider's plans |
| `approveToken(addr, bool)` | Owner | Whitelist/blacklist payment tokens |
| `addProvider(addr)` | Owner | Whitelist a provider |

#### Constraints

- `price > 0` — **free plans cannot be registered on-chain** (use `NOT_APPLICABLE` in DB)
- `billingInterval >= 2,592,000` — minimum 30 days
- `acceptedToken` must be in `approvedTokens` whitelist
- `msg.sender` must be in `_providers` whitelist

#### EIP-712 Meta-Transaction

Providers can sign a typed data payload allowing the ArcenPay operator to submit `createPlanFor()` on their behalf, paying gas. This is what the dashboard uses when you click "Register On-Chain."

```typescript
// EIP-712 domain
{
  name: "PlanFactory",
  version: "1",
  chainId: <chain>,
  verifyingContract: <PlanFactory address>
}

// Typed data
{
  CreatePlan: [
    { name: "provider", type: "address" },
    { name: "name", type: "string" },
    { name: "tier", type: "string" },
    { name: "price", type: "uint256" },
    { name: "billingInterval", type: "uint32" },
    { name: "acceptedToken", type: "address" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" }
  ]
}
```

---

### 4.2 SubscriptionRegistry.sol

**Path**: `packages/contracts/contracts/core/SubscriptionRegistry.sol`

An **ERC-721 NFT contract** where each token = one active subscription. Implements **ERC-5643** (subscription expiry standard).

#### Key Concepts

- One subscription NFT per wallet
- NFT has an `expiration` timestamp
- `renew(tokenId, duration)` extends expiry
- `expire(tokenId)` marks it inactive after expiry
- Authorized billing contracts (AutopayModule, ZKUsageVerifier) can mint/renew

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `mint(to, planId, duration)` | Authorized biller | Create new subscription NFT |
| `renew(tokenId, duration)` | Authorized biller | Extend subscription |
| `cancel(tokenId)` | Subscriber or provider | Cancel subscription |
| `expire(tokenId)` | Anyone | Mark expired subscription inactive |
| `isActive(tokenId)` | Anyone | Check if subscription is valid |
| `getSubscription(wallet)` | Anyone | Get subscription details for wallet |
| `authorizeBiller(addr)` | Owner | Allow contract to mint/renew |

#### Cross-Chain Mirroring

When a subscription is created on Sepolia (primary chain), the SubscriptionRegistry emits a `SubscriptionUpdate` event. The Facilitator picks this up and dispatches a **GMP message via Axelar** (or CCIP fallback) to `MirrorRegistry.sol` on other chains.

---

### 4.3 ERC7579AutopayModule.sol

**Path**: `packages/contracts/contracts/core/ERC7579AutopayModule.sol`

An **ERC-7579 executor module** installed on customer's smart accounts (ERC-4337). It enables the merchant to pull USDC automatically at billing intervals.

#### How It Works

1. Customer deploys a **ZeroDev smart account**
2. Customer installs the AutopayModule via `installModule(2, moduleAddress, initData)`
3. `initData` encodes: `merchant`, `maxAmount`, `token`, `interval`
4. Merchant (or Facilitator) calls `execute(account, amount)` at billing time
5. Module calls `token.safeTransferFrom(account, merchant, amount)` — pulls from smart account

#### AutopayConfig

```solidity
struct AutopayConfig {
    address merchant;        // Your treasury wallet
    uint256 maxAmount;       // Max pull per transaction (safety cap)
    address token;           // USDC address
    uint32 interval;         // Minimum seconds between pulls
    bool active;             // Paused/active state
}
```

#### Safety Mechanisms

- `maxAmount` cap — operator cannot pull more than agreed
- `interval` enforcement — cannot pull faster than billing cycle
- Per-account pause/resume
- Lifetime total pull tracking
- Velocity limits

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `onInstall(data)` | SmartAccount | Called when module is installed |
| `onUninstall(data)` | SmartAccount | Called when module is removed |
| `execute(account, amount)` | Merchant | Pull payment from account |
| `pause(account)` | Merchant | Stop billing for account |
| `resume(account)` | Merchant | Resume billing for account |
| `getConfig(account)` | Anyone | Read account's billing config |
| `getTotalPulled(account)` | Anyone | Lifetime pull amount |

---

### 4.4 FeeCollector.sol

**Path**: `packages/contracts/contracts/core/FeeCollector.sol`

Collects ArcenPay's protocol fee from each payment. Fees accumulate in the contract and are periodically withdrawn to the ArcenPay treasury.

#### Fee Structure

| Type | Default Rate | Configurable? |
|------|-------------|---------------|
| Subscription fee | 50 bps (0.5%) | Per-provider override |
| Settlement fee (ZK billing) | 30 bps (0.3%) | Per-provider override |

#### Platform Tier Overrides

| Tier | Subscription Fee | Settlement Fee |
|------|-----------------|----------------|
| FREE | 200 bps (2%) | 100 bps (1%) |
| PLUS | 100 bps (1%) | 50 bps (0.5%) |
| PRO | 50 bps (0.5%) | 30 bps (0.3%) |

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `collectSubscriptionFeeFor(amount, provider)` | Authorized | Calculate + record fee |
| `collectSettlementFeeFor(amount, provider)` | Authorized | Calculate ZK settlement fee |
| `receiveFee(token, amount)` | Authorized | Receive fee transfer |
| `withdrawFees(token)` | Owner | Send accumulated fees to treasury |
| `setProviderFeeRates(provider, subBps, settleBps)` | Owner | Custom rates |
| `setTreasury(addr)` | Owner | Update treasury address |

---

### 4.5 SessionVault.sol

**Path**: `packages/contracts/contracts/core/SessionVault.sol`

An **escrow vault** for usage-based billing. Agents (AI bots, API clients) pre-fund sessions, then ZKUsageVerifier settles from the vault as usage is proven.

#### Session Lifecycle

```
1. Agent calls fundSession(amount, token) → USDC locked in vault
2. Agent uses provider API (tracked off-chain)
3. ZK proof generated off-chain
4. ZKUsageVerifier calls settle(sessionId, amount, provider)
5. USDC released from vault → provider's wallet
6. Agent can withdrawRemainder() any unused balance
```

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `fundSession(amount, token)` | Agent | Lock USDC, get session ID |
| `topUp(sessionId, amount)` | Agent | Add more balance to session |
| `settle(sessionId, amount, provider)` | Settler (ZKVerifier) | Release payment to provider |
| `withdrawRemainder(sessionId)` | Agent | Reclaim unused balance |
| `getSession(sessionId)` | Anyone | Read session state |
| `authorizeSettler(addr)` | Owner | Allow contract to settle |

---

### 4.6 ZKUsageVerifier.sol

**Path**: `packages/contracts/contracts/core/ZKUsageVerifier.sol`

Verifies **Groth16 ZK proofs** of usage and settles payment from SessionVault.

#### Proof Flow

```
Off-chain:
  1. Collect usage data (API call count, window start/end)
  2. Generate Groth16 proof with circom circuit
  3. Compute nullifier = hash(sessionId, windowStart)

On-chain:
  4. Call verifyAndSettle(proof, publicInputs)
  5. Contract verifies Groth16 proof
  6. Checks nullifier has not been used (prevents double-spend)
  7. Calculates settlement = callCount × rate[planId]
  8. Calls SessionVault.settle(sessionId, amount, provider)
  9. Emits UsageSettled event
```

#### Public Inputs (passed to on-chain verifier)

```solidity
struct PublicInputs {
    bytes32 sessionId;
    address agent;
    uint256 callCount;
    uint64 windowStart;
    uint64 windowEnd;
    uint256 planId;
}
```

#### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `verifyAndSettle(proof, inputs)` | Anyone | Verify ZK proof + settle |
| `setRateSchedule(planId, ratePerCall)` | Owner | Set price per API call |
| `setVerifier(addr)` | Owner | Update Groth16 verifier contract |

---

### 4.7 MirrorRegistry.sol

**Path**: `packages/contracts/contracts/core/MirrorRegistry.sol`

Receives **cross-chain GMP messages** from the primary chain (Sepolia) and mirrors subscription state on secondary chains (Base Sepolia, Base Mainnet).

#### Message Sources

- **Axelar GMP** (primary): `_execute(sourceChain, sourceAddress, payload)`
- **Chainlink CCIP** (fallback): `ccipReceive(Any2EVMMessage message)`

#### What Gets Mirrored

When a subscription is created/renewed/cancelled on the primary chain, a GMP message is sent containing `(wallet, planId, expiresAt, action)`. MirrorRegistry updates its local state so apps on that chain can check subscription status without cross-chain calls.

---

### 4.8 Finance Contracts

**Path**: `packages/contracts/contracts/finance/`

| Contract | Description |
|----------|-------------|
| `SubscriptionCollateralModule.sol` | Smart account collateral backing for subscriptions |
| `SubscriptionTransferPolicy.sol` | Controls whether subscription NFTs can be traded |
| `YieldSessionVault.sol` | SessionVault variant that generates yield on idle funds |

---

### 4.9 Identity Contracts

**Path**: `packages/contracts/contracts/identity/`

| Contract | Description |
|----------|-------------|
| `DIDRegistry.sol` | Decentralized identity (DID) registration per wallet |
| `MultisigVerifier.sol` | Multi-signature threshold verification |
| `ZKCredentialGate.sol` | Reclaim Protocol zkTLS integration — gate access based on verified Web2 claims |

---

## 5. Money Flow

### Flat Subscription Payment

```
Customer SmartAccount (USDC)
       │
       │  safeTransferFrom
       ▼
ERC7579AutopayModule.execute()
       │
       ├──── 99.5% ──────────────────────────────► Provider Treasury Wallet
       │                                            (instant, non-custodial)
       │
       └──── 0.5% (default) ────────────────────► FeeCollector Contract
                                                    │
                                                    └─ (accumulates until
                                                        owner withdraws
                                                        to ArcenPay treasury)
```

**Key point**: Money goes **directly** to the provider's wallet in the same transaction. ArcenPay never custodies funds.

### Usage-Based (ZK) Payment

```
Agent pre-funds SessionVault (USDC locked in escrow)
       │
       │  Agent uses API → usage tracked off-chain
       │
       ▼
ZK proof generated (circom + snarkjs)
       │
       ▼
ZKUsageVerifier.verifyAndSettle()
       │
       ├──── provider share ────────────────────► Provider Treasury
       └──── settlement fee (0.3%) ─────────────► FeeCollector
```

### Credit Pack Purchase

Same flow as flat subscription (direct transfer, non-custodial).

### Fee Comparison

| Platform | Fee | Payout Timing |
|----------|-----|--------------|
| Stripe | 2.9% + $0.30 | 2–7 business days |
| Coinbase Commerce | 1% | 1-2 days |
| **ArcenPay (default)** | **0.5%** | **Instant (same tx)** |
| **ArcenPay (PRO tier)** | **0.5%** | **Instant** |
| **ArcenPay (FREE tier)** | **2%** | **Instant** |

---

## 6. Database Schema

**Location**: `apps/arcen-dashboard/prisma/schema.prisma`
**Database**: PostgreSQL
**ORM**: Prisma 7

### Model Reference

#### Identity & Auth

```
User
  id, email, walletAddress, clerkUserId
  → TeamMember[] (role-based membership)
  → MagicToken[] (passwordless login)

MagicToken
  token (hashed), expiresAt, usedAt
  → User

Team (= Workspace)
  id, name, slug, platformTier (FREE/PLUS/PRO/ENTERPRISE)
  environmentMode (TESTNET/MAINNET)
  → TeamMember[]
  → CatalogPlan[], CatalogAddOn[], CatalogCreditType[]
  → ArcenCompany[], ArcenUser[]
  → CatalogFeatureFlag[]

TeamMember
  role: OWNER | ADMIN | FINANCE | DEVELOPER | SUPPORT | MEMBER
  → Team, User

ProviderProfile
  teamId, webhookUrl, webhookSecret, notificationEmail
  hasApiKey (bool)
```

#### Catalog (Product Catalog)

```
CatalogPlan
  id, teamId, name, tier (slug), description
  planType: FREE | PAID
  price (Decimal), billingInterval (days), tokenSymbol
  chainId, tokenAddress
  chainSyncStatus: PENDING | SYNCED | FAILED | NOT_APPLICABLE
  onChainPlanId (uint256 from contract)
  status: DRAFT | ACTIVE | ARCHIVED

CatalogAddOn
  id, teamId, name, code, description
  addonType: ONE_TIME | RECURRING
  price, billingInterval, tokenSymbol
  chainSyncStatus, status

CatalogCreditType
  id, teamId, name, description
  singularUnitName, pluralUnitName
  unitsPerPack, pricePerPack
  tokenSymbol, chainId
  chainSyncStatus, status

CatalogFeatureFlag
  id, teamId, name, key (unique slug), description
  flagType: BOOLEAN | NUMERICAL_LIMIT | TRAIT_BASED | EVENT_BASED
  defaultValue
  → FlagRule[]
  → CompanyOverride[]

FlagRule
  id, flagId, priority, valueTrue/valueFalse, valueLimit
  → FlagRuleCondition[]

FlagRuleCondition
  id, ruleId
  conditionType: BASE_PLAN | ADD_ON | USAGE_LIMIT | COMPANY_TRAIT |
                 USER_TRAIT | ZKTLS_CLAIM
  operator: eq | gte | lte | in | contains
  resourceId (plan/addon id), traitKey, traitValue, zkClaimType

CompanyOverride
  companyId, flagId, overrideValue, expiresAt
```

#### ArcenPay Layer (Customer Registry)

```
ArcenCompany
  id, teamId, name, externalId
  walletAddress, traits (JSON)
  activePlanId, activeAddOnIds[]
  createdAt, lastSeenAt

ArcenUser
  id, companyId, teamId
  name, email, walletAddress
  traits (JSON), externalId

ArcenEvent
  id, teamId, companyId, userId
  eventType: TRACK | IDENTIFY | FLAG_CHECK
  eventName, properties (JSON)
  createdAt
```

#### Billing & Invoicing

```
Invoice
  id, teamId, companyId
  status: DRAFT | ISSUED | PAID | VOID | OVERDUE
  subtotal, tax, total (Decimal)
  currency, dueDate, issuedAt, paidAt
  → InvoiceLine[]
  → InvoiceDelivery[]
  → CreditNote[]

InvoiceLine
  invoiceId, description, quantity, unitPrice, tax

InvoiceDelivery
  invoiceId, email, resendId, deliveredAt, status

CreditNote
  invoiceId, amount, reason, issuedAt

TaxProfile
  teamId, legalName, address (JSON), taxId, gstin

InvoiceSequence
  teamId, year, nextNumber (auto-increment)
```

#### Platform & Gas Tracking

```
PlatformTierConfig
  tier (unique)
  maxWorkspaces, maxPlans, maxSubscribers
  maxTeamMembers, maxFeatureFlags, maxChains
  gasBudgetUsdPerDay

GasSpend
  teamId, chainId, walletAddress, date
  amountWei, amountUsd

TierUpgradeHistory
  teamId, fromTier, toTier, upgradedAt, txHash
```

#### Audit & Events

```
AuditEvent
  id, teamId, actorType: USER | API | SYSTEM
  actorId, action, resourceType, resourceId
  before (JSON), after (JSON), createdAt

BillingEvent
  id, teamId
  eventType: SUBSCRIPTION_MINTED | RENEWED | CANCELLED |
             PAYMENT_FAILED | CREDIT_ISSUED | USAGE_SETTLED
  idempotencyKey (unique), processed (bool)
  payload (JSON), processedAt

WebhookDelivery
  id, teamId, url, event, payload
  status: PENDING | DELIVERED | FAILED
  attempts, lastError, deliveredAt

AuthNonce
  nonce (unique), walletAddress, expiresAt, used (bool)
```

#### Embed & API Keys

```
EmbedComponent
  id, teamId, name
  componentType: planManager | meteredFeatures | plansTable | usageDashboard
  config (JSON), isPublished

EmbedAccessToken
  token (hashed), teamId, companyId
  expiresAt, lastUsedAt

ArcenApiKey
  id, teamId, name
  keyHash (argon2), prefix (first 8 chars shown)
  lastUsedAt, expiresAt

ZkTlsProof
  id, teamId, companyId
  proofType (github_stars, coinbase_kyc, etc.)
  claimData (JSON), verifiedAt, expiresAt
```

---

## 7. API Routes

**Base**: `apps/arcen-dashboard/app/api/`
**Auth**: All routes require authenticated session (SIWE JWT or Clerk)

### Auth Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/nonce` | Generate SIWE nonce (rate-limited: 20/min/IP) |
| `POST` | `/api/auth/link-wallet` | Link wallet address to authenticated account |

### Catalog Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/catalog/plans` | List all plans for team |
| `POST` | `/api/catalog/plans` | Create new plan |
| `PUT` | `/api/catalog/plans/[id]` | Update plan |
| `DELETE` | `/api/catalog/plans/[id]` | Delete/archive plan |
| `POST` | `/api/catalog/plans/[id]/register-on-chain` | Submit EIP-712 signature → facilitator → on-chain |
| `GET` | `/api/catalog/plans/[id]/chain-confirm` | Poll on-chain confirmation status |
| `GET` | `/api/catalog/plans/[id]/sign-nonce` | Get nonce for EIP-712 signing |
| `GET` | `/api/catalog/plans/[id]/entitlements` | List feature flags attached to plan |
| `GET/POST` | `/api/catalog/add-ons` | List/create add-ons |
| `PUT/DELETE` | `/api/catalog/add-ons/[id]` | Update/delete add-on |
| `GET/POST` | `/api/catalog/credits` | List/create credit types |
| `PUT/DELETE` | `/api/catalog/credits/[id]` | Update/delete credit type |
| `POST` | `/api/catalog/publish` | Publish catalog snapshot to chain |
| `GET` | `/api/catalog/chain-sync` | Get chain sync status for all items |
| `GET/PUT` | `/api/catalog/config` | Catalog UI configuration |

#### Free Plan Logic (plans route)

```typescript
// POST /api/catalog/plans
const isFree = parseFloat(price) === 0;
chainSyncStatus = isFree ? "NOT_APPLICABLE" : "PENDING";

// PUT /api/catalog/plans/[id]
if (priceChanged && !alreadySynced) {
  const newIsFree = parseFloat(newPrice) === 0;
  chainSyncStatus = newIsFree ? "NOT_APPLICABLE" : "PENDING";
}
```

### Invoice Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invoices` | List invoices (paginated) |
| `POST` | `/api/invoices` | Create invoice |
| `GET` | `/api/invoices/[id]` | Get invoice detail |
| `PUT` | `/api/invoices/[id]` | Update invoice |
| `POST` | `/api/invoices/[id]/resend` | Resend via Resend email |
| `POST` | `/api/invoices/[id]/credit-notes` | Add credit memo |
| `GET` | `/api/invoices/[id]/download` | Generate + download PDF (authenticated) |
| `GET` | `/api/invoices/public/[id]/download` | Public PDF download (signed URL) |

### Platform Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/overview` | Dashboard stats (MRR, subscribers, etc.) |
| `GET` | `/api/platform/tier` | Current platform tier + usage |
| `POST` | `/api/platform/tier` | Upgrade tier |
| `GET` | `/api/platform/tier-history` | Tier change audit log |
| `GET` | `/api/platform/gas-budget` | Daily gas budget remaining |
| `GET` | `/api/platform/gas-spend` | Historical gas spend by chain |
| `GET` | `/api/platform/sessions` | Active SessionVault sessions |
| `POST` | `/api/platform/support` | Submit support ticket (Pro only) |

### Proof Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/proofs/active` | Active ZK proof sessions |
| `GET` | `/api/proofs/history` | Past proof submissions |

### Provider Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/provider/profile` | Read/update provider profile |
| `GET/POST` | `/api/provider/api-keys` | List/create API keys |
| `DELETE` | `/api/provider/api-keys/[id]` | Revoke API key |

---

## 8. SDK Packages

### 8.1 sdk-core (`@meap/core`)

**Location**: `packages/sdk-core/`
**Used by**: All other packages and apps

The shared foundation — types, ABIs, chain configs, error classes.

#### Exports

```typescript
// Types
import type {
  Plan, PlanTier, Subscription, SubscriptionEvent,
  Entitlement, FeatureFlag, AutopayConfig,
  SessionVaultInfo, UsageProof, PublicInputs,
  BillingSettlement, X402Response, X402PaymentOption,
  ContractAddresses, ChainEnvironmentManifest,
  MEAPConfig, PaymentToken, EnvironmentMode
} from "@meap/core";

// ABIs
import {
  SubscriptionRegistryABI, PlanFactoryABI,
  ERC7579AutopayModuleABI, SessionVaultABI,
  ZKUsageVerifierABI, FeeCollectorABI,
  MirrorRegistryABI, YieldSessionVaultABI
} from "@meap/core";

// Chain config
import {
  SUPPORTED_CHAINS, TOKENS, DEFAULT_CHAIN_ID,
  getChain, getBlockExplorerUrl
} from "@meap/core";

// Contract addresses
import {
  getContractAddresses, setContractAddresses,
  getChainEnvironment, validateChainEnvironment
} from "@meap/core";

// Error handling
import {
  MEAPError, ContractError, AuthError,
  parseContractError, normalizeError
} from "@meap/core";

// Constants
import {
  SUBSCRIPTION_FEE_BPS,  // 50
  SETTLEMENT_FEE_BPS,    // 30
  BPS_DENOMINATOR,       // 10_000
  MIN_BILLING_INTERVAL,  // 2_592_000 (30 days in seconds)
  MONTHLY_INTERVAL,      // 2_592_000
  YEARLY_INTERVAL        // 31_536_000
} from "@meap/core";
```

#### Supported Chains

| Chain | ID | Type | USDC |
|-------|----|------|------|
| Ethereum Sepolia | 11155111 | Testnet | MockUSDC or bridged |
| Base Sepolia | 84532 | Testnet | MockUSDC or USDC.e |
| Base Mainnet | 8453 | Production | Native USDC |

---

### 8.2 sdk-react (`@meap/react`)

**Location**: `packages/sdk-react/`
**Peer deps**: React 18/19, wagmi, viem

Your customers embed these components in their app to handle the entire subscription UX.

#### Setup

```tsx
import { MEAPProvider } from "@meap/react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MEAPProvider
          config={{
            chainId: 8453,              // Base mainnet
            apiUrl: "https://api.arcenpay.xyz",
            providerAddress: "0x...",   // Your treasury wallet
          }}
        >
          <YourApp />
        </MEAPProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

#### Components

```tsx
// Show pricing tiers
<PricingTable
  onSelectPlan={(planId) => ...}
  highlightTier="pro"
/>

// Full checkout flow (wallet connect → smart account → autopay setup)
<CheckoutModal
  planId={selectedPlanId}
  onSuccess={(subscriptionId) => ...}
  onCancel={() => ...}
/>

// Show current subscription status
<SubscriptionStatus />

// Conditionally render based on feature flag
<FeatureFlagGuard flag="advanced_analytics">
  <AdvancedAnalytics />
</FeatureFlagGuard>

// Usage meter display
<UsageDashboard planId={planId} />

// Invoice list for customer
<BillingHistory />
<InvoiceList />
```

#### Hooks

```tsx
// Check a feature flag
const { enabled, loading } = useEntitlement("advanced_analytics");

// Full MEAP context
const { plan, subscription, flags, config } = useMEAP();
```

#### Smart Account Utilities

```typescript
import { deploySmartAccount, revokeAutopayModule } from "@meap/react";

// Deploy ZeroDev smart account for customer
const account = await deploySmartAccount({
  signer,       // viem WalletClient
  chainId: 8453
});

// Remove autopay module (cancel subscription)
await revokeAutopayModule({
  account,
  chainId: 8453
});
```

---

### 8.3 sdk-node (`@meap/node`)

**Location**: `packages/sdk-node/`
**Used by**: Facilitator service, provider backends

#### x402 Middleware

```typescript
import { x402Middleware } from "@meap/node";
import express from "express";

const app = express();

// Require payment for /api/premium/* routes
app.use("/api/premium", x402Middleware({
  facilitatorUrl: process.env.FACILITATOR_URL,
  planId: 42,
  acceptedTokens: ["USDC"],
  chainId: 8453
}));
```

#### Services

```typescript
import {
  UsageService,
  SettlementService,
  SettlementWriterService,
  EventListenerService,
  WebhookService,
  EmailService,
  TablelandService,
  ProofOrchestrator,
  BillingKeeper,
  AxelarTransport,
  CCIPTransport,
  RedisUsageStore
} from "@meap/node";

// Track usage event
const usageService = new UsageService(redisStore, config);
await usageService.track({
  sessionId: "0x...",
  agentAddress: "0x...",
  planId: 42,
  callCount: 1
});

// Orchestrate ZK proof generation + on-chain settlement
const orchestrator = new ProofOrchestrator(usageService, settlementService);
await orchestrator.settleWindow(sessionId, windowStart, windowEnd);
```

---

### 8.4 sdk-agent (`@meap/agent`)

**Location**: `packages/sdk-agent/`

Thin SDK for AI agents making x402 payments autonomously. Currently exposes type re-exports from `@meap/core`. Phase 2 roadmap includes full agent wallet management.

---

## 9. Apps

### 9.1 arcen-dashboard

**Path**: `apps/arcen-dashboard/`
**Framework**: Next.js 16 (App Router), React 19
**Port**: 3000 (default)

The main provider control panel. Everything a SaaS builder needs to manage their billing.

#### Key Directories

```
apps/arcen-dashboard/
├── app/
│   ├── (auth)/                    # Auth pages (sign-in, sign-up)
│   ├── (dashboard)/               # Protected dashboard pages
│   │   ├── layout.tsx             # Sidebar + nav shell
│   │   ├── page.tsx               # Dashboard home
│   │   ├── catalog/               # Plans, Add-Ons, Credits, Flags, Components
│   │   ├── billing/               # Invoices, Tax profile
│   │   ├── customers/             # Companies, Users
│   │   ├── events/                # Event log
│   │   ├── settings/              # Team, API keys, Profile
│   │   └── platform/              # Gas budget, tier management
│   └── api/                       # API route handlers
├── components/
│   ├── dashboard/
│   │   ├── sections/
│   │   │   ├── catalog.tsx        # Plans / Add-Ons / Credits / Flags
│   │   │   ├── plans.tsx          # On-chain direct plans section
│   │   │   ├── customers.tsx      # Company & user management
│   │   │   ├── events.tsx         # Event stream
│   │   │   └── billing.tsx        # Invoices section
│   │   └── component-editor.tsx   # Embed component builder
│   ├── ui/                        # Radix-based UI primitives
│   └── safe/                      # Safe multisig transaction stubs
├── lib/
│   ├── config.ts                  # Env var resolution, chain config
│   ├── contracts.ts               # ABI re-exports + useContractAddresses()
│   ├── auth.ts / auth.server.ts   # SIWE JWT auth
│   ├── chain-reader.ts            # Multi-chain viem clients
│   ├── rbac.ts                    # Role-based access control
│   ├── audit.ts                   # Audit event logging
│   ├── gas-policy.ts              # Gas budget tracking
│   ├── invoices.ts                # Invoice business logic
│   ├── invoice-documents.ts       # PDF generation
│   ├── invoice-tax.ts             # Tax calculation
│   ├── graphql.ts                 # Apollo client + helpers
│   └── facilitator-auth.ts        # Auth with facilitator
├── prisma/
│   ├── schema.prisma              # Full DB schema
│   └── migrations/                # SQL migration history
└── public/                        # Static assets
```

#### Key Components

**`catalog.tsx`** — The main catalog management UI

Sections within this file:
- `CatalogPlansSection` — Plan list with create/edit dialogs
- `CatalogAddOnsSection` — Add-on management
- `CatalogCreditsSection` — Credit type management
- `CatalogFlagsSection` — Feature flag management
- `ConfigurationTab` — Billing config settings
- `PlanDetailView` — Single plan detail (entitlements, companies, billing)
- `CreatePlanDialog` / `EditPlanDialog` — Split-layout dialogs
- `CreateAddOnDialog` / `EditAddOnDialog` — Add-on dialogs
- `CreateCreditTypeDialog` / `EditCreditTypeDialog` — Credit dialogs

**`component-editor.tsx`** — Visual embed component builder with drag-and-drop element palette.

Contains `resolveElementIcon(el)` helper:
```typescript
function resolveElementIcon(el: ElementInstance): React.ComponentType {
  // If icon is still a function (not JSON-serialized), use it directly
  if (typeof el.icon === "function") return el.icon;
  // Otherwise fall back to ELEMENT_LIBRARY lookup by element type
  const found = ELEMENT_LIBRARY.find(e => e.type === el.type);
  return found?.icon ?? DefaultIcon;
}
```

#### Chain Sync Flow (Dashboard → On-Chain)

```
User clicks "Register On-Chain" for a plan
         ↓
Dashboard fetches sign-nonce from /api/catalog/plans/[id]/sign-nonce
         ↓
Dashboard calls useSignTypedData() with EIP-712 PlanFactory struct
         ↓
User signs in wallet (MetaMask, Coinbase, etc.)
         ↓
Dashboard POSTs signature to /api/catalog/plans/[id]/register-on-chain
         ↓
API route forwards to Facilitator service
         ↓
Facilitator submits createPlanFor() to PlanFactory.sol
         ↓
Dashboard polls /api/catalog/plans/[id]/chain-confirm
         ↓
On confirmation: chainSyncStatus = "SYNCED", onChainPlanId populated
```

#### Free Plan Guard

```typescript
// In catalog.tsx registerOnChain()
if (parseFloat(plan.price) === 0) {
  toast.error("Free plans cannot be registered on-chain (price must be > 0)");
  return;
}
```

Free plans have `chainSyncStatus: "NOT_APPLICABLE"` and show "Off-chain" badge in the UI.

---

### 9.2 Facilitator

**Path**: `apps/facilitator/`
**Framework**: Express.js 5 + TypeScript
**Port**: 4000 (default)

Backend service responsible for:
1. Receiving signed EIP-712 payloads from the dashboard
2. Submitting transactions to smart contracts
3. Listening to on-chain events and dispatching GMP messages
4. Running periodic billing settlement cron jobs
5. x402 payment header validation

#### Key Files

```
apps/facilitator/src/
├── server.ts              # Main Express server (all routes)
├── queue.ts               # BullMQ job queue for async settlement
└── replay-protection.ts   # Nonce-based replay attack prevention
```

#### Key Endpoints (Facilitator)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/plans/create` | Submit plan creation tx |
| `POST` | `/v1/subscriptions/execute` | Trigger autopay pull |
| `POST` | `/v1/proofs/settle` | Submit ZK proof + settle |
| `GET` | `/v1/health` | Health check + chain connectivity |
| `GET` | `/metrics` | Prometheus metrics |

---

### 9.3 arcen-landing

**Path**: `apps/arcen-landing/`

Static marketing website. No billing logic. Built with Next.js.

---

## 10. Authentication & Authorization

### Two Auth Strategies

#### 1. Clerk (OAuth / Email)

Used for provider sign-in (dashboard users).

```typescript
// Middleware (middleware.ts)
import { clerkMiddleware } from "@clerk/nextjs/server";
export default clerkMiddleware();

// Server component
import { auth } from "@clerk/nextjs/server";
const { userId, orgId } = await auth();
```

Supports: Email, Google, GitHub, and other OAuth providers.

#### 2. SIWE (Sign-In With Ethereum)

Used for wallet-based sign-in.

```
1. Frontend: GET /api/auth/nonce → { nonce }
2. Frontend: wallet.signMessage(`...${nonce}...`) → signature
3. Frontend: POST /api/auth/verify → { siweMessage, signature }
4. Backend: Verify SIWE message + signature
5. Backend: Issue JWT (signed with SIWE_JWT_SECRET)
6. Frontend: Store JWT in HTTP-only cookie
```

Nonces are single-use, expire in 5 minutes, stored in `AuthNonce` table.

### RBAC

```typescript
// Roles
type Role = "OWNER" | "ADMIN" | "FINANCE" | "DEVELOPER" | "SUPPORT" | "MEMBER";

// Capabilities by role
OWNER:     full access
ADMIN:     all except billing/tier management
FINANCE:   invoices, tax profile, read-only elsewhere
DEVELOPER: API keys, catalog read/write, no billing
SUPPORT:   customers, events, read-only elsewhere
MEMBER:    read-only dashboard
```

### API Key Auth

For server-to-server API calls (SDK integration):

```typescript
// Key format: arcen_live_<32 random bytes hex>
// Stored: argon2 hash in ArcenApiKey table
// Header: Authorization: Bearer arcen_live_xxx
```

---

## 11. Chain & Wallet Configuration

### Wallet Connection

**Library**: AppKit (Reown) v1.8.19 + wagmi adapter

```typescript
// lib/config.ts (simplified)
import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const chains = [sepolia, baseSepolia, base]; // all 3 supported

const wagmiAdapter = new WagmiAdapter({
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  networks: chains
});
```

### Supported Wallets

Any WalletConnect v2 compatible wallet:
- MetaMask
- Coinbase Wallet
- Rainbow
- WalletConnect (300+ wallets)

### USDC Token Addresses

```typescript
// From getUsdcTokenOptions()
const USDC_CHAIN_OPTIONS = [
  {
    chainId: 11155111,
    name: "Sepolia",
    symbol: "USDC",
    address: process.env.NEXT_PUBLIC_USDC_ADDRESS_SEPOLIA ?? "0x...",
    tag: "testnet"
  },
  {
    chainId: 84532,
    name: "Base Sepolia",
    symbol: "USDC",
    address: process.env.NEXT_PUBLIC_USDC_ADDRESS_BASE_SEPOLIA ?? "0x...",
    tag: "testnet"
  },
  {
    chainId: 8453,
    name: "Base",
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Native USDC on Base
    tag: "mainnet"
  }
];
```

### Billing Integration Dropdown (UI)

When creating a plan, the chain dropdown enforces:
- The currently connected wallet's chain is **enabled** (default selected)
- Other chains are **disabled** with "Switch wallet to select" hint

---

## 12. Feature Flags & Entitlements

ArcenPay has a **ArcenPay-inspired** feature flag and entitlement system built in.

### Flag Types

| Type | Description | Example |
|------|-------------|---------|
| `BOOLEAN` | On/off toggle | `has_advanced_export` |
| `NUMERICAL_LIMIT` | Value cap per period | `api_calls_per_month: 1000` |
| `EVENT_BASED` | Tied to tracked event count | `scans_used: track("scan")` |
| `TRAIT_BASED` | Company/user attribute check | `is_enterprise_customer: true` |

### Rule Evaluation Order

```
1. Check CompanyOverride (manual override has highest priority)
2. Evaluate FlagRules by priority (ascending)
   - Check each FlagRuleCondition:
     - BASE_PLAN: is company on matching plan?
     - ADD_ON: has company purchased matching add-on?
     - USAGE_LIMIT: has company exceeded usage threshold?
     - COMPANY_TRAIT: does traits[key] match?
     - USER_TRAIT: does user.traits[key] match?
     - ZKTLS_CLAIM: does verified zkTLS claim match?
3. If no rule matches → return flag.defaultValue
```

### SDK Usage (Customer App)

```tsx
// React component
import { FeatureFlagGuard, useEntitlement } from "@meap/react";

function MyComponent() {
  const { enabled } = useEntitlement("advanced_analytics");

  return (
    <FeatureFlagGuard flag="advanced_analytics">
      <AnalyticsDashboard />
    </FeatureFlagGuard>
  );
}

// Or check via API
const res = await fetch("/api/flags/check", {
  headers: { "Authorization": `Bearer ${apiKey}` },
  body: JSON.stringify({ flag: "advanced_analytics", company: { id: "acme" } })
});
```

---

## 13. Billing & Invoicing

### Invoice Lifecycle

```
DRAFT → ISSUED → PAID
                ↓
              OVERDUE (if past due date)
              ↓
            VOID (manually cancelled)
```

### Invoice Generation

Invoices are generated automatically when:
1. `BillingEvent` of type `SUBSCRIPTION_MINTED` is processed
2. `BillingEvent` of type `RENEWED` is processed
3. Manually created via dashboard or API

### PDF Generation

**Library**: `@react-pdf/renderer` or similar
**File**: `lib/invoice-documents.ts`

PDF includes:
- Provider logo + branding
- Invoice number (year-based sequence, e.g. INV-2025-0042)
- Line items with tax
- USDC amount + equivalent USD
- QR code linking to payment verification

### Tax Calculation

**File**: `lib/invoice-tax.ts`

Supports:
- GST (India) — GSTIN validation
- VAT (EU) — standard rates by country
- US Sales Tax — configurable by state
- No tax (international)

### Email Delivery

**Library**: Resend v6
**Trigger**: Invoice `ISSUED` state change
**Tracking**: `InvoiceDelivery` table with Resend message ID

---

## 14. ZK Proof System

### Overview

The **ZKVUB Protocol** (Zero-Knowledge Verifiable Usage Billing) enables metered billing without revealing raw usage data.

### Circuit

**File**: `circuits/UsageBilling.circom`

```
Inputs (private):
  - raw usage events array
  - timestamps
  - session salt

Outputs (public):
  - sessionId
  - agentAddress
  - callCount (aggregated)
  - windowStart, windowEnd
  - planId

Constraint: callCount == sum(valid events in window)
```

### Proof Generation (Off-Chain)

```typescript
import { groth16 } from "snarkjs";

const { proof, publicSignals } = await groth16.fullProve(
  privateInputs,
  "circuits/UsageBilling.wasm",
  "circuits/UsageBilling.zkey"
);
```

### Proof Verification (On-Chain)

```solidity
// ZKUsageVerifier.sol
function verifyAndSettle(
  uint[2] calldata _pA,
  uint[2][2] calldata _pB,
  uint[2] calldata _pC,
  uint[4] calldata _pubSignals  // [sessionId, agentAddr, callCount, planId]
) external {
  require(verifier.verifyProof(_pA, _pB, _pC, _pubSignals), "invalid proof");

  bytes32 nullifier = keccak256(abi.encode(sessionId, windowStart));
  require(!_nullifiers[nullifier], "already settled");
  _nullifiers[nullifier] = true;

  uint256 amount = callCount * _rateSchedule[planId];
  sessionVault.settle(sessionId, amount, provider);
}
```

### Nullifier (Anti Double-Spend)

Each settlement has a nullifier = `keccak256(sessionId || windowStart)`. Once settled, that window cannot be re-submitted. This prevents double-billing.

---

## 15. Cross-Chain Architecture

### Why Cross-Chain?

Your customers might subscribe on Sepolia (testnet) but your app runs on Base Mainnet. MirrorRegistry lets you check subscription status on any chain without cross-chain calls at query time.

### Message Flow

```
Customer subscribes on Sepolia (primary chain)
         ↓
SubscriptionRegistry emits SubscriptionUpdate event
         ↓
Facilitator picks up event (EventListenerService)
         ↓
AxelarTransport.dispatch(message, destinationChain)
         ↓
Axelar GMP delivers to MirrorRegistry on Base
         ↓
MirrorRegistry.updateSubscription(wallet, planId, expiresAt)
         ↓
Apps on Base can now call MirrorRegistry.isActive(wallet) → true
```

### Fallback (CCIP)

If Axelar delivery fails after 3 retries, the Facilitator switches to CCIPTransport (Chainlink CCIP) as backup.

### Message Deduplication

MirrorRegistry tracks `bytes32 messageId` for each received GMP message. Duplicate deliveries (both Axelar + CCIP for same event) are silently ignored.

---

## 16. zkTLS & Identity

**Contract**: `packages/contracts/contracts/identity/ZKCredentialGate.sol`
**Protocol**: [Reclaim Protocol](https://reclaimprotocol.org/)

### What Is zkTLS?

zkTLS allows users to prove facts about their Web2 accounts (GitHub, LinkedIn, Coinbase) **without sharing credentials or raw data**. A TLS session proof attests that a specific HTTPS response was received.

### Use Cases in ArcenPay

```typescript
// Example FlagRuleCondition with zkTLS
{
  conditionType: "ZKTLS_CLAIM",
  zkClaimType: "github_stars_gte_100",
  // → Only users who prove they have a GitHub repo with ≥100 stars get this flag
}

{
  conditionType: "ZKTLS_CLAIM",
  zkClaimType: "coinbase_kyc_verified",
  // → Enterprise tier only for KYC-verified users
}
```

### Proof Storage

Verified zkTLS proofs are stored in `ZkTlsProof` table:
```
ZkTlsProof {
  proofType: "github_stars",
  claimData: { stars: 342, repo: "myrepo" },
  verifiedAt: ...,
  expiresAt: (30 days)
}
```

---

## 17. Deployment Guide

### Prerequisites

```bash
node >= 20.0.0
npm >= 10.2.4
Docker (for Foundry tests)
PostgreSQL database
Redis instance
```

### 1. Environment Setup

```bash
# Copy env templates
cp .env.example .env
cp apps/arcen-dashboard/.env.example apps/arcen-dashboard/.env.local

# Fill in required values (see §18 Environment Variables)
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

```bash
cd apps/arcen-dashboard

# Apply schema to DB
npx prisma db push

# Generate Prisma client
npx prisma generate

# Optional: Open Prisma Studio
npx prisma studio
```

### 4. Deploy Smart Contracts

```bash
cd packages/contracts

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Deploy to Base Sepolia
npm run deploy:base-sepolia

# Deploy to Base mainnet
npm run deploy:base-mainnet

# Export deployment manifest (for SDK)
npx hardhat run scripts/export-environment-manifest.ts --network sepolia

# Run smoke tests
npm run smoke:sepolia
```

### 5. Post-Deployment Setup

```bash
# Authorize facilitator as settler in SessionVault
npx hardhat run scripts/authorize-facilitator-settler.ts --network sepolia

# Deploy and link Groth16 verifier
npx hardhat run scripts/set-groth16-verifier.ts --network sepolia

# Approve USDC token in PlanFactory
npx hardhat run scripts/approve-token.ts --network sepolia
```

### 6. Run Dev Servers

```bash
# All apps in parallel
turbo dev

# Dashboard only
cd apps/arcen-dashboard && npm run dev

# Facilitator only
cd apps/facilitator && npm run dev
```

### 7. Production Build

```bash
# Build all
turbo build

# Dashboard only
cd apps/arcen-dashboard && npm run build
```

### Contract Addresses

After deployment, addresses are exported to a manifest file. The dashboard reads these via `getContractAddresses(chainId)` from `@meap/core`.

---

## 18. Environment Variables

### `apps/arcen-dashboard/.env.local`

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | ✅ | WalletConnect project ID |
| `NEXT_PUBLIC_CHAIN_ID` | ✅ | Default chain (11155111 / 84532 / 8453) |
| `SIWE_JWT_SECRET` | ✅ | Secret for SIWE JWT signing |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk public key |
| `CLERK_SECRET_KEY` | ✅ | Clerk secret key |
| `CLERK_WEBHOOK_SECRET` | ✅ | Clerk webhook verification secret |
| `NEXT_PUBLIC_APP_URL` | ✅ | Public URL (e.g. https://app.arcenpay.xyz) |
| `RESEND_API_KEY` | ✅ | Resend email API key |
| `EMAIL_FROM` | ✅ | Sender email (e.g. billing@arcenpay.xyz) |
| `FACILITATOR_URL` | ✅ | Facilitator service URL |
| `FACILITATOR_SECRET` | ✅ | Shared secret for facilitator auth |
| `RPC_URL_SEPOLIA` | ✅ (testnet) | Sepolia RPC URL |
| `RPC_URL_BASE_SEPOLIA` | ✅ (testnet) | Base Sepolia RPC URL |
| `RPC_URL_BASE` | ✅ (mainnet) | Base mainnet RPC URL |
| `NEXT_PUBLIC_GRAPH_URL_SEPOLIA` | ⬜ | The Graph subgraph URL (Sepolia) |
| `NEXT_PUBLIC_GRAPH_URL_BASE` | ⬜ | The Graph subgraph URL (Base) |
| `NEXT_PUBLIC_USDC_ADDRESS_SEPOLIA` | ⬜ | Override USDC address (Sepolia) |
| `NEXT_PUBLIC_USDC_ADDRESS_BASE_SEPOLIA` | ⬜ | Override USDC address (Base Sepolia) |
| `PLAN_FACTORY_OWNER_PRIVATE_KEY` | ⬜ | For server-side plan registration |
| `SENTRY_DSN` | ⬜ | Sentry error tracking DSN |

### `apps/facilitator/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL_SEPOLIA` | ✅ | Sepolia RPC |
| `RPC_URL_BASE_SEPOLIA` | ✅ | Base Sepolia RPC |
| `RPC_URL_BASE` | ✅ | Base mainnet RPC |
| `PRIVATE_KEY` | ✅ | Facilitator wallet private key (pays gas) |
| `FACILITATOR_SECRET` | ✅ | Shared secret (must match dashboard) |
| `REDIS_URL` | ✅ | Redis connection string |
| `AXELAR_API_URL` | ✅ | Axelar GMP API |
| `TABLELAND_PRIVATE_KEY` | ⬜ | For Tableland usage logging |

### `packages/contracts/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | ✅ | Deployer wallet (funded with ETH) |
| `SEPOLIA_RPC_URL` | ✅ | Sepolia RPC |
| `BASE_SEPOLIA_RPC_URL` | ✅ | Base Sepolia RPC |
| `BASE_MAINNET_RPC_URL` | ✅ | Base mainnet RPC |
| `ETHERSCAN_API_KEY` | ✅ | For contract verification |
| `BASESCAN_API_KEY` | ⬜ | For Base contract verification |

---

## 19. Testing

### Smart Contracts

```bash
cd packages/contracts

# Forge tests (recommended)
npm run test                    # Auto-detect Docker/local
npm run test:forge:docker       # Force Docker (Foundry container)

# Hardhat tests
npm run test:hardhat

# Coverage report
npm run forge:coverage:docker

# Gas snapshots
npm run forge:snapshot:docker
```

Test files location: `packages/contracts/test/`

### Dashboard (TypeScript)

```bash
cd apps/arcen-dashboard

# Unit tests (Vitest)
npm test

# E2E tests (Playwright)
npm run test:e2e
```

### SDK Packages

```bash
cd packages/sdk-core   # or sdk-react, sdk-node
npm test               # Vitest
```

### Running All Tests

```bash
# From monorepo root
turbo test
```

---

## 20. Security Model

### Smart Contract Security

| Risk | Mitigation |
|------|-----------|
| Price manipulation | `maxAmount` cap on AutopayModule; provider sets max pull |
| Replay attacks | EIP-712 nonces in PlanFactory; nullifiers in ZKUsageVerifier |
| Reentrancy | `nonReentrant` modifier on all fund-moving functions |
| Access control | `onlyOwner`, `onlyAuthorized` modifiers on sensitive functions |
| Token rug | Only whitelisted tokens (USDC) accepted |
| Free plan on-chain | `price > 0` enforced at contract level |

### API Security

| Risk | Mitigation |
|------|-----------|
| SIWE replay | Nonces are single-use, stored in `AuthNonce`, expire in 5 min |
| Rate limiting | 20 nonce requests/min/IP |
| RBAC bypass | Team membership verified on every API call |
| Webhook spoofing | HMAC signature verification (Svix) |
| SQL injection | Prisma parameterized queries |
| API key exposure | Keys stored as argon2 hash; only prefix shown in UI |

### Wallet Security

| Risk | Mitigation |
|------|-----------|
| Excessive approval | AutopayModule has `maxAmount` per-account cap |
| Unauthorized pull | Only registered `merchant` address can call `execute()` |
| Module removal | User can `uninstallModule()` at any time to stop billing |
| Fund custody | ArcenPay never holds customer funds (non-custodial) |

---

## 21. Glossary

| Term | Definition |
|------|-----------|
| **MEAP** | Multi-chain Entitlement & Autopay Protocol — ArcenPay's underlying protocol |
| **ZKVUB** | Zero-Knowledge Verifiable Usage Billing — the metered billing subsystem |
| **PlanFactory** | Smart contract that stores plan configurations on-chain |
| **SubscriptionRegistry** | ERC-721 contract where each NFT = one active subscription |
| **AutopayModule** | ERC-7579 executor module installed on customer's smart account for auto-pull |
| **ERC-7579** | Standard for smart account executor modules |
| **ERC-5643** | Standard for subscription-based NFTs with expiry |
| **ERC-4337** | Account abstraction standard (enables smart accounts) |
| **SessionVault** | Escrow contract for usage-based billing (agent pre-funds) |
| **ZKUsageVerifier** | On-chain Groth16 proof verifier for usage settlement |
| **MirrorRegistry** | Cross-chain subscription state mirror via GMP |
| **FeeCollector** | Accumulates ArcenPay protocol fees |
| **GMP** | General Message Passing — cross-chain messaging (Axelar/CCIP) |
| **SIWE** | Sign-In With Ethereum — wallet-based authentication |
| **EIP-712** | Typed structured data signing standard (used for gasless plan creation) |
| **Groth16** | ZK-SNARK proving system used for usage proofs |
| **Circom** | Circuit description language for ZK proofs |
| **Nullifier** | One-time hash preventing double-spend in ZK settlement |
| **zkTLS** | TLS-based zkProof of Web2 data (via Reclaim Protocol) |
| **ChainSyncStatus** | `PENDING \| SYNCED \| FAILED \| NOT_APPLICABLE` — plan's on-chain state |
| **NOT_APPLICABLE** | ChainSyncStatus for free plans (price=0, never registered on-chain) |
| **x402** | HTTP 402 Payment Required protocol — payment headers for API monetization |
| **Tableland** | Decentralized SQL database for off-chain usage log storage |
| **Facilitator** | ArcenPay's backend service that relays transactions and settles payments |
| **Turbo** | Monorepo build tool (Turborepo) |
| **RBAC** | Role-Based Access Control — team permission system |
| **BPS** | Basis Points — fee unit where 100 bps = 1% |
| **USDC** | USD Coin — stablecoin used for all ArcenPay payments |
| **Smart Account** | ERC-4337 account abstraction wallet (ZeroDev) |
| **Catalog** | The complete set of plans, add-ons, credit types, and feature flags |
| **ArcenCompany** | Customer entity in the entitlement system (maps to wallet address) |
| **Entitlement** | A feature or limit granted to a company based on their plan/add-ons |
| **Feature Flag** | A boolean or value-based capability toggle controlled by billing rules |
| **CreditType** | A named unit of value customers can purchase in packs and burn |
| **Add-On** | Optional supplement to a base plan (one-time or recurring) |
| **Invoice Sequence** | Year-based auto-increment counter for invoice numbers |
| **Svix** | Webhook delivery service with retry and signing |
| **Resend** | Email delivery API used for invoices and notifications |
| **AppKit** | Reown's WalletConnect v2 modal + wagmi adapter |
| **viem** | TypeScript Ethereum client library |
| **wagmi** | React hooks for Ethereum (built on viem) |
| **Prisma** | TypeScript ORM for PostgreSQL |

---

*Wiki generated from ArcenPay monorepo — last updated 2026-03-25*
