# Changelog

All notable changes to ArcenPay are documented here.

---

## [1.0.0] — Current (Pre-GA)

### Added

- Provider dashboard (Next.js 16 + Prisma + PostgreSQL)
- Core billing engine and REST API (Hono v4, Prisma v7, PostgreSQL)
- Public SDK packages: `@arcenpay/node` and `@arcenpay/react`, plus the shared
  private `@arcenpay/internal-core` runtime (chains, ABIs, addresses)
- Solana subscription program (Anchor) with SDK-integrated chain support
- Circom zk-SNARK circuits for usage billing proofs
- Email magic-link authentication with wallet linking
- EIP-712 x402 payment validation with anti-replay
- Subscription minting via sponsored smart accounts + Autopay module
- Session vault with ZK usage proof settlement
- Embeddable billing UI via `ArcenEmbed`
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
- Agent pre-approval/funding flow: the dashboard funds the ZKVUB session vault
  on EVM, records funding via a durable preApprovals ledger, and resets the
  Stellar transfer flow cleanly
- Agent multi-chain funding reliability: a receipt-driven approval state machine
  (approve → fund → record) and per-chain agent wallets so each EVM/Stellar/
  Solana chain keeps its own agent wallet
- Platform tiers (FREE / PLUS / PRO) with limits
- Gas sponsorship via hosted paymaster
- CI/CD pipelines: hygiene gate, SDK, backend, dashboard, and Solana program
