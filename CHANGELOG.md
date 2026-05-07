# Changelog

All notable changes to ArcenPay are documented here.

---

## [0.0.1] — Current (Pre-GA)

### Added
- Provider dashboard (Next.js 16 + Prisma + PostgreSQL)
- Facilitator runtime bridge (Express + x402 middleware + event watchers)
- 7 Solidity smart contracts deployed to Sepolia + Base Sepolia
- 4 SDK packages: `sdk-core`, `sdk-node`, `sdk-react`, `sdk-agent`
- Email magic-link authentication with wallet linking
- EIP-712 x402 payment validation with anti-replay
- Subscription minting via ZeroDev smart accounts + AutopayModule
- Agent session vault with ZK usage proof settlement
- Embeddable billing UI via `ArcenEmbed`
- The Graph subgraph for on-chain analytics
- Circom zk-SNARK circuits for usage billing proofs
- Catalog management: plans, add-ons, credits, coupons
- Feature flag engine with DB-first rules and on-chain fallback
- Invoicing, billing events, webhook delivery, dunning
- Platform tiers (FREE / PLUS / PRO) with limits
- Gas sponsorship via ZeroDev paymaster
- Tableland flag mirroring (optional)
- Lit Protocol subscription-gated decryption (optional)
- Cross-chain relay (Axelar/CCIP — in progress)
- CI/CD pipelines: hygiene gate, contract tests, typecheck, lint, E2E
