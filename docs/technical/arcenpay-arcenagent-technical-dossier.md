# ArcenPay + ArcenAgent Technical Dossier

Document version: 1.0
Generated at: 2026-03-29 11:32:43Z
Audience: External technical stakeholders (core) + Internal engineering/operators (appendix)
Scope policy: Implemented behavior is documented as current state; roadmap is isolated in Chapter 9

## Source-of-Truth Contract

This document follows strict precedence while authoring:

1. Tier 1 (authoritative): Solidity contracts, SDK source exports/types, deployment manifest
2. Tier 2: Facilitator and dashboard runtime code
3. Tier 3: Existing docs pages only when consistent with Tier 1/2

Primary code sources:
- `packages/contracts/contracts/core/*.sol`
- `packages/contracts/contracts/interfaces/*.sol`
- `packages/contracts/deployments/sepolia-latest.json`
- `packages/sdk-core/src/*`
- `packages/sdk-react/src/*`
- `packages/sdk-node/src/*`
- `packages/sdk-agent/src/*`
- `apps/facilitator/src/server.ts`
- `apps/arcen-dashboard/app/api/**/route.ts`
- `apps/arcen-dashboard/prisma/schema.prisma`
- `apps/arcen-dashboard/lib/flag-engine.ts`

## Core/Appendix Split

- Part I (Chapters 1-10) is external-ready and excludes sensitive operational secrets.
- Part II (Appendices A-D) is internal and operationally detailed.

---

## 1. Product Positioning and Problem Gap

### 1.1 What Arcen builds

Arcen is a wallet-native billing and entitlement platform with two integrated subsystems:

- ArcenPay Protocol: recurring subscription billing and entitlement state for users/organizations
- ZKVUB (Zero-Knowledge Verifiable Usage Billing): metered usage billing for AI agents and paid APIs

### 1.2 Problem gaps in existing Web2 billing stacks

Traditional billing platforms (for example Stripe, Polar) are strong for card-first SaaS flows, but crypto-native and agent-native systems have additional constraints:

- Non-custodial wallets and smart accounts require constrained on-chain pull semantics, not broad card mandates.
- Entitlements need chain-verifiable state for composability across contracts/apps/chains.
- Agent-to-agent/API monetization needs machine-payable HTTP payment flows with replay-safe signatures.
- Usage settlement needs tamper resistance without forcing every API call on-chain.

### 1.3 Arcen differentiation

Arcen combines:

- ERC-7579 autopay for constrained recurring pulls.
- ERC-721/ERC-5643 style subscription state for on-chain entitlement checks.
- x402 payment-gated API access for machine clients.
- SessionVault pre-funding + ZKUsageVerifier proof settlement for usage billing.
- Cross-chain entitlement mirroring (Axelar primary, CCIP fallback route handling).
- Unified dashboard + SDK surface across recurring and usage-based billing.

---

## 2. Platform Architecture

### 2.1 Subsystems and boundaries

| Subsystem | Primary purpose | On-chain core | Off-chain core |
|---|---|---|---|
| ArcenPay | Recurring subscription billing + entitlement state | PlanFactory, SubscriptionRegistry, ERC7579AutopayModule, FeeCollector, MirrorRegistry | Dashboard catalog/invoicing APIs, keeper automation, webhook/email delivery |
| ZKVUB / ArcenAgent | Metered usage billing for AI/API traffic | SessionVault, ZKUsageVerifier, FeeCollector | x402 middleware, usage aggregation, proof orchestration, settlement writer, agent SDK |

### 2.2 Control plane vs data plane

Control plane:
- Provider onboarding/plan config, tiering, feature rules, API keys, templates, invoice policy.
- Runtime guardrails (environment mode, chain readiness checks, authorization lists).

Data plane:
- On-chain subscription mint/renew/cancel and session settlement.
- x402 request verification and usage event aggregation.
- zk proof submission and provider payout settlement.

### 2.3 Recurring billing flow (implemented)

1. Provider registers and creates plan in `PlanFactory`.
2. Subscriber smart account installs `ERC7579AutopayModule` with `AutopayConfig`.
3. Provider/biller calls `execute(account, amount)` on module when interval elapses.
4. Module computes protocol fee via `FeeCollector`, transfers net to merchant, and mints/renews subscription via `SubscriptionRegistry`.
5. Optional cross-chain entitlement mirror dispatch is attempted (Axelar first, CCIP fallback path).

### 2.4 Agent usage billing flow (implemented)

1. Agent pre-funds `SessionVault` via `fundSession(amount, token)`.
2. Agent calls paid endpoint; server returns HTTP 402 challenge if payment header missing.
3. Agent signs EIP-712 payment payload and retries with `X-PAYMENT` header.
4. x402 middleware validates payload, signature, nonce freshness, and session balance.
5. Usage entries are aggregated; proof pipeline submits Groth16 proof to `ZKUsageVerifier`.
6. `ZKUsageVerifier` verifies proof, marks nullifier, computes settlement + fee, and settles from `SessionVault` to provider.

---

## 3. On-Chain Core

### 3.1 Contract catalog (implemented)

| Contract | Role | Key mutable state | Key write paths | Main controls |
|---|---|---|---|---|
| PlanFactory | Provider registration + plan registry | providers, plans, approvedTokens, nonces | `registerProvider`, `createPlan`, `createPlanFor`, `updatePlan`, `deactivatePlan` | Ownable, Pausable, EIP-712 replay-protected nonces |
| SubscriptionRegistry | Subscription NFT lifecycle and validity | expirations, token->plan, wallet->token, biller/bridge auth | `mint`, `renew`, `cancel`, `dispatchCrossChainUpdate`, `setCrossChainTransports` | Ownable, ReentrancyGuard, Pausable, authorized billers/bridges |
| ERC7579AutopayModule | Constrained recurring pull execution | per-account config, interval timestamps, total pulled, account pause, pending dispatch | `onInstall`, `execute`, `pauseAccount`, `retryDispatch`, `onUninstall` | Merchant-only execute, interval/min amount checks, optional maxTotalAmount cap |
| FeeCollector | Protocol fee policy and treasury accumulation | tier fee mappings, provider overrides, accumulated fees, authorized collectors | `collectSubscriptionFee*`, `collectSettlementFee*`, `receiveFee`, `syncProviderTier`, `withdrawFees` | Ownable + authorized collector gate |
| SessionVault | Pre-funded agent session balances | sessions, agent session sets, authorizedSettlers, optional provider whitelist | `fundSession`, `topUp`, `settle`, `withdraw` | onlySettler for settlement, optional provider whitelist, Ownable/Pausable |
| ZKUsageVerifier | zk proof verification and settlement trigger | used nullifiers, rate schedules, per-session settlement config, verifier address | `submitProof`, `setRateSchedule`, `setGroth16Verifier`, `setSessionSettlementConfig` | Nullifier anti-replay, proof validity checks, Ownable/Pausable |
| MirrorRegistry | Cross-chain entitlement mirror | trusted sources, authorized bridges, processed message IDs, mirrored subscription mapping | `onGMPReceived`, `onAxelarMessage`, `onCCIPMessage`, trusted source config | source hash verification, duplicate suppression, route-specific auth |

### 3.2 Cross-contract call paths (implemented)

Recurring path:
- `ERC7579AutopayModule.execute` -> `FeeCollector.collectSubscriptionFeeFor` -> token `safeTransferFrom` -> `SubscriptionRegistry.mint/renew` -> `SubscriptionRegistry.dispatchCrossChainUpdate` (optional)

Usage path:
- `ZKUsageVerifier.submitProof` -> `_verifyProof` via configured Groth16 verifier -> `FeeCollector.collectSettlementFee` -> `SessionVault.settle`

Entitlement mirror path:
- `SubscriptionRegistry.dispatchCrossChainUpdate` tries Axelar transport first; emits fallback event and tries CCIP transport on failure.
- `MirrorRegistry` validates route caller + trusted source hash + message id uniqueness before applying updates.

### 3.3 Protocol invariants and constraints (implemented)

- Plan creation enforces approved token and minimum 30-day interval.
- Autopay execution enforces merchant match, max amount, interval elapsed, optional max total.
- Subscription validity is timestamp-based expiry.
- Session settlement requires authorized settler and sufficient session balance.
- ZK settlement requires verifier configured, unused nullifier, valid proof public inputs, and non-future windows.
- Mirror updates reject duplicate message IDs and invalid source hashes.

### 3.4 Core events (implemented, selected)

- PlanFactory: `PlanCreated`, `PlanUpdated`, `PlanDeactivated`, `ProviderRegistered`
- SubscriptionRegistry: `SubscriptionMinted`, `SubscriptionRenewed`, `SubscriptionCancelled`, `CrossChainDispatchRequested`, `CrossChainFallbackTriggered`
- ERC7579AutopayModule: `AutopayConfigured`, `PaymentExecuted`, `AccountAutopayPaused`, `AccountAutopayUnpaused`, `CrossChainDispatchRetried`, `CrossChainDispatchFailed`
- SessionVault: `SessionFunded`, `SessionSettled`, `SessionWithdrawn`
- ZKUsageVerifier: `BillingSettled`, `Groth16VerifierSet`, `SessionSettlementConfigured`
- MirrorRegistry: `SubscriptionMirrored`, `RoutedMessageProcessed`
- FeeCollector: `FeeCollected`, `FeesWithdrawn`, `ProviderFeeRateSet`, `ProviderTierSynced`

---

## 4. Off-Chain Runtime

### 4.1 Facilitator responsibilities (implemented)

`apps/facilitator/src/server.ts` runs:

- x402-protected premium endpoint routing.
- Additional replay window guard (`X402ReplayProtection`) before middleware verification.
- Optional on-chain settlement writer integration for immediate settlement.
- Usage aggregation + proof orchestration + proof history visibility.
- Durable queue operations for billing and webhook replay workflows.
- Entitlement APIs (Tableland-first with chain fallback where configured).
- Session introspection APIs and operational endpoints (`/metrics`, `/health`, proof/queue/replay stats).

### 4.2 x402 verification pipeline (implemented)

Node middleware validation sequence in `packages/sdk-node/src/middleware/x402.ts`:

1. Decode `X-PAYMENT` header.
2. Parse payload and normalize resource URL.
3. Reconstruct EIP-712 typed data and recover signer.
4. Enforce signer/payload consistency.
5. Enforce timestamp freshness window and nonce uniqueness.
6. Verify on-chain session balance (`SessionVault.getAgentBalance`) unless fail-open override is explicitly enabled.
7. Optionally call settlement hook and attach verified payment context to request.

### 4.3 Usage proof and settlement orchestration (implemented)

- Aggregation captures per-session usage entries and computes report windows.
- `ProofOrchestrator` coordinates input generation, retries, duplicate/nullifier handling, and settlement submission paths.
- Strict vs dev proof modes are runtime configurable; production profile enforces stricter checks in facilitator runtime validation.

### 4.4 Operational reliability controls (implemented)

- Per-wallet x402 rate limiter and replay rejection counter.
- Queue dead-letter listing and replay endpoints.
- Prometheus metrics for request counts, validation errors, queue depth, and proof/on-chain submission latencies.
- Health/info endpoints exposing runtime profile and component readiness.

---

## 5. SDK Layer

### 5.1 `@arcenpay/sdk` (core)

Provides chain configuration, ABIs, type contracts, environment manifest helpers, error normalization, and address resolution.

Notable exports:
- ABIs: `PlanFactoryABI`, `SubscriptionRegistryABI`, `ERC7579AutopayModuleABI`, `SessionVaultABI`, `ZKUsageVerifierABI`, `FeeCollectorABI`, `MirrorRegistryABI`
- Address/environment: `getContractAddresses`, `getChainEnvironment`, `validateChainEnvironment`
- Types: plans/subscriptions/entitlements/x402 payloads, network/service manifests

### 5.2 `@arcenpay/react`

Provides provider + UI components + hooks around wallet/chain integrations.

Key exports include:
- Provider/context: `MEAPProvider`, `ArcenPayProvider`, `useMEAP`, `useArcenPay`
- Components: `PricingTable`, `CheckoutModal`, `SubscriptionStatus`, `FeatureFlagGuard`, `UsageDashboard`, `BillingHistory`, `TemplateRenderer`, `InvoiceList`, `ArcenEmbed`
- Hooks/utilities: `useEntitlement`, `deploySmartAccount`, `revokeAutopayModule`

Integration contract:
- Provider resolves chain environment and facilitator URL from manifest/env.
- Session context can come from direct token prop or access-token bootstrap endpoint.

### 5.3 `@arcenpay/node`

Backend package for x402 gating, usage/proof services, transports, keeper automation, and durable nonce handling.

Key exports include:
- `x402Middleware`
- `UsageService`, `ProofOrchestrator`, `SettlementService`, `SettlementWriterService`
- `WebhookService`, `EmailService`, `TablelandService`, `LitProtocolService`
- `AxelarTransport`, `CCIPTransport`
- `BillingKeeper`
- `InMemoryNonceStore`, `RedisNonceStore`

### 5.4 `@arcenpay/agent`

Agent runtime SDK currently exports `MEAPAgent` and alias `ArcenPayAgent`.

Implemented behavior:
- `fundSession(amount)` approves USDC and funds `SessionVault`.
- `fetch(url, options)` performs x402 negotiation and auto-signing.
- EIP-712 typed data signature generation for payment payload.
- Nonce management that advances only on successful paid response.
- Balance checks via `SessionVault.getAgentBalance`.

### 5.5 Integration flows (implemented)

Frontend SaaS flow:
1. App wraps with `ArcenPayProvider`.
2. UI selects plan via `PricingTable`/custom components.
3. Checkout installs autopay and writes subscription state.
4. Feature checks resolve via entitlement APIs/hooks.

Backend paid API flow:
1. Route protected with `x402Middleware`.
2. Client receives 402 challenge and resubmits signed payment header.
3. Middleware validates and passes verified context to business handler.

Agent flow:
1. Agent funds session.
2. Agent calls metered endpoint with `fetch` wrapper.
3. Header negotiation + signature + retry occurs automatically.
4. Usage is aggregated and settled through proof pipeline.

---

## 6. Dashboard/Data Model

### 6.1 Data domains (implemented)

`apps/arcen-dashboard/prisma/schema.prisma` includes:

- Identity/workspace: `User`, `Team`, `TeamMember`, `ProviderProfile`, auth nonce/magic token models
- Catalog: plans, add-ons, credits, versioning/config entities
- Templates: template entities + install/version lifecycle
- Billing: invoices, delivery status, tax profiles, credit notes, sequences
- Reliability/audit: billing events, webhook delivery log, audit events, support operations
- Web3 layer: company/user entities, feature flags/rules/overrides, API keys/access tokens, zkTLS proof records, embedded components

### 6.2 API surface organization (implemented)

Dashboard APIs cover:
- Catalog management + publish + chain sync
- Templates install/versioning
- Invoices and public signed download
- Team/member/invite and role-bound operations
- Provider profile/webhooks/api keys
- Platform tier/gas/session/proof operational views
- v1 external APIs for company/user/flags/events/components/proofs/access tokens

### 6.3 Flag engine (implemented)

`apps/arcen-dashboard/lib/flag-engine.ts` evaluation order:

1. Company overrides (highest priority)
2. Ordered targeting rules (all conditions in rule must pass)
3. Flag default value

Supported criteria include:
- Base plan
- Add-on presence
- Usage metric threshold checks
- Company/user trait targeting
- zkTLS claim presence

On-chain fallback exists for plan resolution when local company plan pointer is missing and wallet is available.

---

## 7. Security and Trust Model

### 7.1 Authorization boundaries (implemented)

On-chain:
- Ownable admin paths gate provider registration, collector/settler/bridge authorization, fee policy, and pause controls.
- Specialized roles (`authorizedBillers`, `authorizedSettlers`, `authorizedBridges`) scope critical actions.

Off-chain:
- Facilitator secret-gated operational endpoints where configured.
- x402 middleware enforces signature correctness, replay and freshness checks, and balance checks.
- Durable nonce store option (`RedisNonceStore`) supports multi-instance replay safety.

### 7.2 Replay and double-spend protections (implemented)

- x402 level: nonce dedup + timestamp validity window + optional external replay-protection cache in facilitator.
- zk settlement level: nullifier map in `ZKUsageVerifier` rejects proof re-use.
- cross-chain mirror level: processed message ID suppression in `MirrorRegistry`.

### 7.3 Failure modes and mitigations (implemented)

- Failed dispatch: autopay payment can still succeed; failed mirror dispatch is tracked and retryable.
- Balance read failures: default behavior is fail-closed unless explicit fail-open override enabled.
- Queue failures: dead-letter replay endpoints available.
- Proof pipeline failures: retry and history surfaces expose stalled jobs.

### 7.4 Sensitive data handling boundary

This dossier excludes secrets, private keys, and environment-specific secret values. Only variable names, control flows, and integration expectations are documented.

---

## 8. Deployment + Environments

### 8.1 Chain/environment manifest model (implemented)

`@arcenpay/sdk` uses chain environment manifest helpers:
- `getChainEnvironment(chainId)`
- `validateChainEnvironment(chainId, options)`

Default chain entries exist for:
- 11155111 (Ethereum Sepolia)
- 84532 (Base Sepolia)
- 8453 (Base Mainnet)

Address behavior:
- Sepolia has concrete deployed addresses in source.
- Base Sepolia and Base Mainnet rely on env override injection until deployed values are finalized.

### 8.2 Canonical Sepolia deployment (current)

Deployment source: `packages/contracts/deployments/sepolia-latest.json`

| Item | Value |
|---|---|
| Network | sepolia |
| Chain ID | 11155111 |
| deployedAt | 2026-03-19T14:47:01.668Z |
| PlanFactory | 0x4F97E0c2Ac053b735640fEb164a08Cb45ba83db1 |
| FeeCollector | 0xa8A0D3007e5680D387A50C1a1E2Eb0AD092ca396 |
| SubscriptionRegistry | 0xE206C519076535A9d24c852093860CFD780908C1 |
| SessionVault | 0xd68b9C0a34d61CC3b3F982A5EC6Cc5a5739e46D9 |
| ZKUsageVerifier | 0x1f75d66692416cE880d51Baf6CdcBeE98E5837c0 |
| ERC7579AutopayModule | 0xc82417e378b23AD9Ae73229EF08a4BA7896a4351 |
| MirrorRegistry | 0xC187CD32d569ec0E84B9b378f8E63f3a74afac74 |
| USDC | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 |
| Treasury | 0x38f62CCfD6F771eF9E48e3bb86a3E0413aE5319B |

### 8.3 Runtime readiness gates (implemented)

Facilitator startup validation checks include:
- chain environment validity
- production-specific strict proof requirements
- required RPC and secret config
- settlement authorization checks where enabled
- artifact existence checks for strict proof mode

Dashboard/config layer includes:
- environment mode checks
- facilitator URL/secret integration constraints
- invoice signing/storage expectations

---

## 9. Roadmap (Forward-Looking)

This chapter is intentionally forward-looking and not a claim of shipped behavior.

Source planning documents:
- `PRD/planning.md`
- `PRD/ArcenPay End-to-End Production Plan.docs.txt`

### 9.1 Delivery themes

- Production GA hardening across billing, templates, invoices, RBAC/audit, reliability, and compliance.
- Controlled progression from testnet-heavy workflows toward Base production readiness.
- Broader operational hardening for queue durability, replay tooling, and incident response.

### 9.2 Planned focus areas

- Strengthen dashboard publish/sync workflows and visibility into chain sync outcomes.
- Expand and harden template lifecycle and integration contracts.
- Improve invoice pipeline throughput/reliability and compliance coverage.
- Continue security validation and external audit closure before wide GA.

### 9.3 Explicit roadmap caution

Anything in this chapter must be treated as intent until reflected in Tier 1/Tier 2 code and deployment manifests.

---

## 10. FAQ / Objection Handling

### Q1. Why not just use Stripe or Polar?

Arcen is not a card-rail clone. It solves constraints that are native to Web3 and autonomous agents:
- constrained recurring smart-account pulls
- on-chain subscription/entitlement state
- machine-to-machine payment negotiation over HTTP 402/x402
- cryptographically verifiable usage settlement

### Q2. What is technically unique about Arcen?

The uniqueness is the combination of:
- recurring wallet billing primitives
- usage billing with zk proof settlement
- session-based pre-funded spending control
- one integrated SDK + dashboard + protocol surface across both human and agent billing

### Q3. Is this only concept-level or implemented?

Core protocol contracts, SDK packages, and facilitator runtime are implemented in this repository and deployed on Sepolia as listed in Chapter 8. Base production posture still depends on deployment/address rollout and readiness checks.

### Q4. How is replay or double-spend risk handled?

- x402 nonce + timestamp checks in middleware and optional replay cache
- nullifier tracking in `ZKUsageVerifier`
- duplicate message suppression in `MirrorRegistry`

### Q5. Where are the sharp edges right now?

- Documentation drift exists in some docs pages (see Appendix D).
- Not all docs examples match current package exports and manifest addresses.
- Base network addresses in source are placeholder-zero until deployment overrides are set.

---

# Part II - Internal Appendix

## Appendix A. Full Endpoint Inventory and Runbook Pointers

### A.1 Dashboard API endpoint inventory (extracted from route handlers)

Format: `METHODS<TAB>PATH<TAB>FILE`

```text
count 82
GET	/api/audit-log	/apps/arcen-dashboard/app/api/audit-log/route.ts
POST	/api/auth/link-wallet	/apps/arcen-dashboard/app/api/auth/link-wallet/route.ts
GET	/api/auth/nonce	/apps/arcen-dashboard/app/api/auth/nonce/route.ts
GET	/api/auth/wallet-status	/apps/arcen-dashboard/app/api/auth/wallet-status/route.ts
GET,POST	/api/billing/events	/apps/arcen-dashboard/app/api/billing/events/route.ts
DELETE,GET,POST,PUT	/api/catalog/add-ons/[id]/entitlements	/apps/arcen-dashboard/app/api/catalog/add-ons/[id]/entitlements/route.ts
GET,POST,PUT	/api/catalog/add-ons	/apps/arcen-dashboard/app/api/catalog/add-ons/route.ts
POST	/api/catalog/chain-sync	/apps/arcen-dashboard/app/api/catalog/chain-sync/route.ts
GET,PUT	/api/catalog/config	/apps/arcen-dashboard/app/api/catalog/config/route.ts
DELETE,GET,POST	/api/catalog/credits/[id]/bundles	/apps/arcen-dashboard/app/api/catalog/credits/[id]/bundles/route.ts
DELETE,GET,POST	/api/catalog/credits/[id]/plan-grants	/apps/arcen-dashboard/app/api/catalog/credits/[id]/plan-grants/route.ts
GET,POST,PUT	/api/catalog/credits	/apps/arcen-dashboard/app/api/catalog/credits/route.ts
POST	/api/catalog/plans/[id]/chain-confirm	/apps/arcen-dashboard/app/api/catalog/plans/[id]/chain-confirm/route.ts
DELETE,GET,POST	/api/catalog/plans/[id]/credit-grants	/apps/arcen-dashboard/app/api/catalog/plans/[id]/credit-grants/route.ts
DELETE,GET,POST,PUT	/api/catalog/plans/[id]/entitlements	/apps/arcen-dashboard/app/api/catalog/plans/[id]/entitlements/route.ts
POST	/api/catalog/plans/[id]/register-on-chain	/apps/arcen-dashboard/app/api/catalog/plans/[id]/register-on-chain/route.ts
GET	/api/catalog/plans/[id]/sign-nonce	/apps/arcen-dashboard/app/api/catalog/plans/[id]/sign-nonce/route.ts
DELETE,GET,POST,PUT	/api/catalog/plans	/apps/arcen-dashboard/app/api/catalog/plans/route.ts
POST	/api/catalog/publish	/apps/arcen-dashboard/app/api/catalog/publish/route.ts
DELETE,GET,PATCH,POST,PUT	/api/entitlements/provider/[provider]/flags/[[...segments]]	/apps/arcen-dashboard/app/api/entitlements/provider/[provider]/flags/[[...segments]]/route.ts
POST	/api/environment/switch	/apps/arcen-dashboard/app/api/environment/switch/route.ts
PATCH	/api/internal/companies/sync-subscription	/apps/arcen-dashboard/app/api/internal/companies/sync-subscription/route.ts
POST	/api/internal/preview-token	/apps/arcen-dashboard/app/api/internal/preview-token/route.ts
GET,POST	/api/invoices/[id]/credit-notes	/apps/arcen-dashboard/app/api/invoices/[id]/credit-notes/route.ts
GET	/api/invoices/[id]/download	/apps/arcen-dashboard/app/api/invoices/[id]/download/route.ts
POST	/api/invoices/[id]/resend	/apps/arcen-dashboard/app/api/invoices/[id]/resend/route.ts
GET,PATCH	/api/invoices/[id]	/apps/arcen-dashboard/app/api/invoices/[id]/route.ts
GET	/api/invoices/public/[id]/download	/apps/arcen-dashboard/app/api/invoices/public/[id]/download/route.ts
GET,POST	/api/invoices	/apps/arcen-dashboard/app/api/invoices/route.ts
POST	/api/ops/billing-events/dead-letter/[id]	/apps/arcen-dashboard/app/api/ops/billing-events/dead-letter/[id]/route.ts
GET,POST	/api/ops/billing-events/dead-letter	/apps/arcen-dashboard/app/api/ops/billing-events/dead-letter/route.ts
GET	/api/ops/ga-readiness	/apps/arcen-dashboard/app/api/ops/ga-readiness/route.ts
GET	/api/ops/worker-health	/apps/arcen-dashboard/app/api/ops/worker-health/route.ts
GET	/api/platform/gas-budget	/apps/arcen-dashboard/app/api/platform/gas-budget/route.ts
POST	/api/platform/gas-spend	/apps/arcen-dashboard/app/api/platform/gas-spend/route.ts
GET	/api/platform/overview	/apps/arcen-dashboard/app/api/platform/overview/route.ts
GET	/api/platform/sessions	/apps/arcen-dashboard/app/api/platform/sessions/route.ts
GET,POST	/api/platform/support	/apps/arcen-dashboard/app/api/platform/support/route.ts
GET,POST	/api/platform/tier	/apps/arcen-dashboard/app/api/platform/tier/route.ts
GET	/api/platform/tier-history	/apps/arcen-dashboard/app/api/platform/tier-history/route.ts
GET	/api/proofs/active	/apps/arcen-dashboard/app/api/proofs/active/route.ts
GET	/api/proofs/history	/apps/arcen-dashboard/app/api/proofs/history/route.ts
DELETE	/api/provider/api-keys/[id]	/apps/arcen-dashboard/app/api/provider/api-keys/[id]/route.ts
DELETE,GET,POST	/api/provider/api-keys	/apps/arcen-dashboard/app/api/provider/api-keys/route.ts
GET,PUT	/api/provider/notifications	/apps/arcen-dashboard/app/api/provider/notifications/route.ts
GET,PUT	/api/provider/profile	/apps/arcen-dashboard/app/api/provider/profile/route.ts
GET,PUT	/api/provider/webhooks	/apps/arcen-dashboard/app/api/provider/webhooks/route.ts
POST	/api/provider/webhooks/secret	/apps/arcen-dashboard/app/api/provider/webhooks/secret/route.ts
POST	/api/subscriber/email	/apps/arcen-dashboard/app/api/subscriber/email/route.ts
GET	/api/subscriber/lookup	/apps/arcen-dashboard/app/api/subscriber/lookup/route.ts
POST	/api/team/invite	/apps/arcen-dashboard/app/api/team/invite/route.ts
DELETE,GET	/api/team/invites	/apps/arcen-dashboard/app/api/team/invites/route.ts
DELETE	/api/team/members	/apps/arcen-dashboard/app/api/team/members/route.ts
GET,PUT	/api/team	/apps/arcen-dashboard/app/api/team/route.ts
GET,POST	/api/templates/[id]/install	/apps/arcen-dashboard/app/api/templates/[id]/install/route.ts
DELETE	/api/templates/[id]/uninstall	/apps/arcen-dashboard/app/api/templates/[id]/uninstall/route.ts
GET	/api/templates/[id]/versions	/apps/arcen-dashboard/app/api/templates/[id]/versions/route.ts
GET,POST,PUT	/api/templates	/apps/arcen-dashboard/app/api/templates/route.ts
POST	/api/v1/access-tokens	/apps/arcen-dashboard/app/api/v1/access-tokens/route.ts
DELETE,GET,POST	/api/v1/api-keys	/apps/arcen-dashboard/app/api/v1/api-keys/route.ts
GET	/api/v1/check	/apps/arcen-dashboard/app/api/v1/check/route.ts
DELETE,GET,POST	/api/v1/companies/[id]/overrides	/apps/arcen-dashboard/app/api/v1/companies/[id]/overrides/route.ts
DELETE,GET,PATCH	/api/v1/companies/[id]	/apps/arcen-dashboard/app/api/v1/companies/[id]/route.ts
POST	/api/v1/companies/plan	/apps/arcen-dashboard/app/api/v1/companies/plan/route.ts
GET,POST	/api/v1/companies	/apps/arcen-dashboard/app/api/v1/companies/route.ts
POST	/api/v1/companies/unsubscribe	/apps/arcen-dashboard/app/api/v1/companies/unsubscribe/route.ts
GET	/api/v1/components/[id]/render	/apps/arcen-dashboard/app/api/v1/components/[id]/render/route.ts
DELETE,PATCH	/api/v1/components/[id]	/apps/arcen-dashboard/app/api/v1/components/[id]/route.ts
GET,POST	/api/v1/components	/apps/arcen-dashboard/app/api/v1/components/route.ts
GET	/api/v1/coupons/validate	/apps/arcen-dashboard/app/api/v1/coupons/validate/route.ts
GET,POST	/api/v1/events	/apps/arcen-dashboard/app/api/v1/events/route.ts
GET,POST,PUT	/api/v1/feature-flags/[id]/rules	/apps/arcen-dashboard/app/api/v1/feature-flags/[id]/rules/route.ts
GET,POST	/api/v1/feature-flags	/apps/arcen-dashboard/app/api/v1/feature-flags/route.ts
DELETE	/api/v1/features/[id]	/apps/arcen-dashboard/app/api/v1/features/[id]/route.ts
GET,POST	/api/v1/features	/apps/arcen-dashboard/app/api/v1/features/route.ts
GET	/api/v1/flags/check	/apps/arcen-dashboard/app/api/v1/flags/check/route.ts
GET,POST	/api/v1/proofs/zktls	/apps/arcen-dashboard/app/api/v1/proofs/zktls/route.ts
GET,POST	/api/v1/users	/apps/arcen-dashboard/app/api/v1/users/route.ts
POST	/api/webhooks/clerk	/apps/arcen-dashboard/app/api/webhooks/clerk/route.ts
POST	/api/webhooks/delivery	/apps/arcen-dashboard/app/api/webhooks/delivery/route.ts
GET	/api/webhooks/log	/apps/arcen-dashboard/app/api/webhooks/log/route.ts
POST	/api/webhooks/test	/apps/arcen-dashboard/app/api/webhooks/test/route.ts
```

### A.2 Facilitator endpoint inventory (extracted from Express routes)

Format: `METHOD<TAB>PATH`

```text
count 34
GET	/metrics
GET	/health
GET	/info
GET	/api/premium/data
GET	/api/usage/:sessionId
GET	/api/usage/:sessionId/report
GET	/api/usage/:sessionId/logs
GET	/api/aggregator/stats
GET	/api/ops/settlement/status
GET	/api/ops/proof/runtime
GET	/api/entitlements/:wallet/flags
GET	/api/entitlements/provider/:provider/flags
POST	/api/entitlements/provider/:provider/flags/bootstrap
PUT	/api/entitlements/provider/:provider/flags/:flagKey
PATCH	/api/entitlements/provider/:provider/flags/:flagKey
DELETE	/api/entitlements/provider/:provider/flags/:flagKey
POST	/api/lit/decrypt
GET	/api/session/:agentAddress/balance
GET	/api/session/:agentAddress
GET	/api/session/details/:sessionId
POST	/api/subscriber/email
POST	/api/billing/events
GET	/api/webhooks/log
POST	/api/webhooks/replay/:deliveryId
POST	/api/webhooks/test
GET	/api/email/templates
GET	/api/invoices/status
GET	/api/ops/queue/:name/dead-letter
POST	/api/ops/queue/:name/dead-letter/replay-all
POST	/api/ops/queue/:name/dead-letter/:jobId/replay
GET	/api/ops/replay-protection/stats
GET	/api/proofs/active
GET	/api/proofs/history
POST	/api/paymaster/evaluate
```

### A.3 Runbook pointers

- `OPERATIONS_RUNBOOK.md` - operational runbook for deployment/runtime handling
- `docs/INCIDENT_RUNBOOK.md` - incident diagnosis and response
- `docs/plan-factory-ownership-runbook.md` - contract ownership/admin workflow
- `docs/testnet-integration-checklist.md` - integration and credential checklist
- `docs/MIGRATION_GA.md` - GA migration behavior deltas

## Appendix B. Runtime Env/Config Matrix and Dependency Expectations

### B.1 Environment key extraction (selected source files)

```text
## apps/facilitator/src/server.ts
AXELAR_GAS_SERVICE_ADDRESS
AXELAR_GATEWAY_ADDRESS
BASE_SEPOLIA_RPC_URL
BRAND_NAME
CCIP_LINK_TOKEN_ADDRESS
CCIP_ROUTER_ADDRESS
CHAIN_ID
CORS_ORIGINS
DASHBOARD_TEAM_ID
DASHBOARD_URL
EMAIL_FROM
ENABLE_BILLING_KEEPER
FACILITATOR_PROFILE
FACILITATOR_SECRET
KEEPER_BATCH_SIZE
KEEPER_INTERVAL_MS
KEEPER_RENEWAL_BUFFER_SECONDS
LIT_NETWORK
MEAP_CIRCUIT_BUILD_DIR
MEAP_PROOF_ARTIFACT_MANIFEST_PATH
MEAP_PROOF_ARTIFACT_VERSION
NODE_ENV
PAYMASTER_CHAIN_IDS
PAYMASTER_ENTRYPOINT
PAYMASTER_ESTIMATED_GAS_COST_USD
PAYMASTER_ESTIMATED_GAS_USED
PAYMASTER_RECORD_ESTIMATED_SPEND
PAYMASTER_RPC_AUTH_TOKEN
PAYMASTER_RPC_METHOD
PAYMASTER_RPC_URL
PORT
PRIVATE_KEY
PROOF_MAX_RETRIES
PROOF_MODE
PROOF_SIGNER_PRIVATE_KEY
PROOF_WINDOW_SECONDS
REDIS_PREFIX
REDIS_REQUIRED
REDIS_URL
REDIS_USAGE_TTL_SECONDS
RESEND_API_KEY
RPC_URL
SENTRY_DSN
SEPOLIA_RPC_URL
SESSION_VAULT_ADDRESS
SETTLEMENT_AUTH_POLL_MS
SETTLEMENT_PRIVATE_KEY
SETTLEMENT_THRESHOLD
SVIX_SIGNING_SECRET
TABLELAND_GATEWAY_URL
TABLELAND_PRIVATE_KEY
TABLELAND_RPC_URL
TABLELAND_TABLE_NAME
WEBHOOK_SIGNING_SECRET
WEBHOOK_URL
X402_ENABLE_SETTLEMENT
X402_FAIL_OPEN_BALANCE_CHECK
X402_PROVIDER_ADDRESS
X402_RATE_LIMIT_PER_WALLET
X402_REPLAY_WINDOW_MS
X402_REQUIRE_SETTLER_AUTH
X402_WAIT_FOR_RECEIPT
ZERODEV_PAYMASTER_RPC
ZK_CIRCUIT_VKEY_PATH
ZK_CIRCUIT_WASM_PATH
ZK_CIRCUIT_ZKEY_PATH

## apps/arcen-dashboard/lib/config.ts
CHAIN_ID
EMAIL_FROM
FACILITATOR_BASE_URL
FACILITATOR_BASE_URL_${DEFAULT_CHAIN_ID}
FACILITATOR_SECRET
FACILITATOR_URL
FACILITATOR_URL_${DEFAULT_CHAIN_ID}
INVOICE_DOWNLOAD_SIGNING_SECRET
INVOICE_DOWNLOAD_URL_TTL_SECONDS
INVOICE_STORAGE_DIR
MEAP_DEFAULT_CHAIN_ID
MEAP_SUBGRAPH_URL
MEAP_SUBGRAPH_URL_${DEFAULT_CHAIN_ID}
MEAP_SUBGRAPH_URL_${chainId}
NEXTAUTH_URL
NEXT_PHASE
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_CHAIN_ID
NEXT_PUBLIC_FACILITATOR_BASE_URL
NEXT_PUBLIC_FACILITATOR_URL
NEXT_PUBLIC_GRAPH_URL
NEXT_PUBLIC_GRAPH_URL_${DEFAULT_CHAIN_ID}
NEXT_PUBLIC_GRAPH_URL_${chainId}
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
NODE_ENV
RESEND_API_KEY
RPC_URL
RPC_URL_${chainId}
SIWE_JWT_SECRET
VERCEL_URL

## packages/sdk-core/src/environment.ts
NODE_ENV

## packages/sdk-react/src/providers/MEAPProvider.tsx
NEXT_PUBLIC_ARCEN_BASE_URL
NEXT_PUBLIC_LIT_NETWORK
NEXT_PUBLIC_RPC_URL
NEXT_PUBLIC_RPC_URL_${id}
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
NODE_ENV

## packages/sdk-node/src/middleware/x402.ts
NODE_ENV

## apps/arcen-demo/app/api/config/route.ts
ARCENPAY_API_KEY
ARCENPAY_BASE_URL
DEMO_COMPANY_WALLET
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID

## .env.example
BASE_MAINNET_RPC_URL
BASE_SEPOLIA_RPC_URL
DASHBOARD_TEAM_ID
DASHBOARD_URL
DATABASE_URL
DEPLOYER_PRIVATE_KEY
EMAIL_FROM
ETHERSCAN_API_KEY
FACILITATOR_SECRET
FACILITATOR_URL
INVOICE_DOWNLOAD_SIGNING_SECRET
INVOICE_DOWNLOAD_URL_TTL_SECONDS
INVOICE_STORAGE_DIR
MEAP_FACILITATOR_URL_11155111
MEAP_FACILITATOR_URL_8453
MEAP_FACILITATOR_URL_84532
MEAP_PROOF_ARTIFACT_MANIFEST_PATH
MEAP_PROOF_ARTIFACT_VERSION
MEAP_RPC_URL_11155111
MEAP_RPC_URL_8453
MEAP_RPC_URL_84532
MEAP_SUBGRAPH_URL_11155111
MEAP_SUBGRAPH_URL_8453
MEAP_SUBGRAPH_URL_84532
NEXT_PUBLIC_GRAPH_URL
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
REDIS_URL
RESEND_API_KEY
SEPOLIA_RPC_URL
SIWE_JWT_SECRET
TABLELAND_PRIVATE_KEY
TABLELAND_TABLE_NAME
WEBHOOK_SIGNING_SECRET
WEBHOOK_URL
```

### B.2 Dependency expectations by component

| Component | Hard dependencies | Optional dependencies | Notes |
|---|---|---|---|
| Contracts | EVM RPC, deployed addresses, approved token config | Cross-chain transports | Runtime correctness depends on authorized role wiring |
| Facilitator | Node runtime, RPC URL, chain config | Redis, Resend, Tableland, Lit, Sentry, paymaster RPC | Production profile enforces stricter proof and secret checks |
| Dashboard | Postgres/Prisma, auth/session config | Facilitator bridge URLs/secrets, email/webhook infra | Role and environment-mode behavior gates write actions |
| SDK React | Browser + wagmi/viem + chain/env config | WalletConnect project id, hosted API endpoints | Provider reads manifest/env and exposes contract context |
| SDK Node | Node runtime + viem | Redis nonce store and optional services | `x402Middleware` defaults fail-closed for balance checks |
| SDK Agent | Private key + RPC + chain config + SessionVault access | app-level retry/orchestration wrappers | Signs EIP-712 payment payloads and manages nonce progression |

### B.3 Operational assumptions

- Secrets are environment-injected and must not be committed.
- Production should use durable stores (for nonce/replay and queue data).
- Contracts and backend env must remain in sync with manifest and deployment state.

## Appendix C. Canonical Deployment Table (Sepolia)

Reproduced from `packages/contracts/deployments/sepolia-latest.json`.

| Contract/System | Address |
|---|---|
| PlanFactory | 0x4F97E0c2Ac053b735640fEb164a08Cb45ba83db1 |
| FeeCollector | 0xa8A0D3007e5680D387A50C1a1E2Eb0AD092ca396 |
| SubscriptionRegistry | 0xE206C519076535A9d24c852093860CFD780908C1 |
| SessionVault | 0xd68b9C0a34d61CC3b3F982A5EC6Cc5a5739e46D9 |
| ZKUsageVerifier | 0x1f75d66692416cE880d51Baf6CdcBeE98E5837c0 |
| ERC7579AutopayModule | 0xc82417e378b23AD9Ae73229EF08a4BA7896a4351 |
| MirrorRegistry | 0xC187CD32d569ec0E84B9b378f8E63f3a74afac74 |
| USDC | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 |
| Treasury | 0x38f62CCfD6F771eF9E48e3bb86a3E0413aE5319B |
| deployedAt | 2026-03-19T14:47:01.668Z |

## Appendix D. Known Documentation Drift (Stale Docs vs Code-Backed Truth)

| Area | Stale source | Drift observed | Code-backed correction source |
|---|---|---|---|
| Contract addresses | `apps/docs/src/app/contract-addresses/page.tsx` | Listed addresses do not match current deployed Sepolia manifest; includes token-like addresses for core contracts | `packages/contracts/deployments/sepolia-latest.json`, `packages/sdk-core/src/addresses.ts` |
| Agent SDK API | `apps/docs/src/app/sdk-reference/agent/page.tsx` | Mentions `x402Client`, `SessionManager`, `ZKProver` exports that are not the current package entry exports | `packages/sdk-agent/src/index.ts`, `packages/sdk-agent/src/agent.ts` |
| SDK reference page | `apps/docs/src/app/sdk-reference/page.tsx` | Mentions `useSubscription`, `useFeatureFlag`, `useFeatureFlags`, and `createArcenPayClient` flows that are not current primary exports | `packages/sdk-react/src/index.ts`, `packages/sdk-node/src/index.ts` |
| Overview quick example | `apps/docs/src/app/page.tsx` | Shows provider props that do not match current `MEAPProviderProps` shape | `packages/sdk-react/src/providers/MEAPProvider.tsx` |
| Address expectations by chain | older docs snippets | Base Sepolia/Base Mainnet may appear as generally available, but source uses zero-address placeholders until override/deployment | `packages/sdk-core/src/addresses.ts` |

## Evidence Index

For implementation traceability, core evidence files used to author this dossier:

- `packages/contracts/contracts/core/PlanFactory.sol`
- `packages/contracts/contracts/core/SubscriptionRegistry.sol`
- `packages/contracts/contracts/core/ERC7579AutopayModule.sol`
- `packages/contracts/contracts/core/FeeCollector.sol`
- `packages/contracts/contracts/core/SessionVault.sol`
- `packages/contracts/contracts/core/ZKUsageVerifier.sol`
- `packages/contracts/contracts/core/MirrorRegistry.sol`
- `packages/contracts/contracts/interfaces/*.sol`
- `packages/contracts/deployments/sepolia-latest.json`
- `packages/sdk-core/src/index.ts`
- `packages/sdk-core/src/types.ts`
- `packages/sdk-core/src/environment.ts`
- `packages/sdk-core/src/addresses.ts`
- `packages/sdk-react/src/index.ts`
- `packages/sdk-react/src/providers/MEAPProvider.tsx`
- `packages/sdk-node/src/index.ts`
- `packages/sdk-node/src/middleware/x402.ts`
- `packages/sdk-agent/src/index.ts`
- `packages/sdk-agent/src/agent.ts`
- `apps/facilitator/src/server.ts`
- `apps/arcen-dashboard/app/api/**/route.ts`
- `apps/arcen-dashboard/prisma/schema.prisma`
- `apps/arcen-dashboard/lib/flag-engine.ts`

