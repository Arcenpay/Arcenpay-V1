# Changelog

All notable changes to ArcenPay are documented here.

---

## [0.0.1] — Current (Pre-GA)

### Added
- Provider dashboard (Next.js 16 + Prisma + PostgreSQL)
- Facilitator runtime bridge (Express + x402 middleware + event watchers)
- 7 Solidity smart contracts deployed to Sepolia + Base Sepolia
- 3 public SDK packages: `sdk-node`, `sdk-react`, `sdk-agent`, plus the private internal core
- Email magic-link authentication with wallet linking
- EIP-712 x402 payment validation with anti-replay
- Subscription minting via sponsored smart accounts + AutopayModule
- Agent session vault with ZK usage proof settlement
- Embeddable billing UI via `ArcenEmbed`
- The Graph subgraph for on-chain analytics
- Circom zk-SNARK circuits for usage billing proofs
- Catalog management: plans, add-ons, credits, coupons
- Feature flag engine with DB-first rules and on-chain fallback
- Invoicing, billing events, webhook delivery, dunning
- Invoice Builder (`/invoices/templates`): declarative JSON layouts, logo,
  brand colors, fonts, watermark and portrait/landscape PDF rendering with
  immutable per-invoice design snapshots (Plus/Pro)
- White-label embed branding: "Secured by ArcenPay" can be removed only on
  Plus/Pro (server-enforced via `component-render` branding policy)
- On-demand (Stripe-style) invoice PDFs: signed render URLs, never stored;
  immutable per-invoice design snapshots; Tax ID/GSTIN + wallet-safe wrapping
- Cloudflare R2 object storage (SigV4, zero SDK deps) for logos/assets with a
  local filesystem dev fallback (`STORAGE_DRIVER=r2|local`)
- Stripe-style credentials: secret/publishable/restricted keys
  (`sk_/pk_/rk_` + `_live_/_test_`), permissions, expiry/revocation, show-once
  hashed storage, and company-scoped `arc_tok_` temporary access tokens
- React SDK publishable-key client-safe reads (`pk_` + `X-Arcen-Company-Keys`)
- Redesigned invoice/receipt emails around a shared on-brand email shell
- Billing & Plan "What's included" feature matrix (invoice builder, white-label,
  support, cross-chain, ZK, x402 per tier)
- Agent pre-approval/funding fix: dashboard Step 2 funds the ZKVUB session vault on EVM (approve vault to fundSession) instead of approving the bare agent EOA, records funding via a durable preApprovals ledger (POST /api/v1/agent/fund), and properly resets the Stellar transfer flow (previously stuck).
- Agent multi-chain + funding reliability: wagmi-receipt-driven approval state machine (approve → fund → record) so Step 2 never hangs waiting for a receipt; chain-mismatch guard with in-UI "Switch network"; per-chain agent wallets (ArcenAgentConfig.agentWallets JSON map, migration 20260916000004) so each EVM/Stellar chain keeps its own agent wallet.

- Platform tiers (FREE / PLUS / PRO) with limits
- Gas sponsorship via hosted paymaster
- Tableland flag mirroring (optional)
- Lit Protocol subscription-gated decryption (optional)
- Cross-chain relay (Axelar/CCIP — in progress)
- CI/CD pipelines: hygiene gate, contract tests, typecheck, lint, E2E
