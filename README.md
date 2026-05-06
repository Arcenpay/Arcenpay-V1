# ArcenPay

**Web3 Entitlement Layer** — On-chain subscription billing, feature entitlement gating, and usage-based settlement for SaaS providers.

---

## Architecture

ArcenPay is a monorepo (Turborepo + npm workspaces) containing the provider dashboard, runtime bridge, smart contracts, zk-SNARK circuits, and SDKs.

```
fervent-buck/
├── apps/
│   ├── arcen-dashboard/   # Provider control plane (Next.js 16 + Prisma + PostgreSQL)
│   ├── facilitator/        # Runtime bridge — x402 validator, event watcher, billing keeper
│   ├── arcen-demo/         # Integration demo consuming the SDKs
│   └── docs/               # Protocol documentation site
├── packages/
│   ├── sdk-core/           # Shared types, ABIs, chain config, contract addresses
│   ├── sdk-node/           # Server SDK — x402 middleware, billing services, tableland
│   ├── sdk-react/          # React SDK — embeddable billing components, hooks
│   ├── sdk-agent/          # AI agent x402 client SDK
│   └── contracts/          # Solidity smart contracts (Hardhat + Foundry)
├── circuits/               # Circom zk-SNARK circuits (Groth16 usage proofs)
├── subgraph/               # The Graph indexer for on-chain analytics
├── scripts/                # Deployment, verification, and utility scripts
└── docs/                   # Product wiki, runbooks, architecture decisions
```

### Two Billing Lanes

| Lane | Flow | Use Case |
|------|------|----------|
| **Subscription** | Wallet → smart account → autopay → USDC approve → mint NFT → periodic renewals | Human SaaS customers |
| **Usage-based** | Agent funds vault → API returns 402 → signs EIP-712 → validate → log usage → aggregate → ZK prove → settle | AI agents / paid APIs |

---

## Quick Start

### Prerequisites
- Node.js >= 20.0.0
- PostgreSQL 16 + Redis 7 (via Docker)
- npm 10.x

### Setup

```bash
# 1. Clone and install
git clone <repo-url> && cd fervent-buck
cp .env.example .env    # Fill in required values
npm ci

# 2. Start infrastructure
docker compose up -d    # PostgreSQL + Redis

# 3. Generate Prisma client + build SDKs
npm run build

# 4. Run the dashboard
npm run dev:dashboard   # http://localhost:3000

# 5. Run the facilitator (in another terminal)
npm run dev:facilitator # http://localhost:3402

# 6. Run the demo app
npm run dev:demo        # http://localhost:3001
```

### Core Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start all apps in Turbo TUI |
| `npm run build` | Build all packages + apps |
| `npm run test` | Run all tests |
| `npm run typecheck` | Type-check all packages + apps |
| `npm run lint` | Lint all packages + apps |
| `npm run clean` | Clean build outputs |
| `npm run format` | Format with Prettier |

---

## Environment Configuration

See [`.env.example`](.env.example) for all required and optional variables. Key variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_CHAIN_ID` | Default chain (84532 = Base Sepolia) |
| `FACILITATOR_SECRET` | Shared secret for dashboard ↔ facilitator auth |
| `ACCESS_TOKEN_SECRET` | JWT signing key for embed tokens |
| `SIWE_JWT_SECRET` | Session signing key |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `REDIS_URL` | Redis connection (required for production) |

---

## Documentation

- [Product Wiki](docs/WIKI.md) — Full feature reference
- [Operations Runbook](docs/OPERATIONS_RUNBOOK.md) — Deployment and monitoring
- [Incident Runbook](docs/INCIDENT_RUNBOOK.md) — On-call procedures
- [GA Migration Notes](docs/MIGRATION_GA.md) — Production launch checklist
- [Testnet Integration Checklist](docs/testnet-integration-checklist.md)
- [PlanFactory Ownership Runbook](docs/plan-factory-ownership-runbook.md)

---

## License

Proprietary — all rights reserved.
