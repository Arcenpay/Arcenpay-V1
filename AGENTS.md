# ArcenPay — Agent Guide

Instructions for AI coding assistants and developers working on the ArcenPay codebase.

## What ArcenPay Is

ArcenPay is a **Web3 Entitlement Layer** built on the ArcenPay Protocol + ZKVUB
settlement. It is a **dashboard-managed billing platform** that combines
on-chain subscriptions (Solidity on Base/Ethereum) with off-chain billing
infrastructure (Prisma + PostgreSQL + Hono) bridged by a facilitator node.

Four surfaces you will work with:

- **Provider Dashboard** (`apps/arcen-dashboard`) — Next.js 16 App Router.
  Control plane for plans, add-ons, credits, companies, components, invoices,
  payments, feature flags, and webhooks.
- **Backend API** (`apps/arcen-backend`) — Hono v4 server. The billing engine
  lives here (22+ files under `src/lib/billing/`). Prisma v7 + PostgreSQL.
- **Facilitator Node** (`apps/facilitator`) — Express v5 bridge. Polls on-chain
  events, runs a durable job queue (Redis + mem-fallback), executes renewals
  (BillingKeeper), writes settlements on-chain, delivers signed webhooks, and
  sends transactional email.
- **SDKs** (`packages/sdk-react`, `packages/sdk-node`, `packages/sdk-agent`) —
  Public API surface for providers (React embed + Node.js server) and
  autonomous agents (x402 payment negotiation).

Two properties shape almost every design decision and are the lens for reviewing any change:

- **Idempotency is non-negotiable.** Every billing event, payment record,
  credit grant, and recovery task carries an idempotency key. The system must
  survive duplicate delivery at any boundary (chain -> facilitator ->
  dashboard, or dashboard -> Prisma). Dedup is explicit, not best-effort.
- **The facilitator is the on-chain/off-chain bridge.** The dashboard never
  calls chain RPCs for billing operations. All chain state flows through the
  facilitator as billing events. The facilitator also handles on-chain writes
  (settlements, renewals) and is the sole authorizer for those calls.

## Project Structure

```
arcenpay-v1/
├── apps/
│   ├── arcn-backend/          # Hono API — billing engine lives here
│   │   ├── src/
│   │   │   ├── lib/billing/   # 23 billing modules (core domain — see below)
│   │   │   ├── lib/catalog/   # Plans, coupons, entitlements, catalog config
│   │   │   ├── lib/webhooks/  # Signed webhook delivery + verification (svix)
│   │   │   ├── lib/auth/      # API key, session, facilitator, wallet auth
│   │   │   ├── lib/entitlements/  # Feature flags, entitlements, embed tokens
│   │   │   ├── lib/payments/  # Checkout sessions, payment links
│   │   │   ├── lib/platform/  # Audit, default-chain, launch-flags
│   │   │   ├── routes/v1/     # Hono route handlers (flat + sub-routers)
│   │   │   ├── middleware/    # cors, auth, rate-limit
│   │   │   ├── services/      # Thin facades wrapping lib/ (BillingError lives here)
│   │   │   ├── utils/         # prisma-json, api-response, logger
│   │   │   ├── db.ts          # Global Prisma client singleton (reconnect logic)
│   │   │   ├── config.ts      # Centralized env -> config (fail-fast in prod)
│   │   │   └── server.ts      # Entry point (Sentry init + serve)
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # Single source of truth (~70 models, ~22 enum types)
│   │   │   └── migrations/    # Sequential timestamp-prefixed, never-edit-applied
│   │   └── package.json
│   ├── facilitator/           # Express v5 bridge node (~3,280 LOC server)
│   │   ├── src/
│   │   │   ├── server.ts      # Event listeners (5 topics), keeper scheduler, queues
│   │   │   ├── queue.ts       # DurableJobQueue (Redis-backed, in-memory fallback)
│   │   │   └── services/      # events, keeper, settlement, settlement-writer,
│   │   │                      #   webhooks, email, usage, proof-orchestrator, aggregator
│   │   └── tests/             # Node built-in test runner (node --import tsx --test)
│   ├── arcn-dashboard/        # Next.js 16 App Router (app/ directory)
│   ├── demo-dapp/             # Vite React demo app — Stellar wallet + feature gating
│   └── arcnpay-docs/          # Mintlify documentation
├── packages/
│   ├── contracts/             # Solidity + Hardhat + Foundry (25 contracts)
│   ├── internal-core/         # Shared runtime (types, constants, ABIs, chain configs)
│   ├── shared-types/          # API envelope types (NO billing types — known gap)
│   ├── sdk-react/             # Browser SDK (ArcenPayProvider, hooks, ArcenEmbed)
│   ├── sdk-node/              # Server SDK (ArcenClient, x402Middleware)
│   └── sdk-agent/             # Agent payment SDK (ArcenAgent, auto-payment fetch)
├── circuits/                  # ZK proof circuits (Groth16, usage aggregation)
├── subgraph/                  # TheGraph indexing for SubscriptionRegistry events
├── docker-compose.yml         # PostgreSQL :5433 + Redis :6379
├── turbo.json                 # Turborepo pipeline (build -> test, typecheck)
└── tsconfig.base.json         # Shared TS strict config (ES2022, bundler)
```

**Port map (local):** Dashboard `:3000`, Backend `:3300`, Facilitator `:3402`,
Demo `:5173`, Docs `:3003`, PostgreSQL `:5433`.

## Billing Architecture — The Core Domain

This is a billing system first. Every change to `lib/billing/` or the Prisma
schema must be audited for data-integrity and idempotency.

### Module Map (apps/arcen-backend/src/lib/billing/)

| File | LOC | Responsibility |
|------|-----|---------------|
| `billing-events.ts` | 595 | Core event ingestion engine. Dedup by idempotencyKey. Dispatches to ledger state updates, payment recording, invoice creation, webhook delivery. Handles 5 event types. |
| `billing-ledger.ts` | 428 | SubscriptionState upsert (by companyId). `recordSuccessfulPayment()` and `recordFailedPayment()` with full idempotency. Resolves company by id or wallet. |
| `billing-recovery.ts` | 1028 | Idempotent retry queue (5m -> 30m -> 2h -> 8h). Processes activation, plan changes, cancellation, resume. Uses optimistic P2002 concurrency. |
| `billing-maintenance.ts` | 560 | Periodic sweep: pending recovery tasks, scheduled period-end transitions (downgrade/cancel), dunning enforcement. Proration credits on downgrades. |
| `billing-dunning.ts` | 128 | Grace-period enforcement. Finds PAST_DUE subscriptions past graceEndsAt, downgrades to free plan via transaction. |
| `billing-balances.ts` | 274 | Company credit balance ledger. `postBillingCredit()`, `consumeBillingCredit()`, `applyInvoicePayment()`, `applyInvoiceCredit()`, `recordRefund()`. Optimistic updateMany for concurrency. |
| `billing-proration.ts` | 130 | Mid-cycle plan-change proration. Computes remaining time ratio, delta in micros, direction (charge/credit), full settlement breakdown. |
| `billing-adjustments.ts` | 49 | Record proration charges/credits and manual adjustments. Clean, concise. |
| `billing-reconciliation.ts` | 195 | Ledger integrity checker: paid invoices without payments, active companies without subscription state, stale PAST_DUE, failed payments without state, pending recovery tasks. |
| `billing-runtime.ts` | 280 | Runtime diagnostics: open/failed lifecycle requests, recovery stats, webhook failures, legacy transition count. |
| `invoices.ts` | 29 | Invoice number allocation (year-based upsert sequence). `toSix()` micro->decimal formatter. |
| `invoice-documents.ts` | 550 | **On-demand** PDF generation (pdf-lib) — PDFs are never written to disk; signed URLs render the invoice object at request time (Stripe-style). Snapshot-aware dispatcher (template snapshot → active template → legacy). |
| `invoice-context.ts` | 236 | Full billing context loader: team, profile, company, payments, address lines, payment method labels. |
| `invoice-iso20022.ts` | 234 | ISO 20022 rem.001.001.07 XML export. Maps crypto tokens to ISO 4217 currency codes. |
| `invoice-tax.ts` | 125 | US + India billing address validation (Zod schemas), GSTIN parsing, EIN validation. |
| `invoice-notifications.ts` | 153 | Paid invoice receipt delivery (PDF + email). Dedup by txHash. Tracks delivery state. |
| `email.ts` | 738 | Transactional email via Resend: auth codes, team invites, invoices, receipts, credit notes, plan changes, welcome. Invoice/receipt use a shared `arcenpayEmailShell` (on-brand light layout). |
| `subscriber-emails.ts` | 97 | Scoped subscriber email registry. team:environment scoping with legacy fallback. Wallet address key. |
| `subscription-change-requests.ts` | 808 | Full lifecycle FSM. 6 stages (REQUESTED->PENDING_VERIFICATION->PENDING_RECOVERY->APPLIED/FAILED/REVERTED). 5 change types. Snake/camel serialization. Legacy migration. |
| `usage-credits.ts` | 540 | Credit ledger: grant (FIFO/LIFO expiry-aware), consume (serializable TX), burn configs from feature metadata. Plan + add-on grants. |
| `usage-consume.ts` | 358 | Metered entitlement consumption with credit burn. Low-balance webhooks. Post-consume cache invalidation. |
| `customer-identity.ts` | 105 | Sync customer name/email/wallet on user identity records. Idempotent (no-op if values match). |
| `utils.ts` | 25 | Shared: `asRecord()`, `normalizeWallet()`, `readString()`, `deriveBillingPeriodFromInterval()`. These were consolidated from 13+ duplicate definitions. NEVER redefine these locally. |
| `invoice-builder/types.ts` | — | Declarative invoice template config (V1 layout sections + style + watermark). Allowlist-only. |
| `invoice-builder/schema.ts` | — | Zod validation: unknown props/enums rejected, no duplicate sections, 64KB cap. |
| `invoice-builder/default-template.ts` | — | Stock "Classic" template (seeded + `isProtected` for Plus/Pro; cannot be deleted). |
| `invoice-builder/renderer.ts` | — | pdf-lib declarative renderer: logo, colors, fonts, watermark, portrait/landscape, ordered sections. |
| `invoice-builder/template-store.ts` | — | Template CRUD, snapshot resolution (snapshot → active → legacy) and idempotent snapshot stamping. |
| `invoice-builder/preview.ts` | — | Builds a representative context for the live builder preview. |

### Invoice builder & object storage

- **Invoice templates** are per-team/environment (`InvoiceTemplate`), validated by
  `invoice-builder/schema.ts`, rendered by the declarative pdf-lib renderer, and
  **snapshotted onto every invoice at first render** (`Invoice.templateSnapshot`)
  so later template edits never change issued documents. The seed "Classic"
  template is `isProtected` (Plus/Pro baseline) and cannot be deleted.
- **PDFs are on-demand**: `createInvoiceDownloadUrl()` issues an HMAC-signed render
  URL; `renderSignedInvoicePdf()`/`renderInvoicePdfBytes()` render at request time.
  Nothing is written to disk; the previous `externalRef`/object-key storage flow is
  gone. `INVOICE_STORAGE_DIR` now only holds asset fallbacks (logos in local mode).
- **Object storage** lives in `src/lib/storage/` — an `ObjectStore` interface with a
  **Cloudflare R2** driver (S3-compatible, SigV4 signing via `s3-signer.ts`, validated
  against the official AWS vector; zero SDK dependency) and a local filesystem driver.
  `STORAGE_DRIVER=r2` activates R2 (auto-selected when all R2_* vars are present);
  `STORAGE_DRIVER=local` forces the dev fallback. Logos upload via `getStorage().put()`.

### Stripe-style credentials (API keys & tokens)

- **Secret keys** `sk_live_/sk_test_…`, **publishable keys** `pk_live_/pk_test_…` and
  **restricted keys** `rk_live_/rk_test_…` (legacy `api_…` accepted). Prefix encodes
  type + environment (`_live_`=PRODUCTION, `_test_`=DEVELOPMENT). See
  `src/lib/auth/api-key-auth.ts` (`KEY_TYPE_PREFIXES`, `generateApiKey({type, mode})`).
- **Storage**: SHA-256 hash only; raw value shown once at creation.
  `permissions[]` (empty = full for SECRET, required for RESTRICTED, ignored for
  PUBLISHABLE which is implicitly read-only), `expiresAt`, `revokedAt`, `lastUsedAt`.
- **`requireApiKey(request, { allow, permissions })`** enforces allow-list per endpoint
  (publishable keys never reach secret-only routes) and permission checks.
- **Temporary access tokens** `arc_tok_…` (60–900s, company-scoped, DB-backed) are
  minted via `POST /api/v1/api-keys/tokens` with a SECRET/RESTRICTED key + `tokens.create`,
  and resolved by `resolveEmbedAccessToken()` for the embed flow.
- **Webhook signing secret** `whsec_…` is managed at `POST /api/provider/webhooks/secret`
  (OWNER/ADMIN, rotate + show-once) and signed with HMAC-SHA256.

### Event Flow — Complete

```
┌─────────────────────────────────────────────────────────────────┐
│ ON-CHAIN                                                        │
│ SubscriptionRegistry: SubscriptionMinted, Renewed, Cancelled,   │
│                       PlanChanged                               │
│ ERC7579AutopayModule: BillingExecuted                           │
│ ZKUsageVerifier: BillingSettled                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ poll (default 12s interval)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ FACILITATOR (Express :3402)                                     │
│                                                                 │
│ EventListenerService                                             │
│   └─> persistBillingEvent() ─> DurableJobQueue ("billing")      │
│                                                                 │
│ BillingKeeper (renewal scanner)                                  │
│   └─> AutopayModule.execute() on-chain                          │
│   └─> persistBillingEvent()                                     │
│                                                                 │
│ SettlementWriter (ZK settlement)                                 │
│   └─> SessionVault.settle() on-chain                            │
│   └─> FeeCollector fee collection                               │
│                                                                 │
│ WebhookService                                                   │
│   └─> HMAC-SHA256 signed delivery to provider endpoints         │
│                                                                 │
│ BillingMaintenanceScheduler                                      │
│   └─> POST /api/v1/internal/billing/maintenance/all             │
└────────────────────────┬────────────────────────────────────────┘
                         │ DurableJobQueue worker
                         │ POST /api/v1/billing/events
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND (Hono :3300)                                            │
│                                                                 │
│ POST /api/v1/billing/events (facilitator-auth middleware)       │
│   └─> ingestBillingEvent()                                       │
│       ├─ dedup by idempotencyKey                                  │
│       ├─ store BillingEvent row                                   │
│       ├─ processStoredBillingEvent()                              │
│       │   ├─ SUBSCRIPTION_MINTED/RENEWED:                        │
│       │   │   └─ upsertSubscriptionLedgerState(ACTIVE)            │
│       │   │   └─ recordSuccessfulPayment()                       │
│       │   │   └─ createIssuedChargeInvoice() (if triggerInvoice) │
│       │   ├─ PAYMENT_FAILED:                                     │
│       │   │   └─ upsertSubscriptionLedgerState(PAST_DUE)         │
│       │   │   └─ recordFailedPayment()                           │
│       │   │   └─ graceEndsAt = occurredAt + 7 days               │
│       │   └─ SUBSCRIPTION_CANCELLED: webhook only                │
│       └─ deliverWebhook() fire-and-forget                        │
└─────────────────────────────────────────────────────────────────┘
```

### Key Function Signatures

```typescript
// billing-events.ts — the entry point for all billing events
export async function ingestBillingEvent(input: PersistBillingEventInput): Promise<{
  event: BillingEvent;      // created/found Prisma row
  invoiceId: string | null;
  deduped: boolean;         // true if event already existed
  processedNow: boolean;    // true if we processed it (not a replay skip)
  skipped: boolean;         // true if intentionally skipped
  reason: string | null;
}>

// billing-ledger.ts — idempotent state mutation
export async function upsertSubscriptionLedgerState(input: {
  teamId: string; status: "ACTIVE" | "PAST_DUE" | "CANCELLED";
  companyId?: string; walletAddress?: string; chainId?: number;
  catalogPlanId?: string; onChainPlanId?: string; onChainTokenId?: string;
  currentPeriodStart?: Date; currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean; cancelledAt?: Date;
  pastDueAt?: Date; graceEndsAt?: Date;
  lastEvent?: string; lastEventAt?: Date; lastSourceTxHash?: string;
  environmentId?: string; metadata?: Record<string, unknown>;
}, client?: BillingLedgerDb): Promise<SubscriptionState | null>

export async function recordSuccessfulPayment(input: {
  idempotencyKey: string; teamId: string; amount: number;  // micros
  kind: "SUBSCRIPTION_ACTIVATION" | "SUBSCRIPTION_RENEWAL" |
        "SUBSCRIPTION_PLAN_CHANGE_UPGRADE" | "MANUAL_INVOICE_PAYMENT" |
        "ADDON_PURCHASE" | "CUSTOM_PAYMENT";
  companyId?: string; walletAddress?: string; invoiceId?: string;
  txHash?: string; occurredAt?: Date; currency?: string;
  preserveScheduledCancellation?: boolean;
}, client?: BillingLedgerDb): Promise<Payment>

export async function recordFailedPayment(input: {
  idempotencyKey: string; teamId: string; errorMessage: string;
  kind: PaymentKind; amount?: number; txHash?: string;
  occurredAt?: Date; errorCode?: string;
}, client?: BillingLedgerDb): Promise<Payment>

// billing-recovery.ts — retryable work items
export async function enqueueSubscriptionActivationRecovery(input: {
  teamId: string; companyId: string; walletAddress: string;
  catalogPlanId: string; catalogPlanName: string; onChainPlanId: string;
  onChainTokenId: string; txHash: string; amount: number;
  billingPeriod?: "monthly" | "annual"; customerName?: string;
  subscriberEmail?: string; occurredAt?: Date;
  environmentId?: string; customerUserId?: string;
}): Promise<BillingRecoveryTask>
// Recovery task kinds: SUBSCRIPTION_ACTIVATION, SUBSCRIPTION_PLAN_CHANGE,
//   SUBSCRIPTION_CANCELLATION, SUBSCRIPTION_RESUME
// Retry schedule: 5m -> 30m -> 2h -> 8h (clamps at attempt 4+)

// billing-dunning.ts — grace enforcement
export async function runBillingDunningSweep(options?: {
  now?: Date; teamId?: string; limit?: number;  // OMIT teamId = ALL teams!
}): Promise<{ scanned: number; enforced: number; skipped: number; results }>
// WARNING: calling without teamId sweeps EVERY team. Only internal routes do this.

// webhooks — fire-and-forget delivery
export async function deliverWebhook(
  teamId: string, eventName: string, data: Record<string, unknown>
): Promise<void>
// Pattern: deliverWebhook(teamId, "company.plan.changed", {...}).catch(...)
```

### Data Model — Key Prisma Tables

#### BillingEvent
```
id (PK), teamId (FK->Team), eventType (enum: 5 values),
idempotencyKey (@unique), source, payload (Json), processed (bool),
processedAt (DateTime?)
@@index([teamId, createdAt]), @@index([teamId, processed])
```

#### SubscriptionState
```
id (PK), companyId (@unique), teamId, environmentId, walletAddress,
status (ACTIVE|PAST_DUE|CANCELLED), catalogPlanId, onChainPlanId,
onChainTokenId, chainId, currentPeriodStart, currentPeriodEnd,
cancelAtPeriodEnd, cancelledAt, pastDueAt, graceEndsAt,
lastEvent, lastEventAt, lastSourceTxHash, metadata (Json?)
@@index([teamId, status]), @@index([teamId, walletAddress])
```

#### Payment
```
id (PK), teamId, companyId, invoiceId, subscriptionStateId
idempotencyKey (@unique), txHash (@unique), kind (enum: 6 values),
status (PENDING|SUCCEEDED|FAILED|CANCELLED), amount (Decimal(20,6)),
currency, payerWallet, recipientWallet, acceptedToken,
externalRef, occurredAt, settledAt, failedAt, metadata (Json?)
@@index([teamId, status, occurredAt]), @@index([companyId, createdAt])
```

#### BillingRecoveryTask
```
id (PK), teamId, companyId, kind (enum: 4 values),
status (PENDING|PROCESSING|COMPLETED|FAILED),
idempotencyKey (@unique), txHash (@unique), walletAddress,
payload (Json), attempts, lastAttemptAt, nextAttemptAt,
completedAt, lastError
@@index([teamId, status, nextAttemptAt, createdAt])
```

#### SubscriptionChangeRequest
```
id (PK), teamId, environmentId, companyId, subscriptionStateId,
changeType (UPGRADE|DOWNGRADE|CANCELLATION|RESUME|BILLING_PERIOD_CHANGE),
stage (REQUESTED|PENDING_VERIFICATION|PENDING_RECOVERY|APPLIED|FAILED|REVERTED),
source (SELF_SERVICE|ADMIN|RECOVERY|SYNC),
previousPlanId, targetPlanId, requestedAt, effectiveAt, appliedAt, failedAt,
autopayConfigTxHash, accessChangeTxHash, paymentTxHash, autopayControlTxHash,
recoveryTaskId, pendingVerification, failureReason, metadata (Json?)
@@index([teamId, environmentId, companyId, stage, requestedAt])
```

#### InvoiceTemplate
```
id (PK), teamId, environmentId?, name, description?, config (Json — V1 layout
+ style), isActive (at most one per team/env), isProtected (seeded default,
none-deletable)
@@unique([teamId, environmentId, name]), @@index([teamId, isActive]),
@@index([teamId, environmentId, isActive])
```

Invoice adds `templateId?` + `templateSnapshot?` (frozen design at first render).

#### ArcenApiKey (credentials)
```
id (PK), teamId, environmentId?, environmentMode (DEVELOPMENT|PRODUCTION)
type (SECRET|PUBLISHABLE|RESTRICTED), permissions (String[]), keyHash (@unique),
prefix (display), name, description?, expiresAt?, revokedAt?, lastUsedAt?
```

#### EmbedAccessToken (arc_tok_ / embed tokens)
```
id (PK), teamId, environmentId?, companyId?, userId?, tokenHash (@unique), expiresAt
@@index([teamId, environmentId]), @@index([expiresAt])
```

The full schema has ~70 models. See `apps/arcen-backend/prisma/schema.prisma` for the complete definition.

## Development Environment

### Prerequisites
- Node.js 20+, npm 10+, Docker

### Setup
```bash
cp .env.example .env        # secrets and chain config
npm ci                      # clean install all workspaces
docker compose up -d        # PostgreSQL :5433 + Redis :6379
npm run build               # full turbo build (prisma generate + tsc for all)
```

### Run Services
```bash
npm run dev:backend      # Hono API :3300
npm run dev:dashboard    # Next.js :3000
npm run dev:facilitator  # Express :3402
npm run dev:demo         # Vite demo :5173
npm run dev:docs         # Mintlify :3003
```

### Quality Gates (must pass before merge)
```bash
npm run typecheck        # tsc --noEmit across all packages
npm run test             # full suite (vitest + node:test + forge)
npm run lint             # tsc checks across all packages
```

### Scoped Commands
```bash
npm run build:backend    # backend only (with prisma generate)
npm run typecheck:sdk    # SDK packages only
npm run test:sdk         # SDK tests
npm run test:launch      # Dashboard + facilitator
npm run verify:billing:all  # run billing baseline verification script
```

### Prisma Commands (run from apps/arcen-backend/)
```bash
npm run db:generate         # regenerate Prisma client
npm run db:migrate          # create new migration (dev)
npm run db:migrate:deploy   # apply pending migrations (prod)
npm run db:push             # push schema without migration
npm run db:studio           # Prisma Studio GUI
```

## Development Conventions

### TypeScript

- `strict: true` everywhere (inherited from `tsconfig.base.json`).
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- 2-space indentation, LF line endings, UTF-8.
- Use `.js` extensions in ESM imports (`import { db } from "../../db.js"`).
- Prefer explicit return types on public exports; `void` for fire-and-forget.

### Backend Architecture

- **Routes are thin.** Validate input (Zod), call a lib function, return result.
  No business logic in routes. Route files live in `src/routes/v1/`.
- **Services are thin facades.** `src/services/` wraps `src/lib/` modules. The
  exception is `BillingError` (a class with `status` and `code`) defined in
  `services/billing.service.ts`.
- **Config is centralized.** `config.ts` resolves all env vars at module load,
  fails fast in production (`throw Error`), never silently falls back to
  localhost defaults.
- **DB is a global singleton.** `import { db } from "../../db.js"`. Prisma
  client lazily created, stored on `globalThis`, auto-reconnects on connection
  loss (3 retries, exponential backoff). For transactions that need a custom
  client, pass `client` parameter through the function chain.
- **Prisma JSON fields must use `toPrismaJson()`.** Never pass raw objects.
  Import from `../../utils/prisma-json.js`.

### Billing Module Rules (HARDLINE)

1. **Every billing function that mutates state MUST be idempotent.**
   Use `idempotencyKey` on BillingEvent, Payment, BillingRecoveryTask,
   CompanyCreditGrant. Use Prisma `upsert` where possible,
   check-then-create otherwise. If a function can be called twice, it
   must produce the same DB state and return a clear `deduped` flag.

2. **Use shared utilities from `lib/billing/utils.ts`.**
   - `asRecord(value)` — safe cast unknown -> Record<string, unknown>
   - `normalizeWallet(value)` — trim + lowercase, returns null for non-strings
   - `readString(value)` — string extraction with trim
   - `deriveBillingPeriodFromInterval(value)` — >= YEARLY_INTERVAL -> "annual"
   These were consolidated from 13+ duplicate definitions. Do NOT redefine
   them locally.

3. **Use constants from `@arcenpay/internal-core`.**
   - `YEARLY_INTERVAL` = 31_536_000 (never hardcode)
   - `SUBSCRIPTION_FEE_BPS` = 50n (0.5%)
   - `SETTLEMENT_FEE_BPS` = 30n (0.3%)
   - `BPS_DENOMINATOR` = 10_000n
   - `MONTHLY_INTERVAL` = 2_592_000

4. **Financial amounts are in micros internally.**
   1 USDC = 1_000_000 micros (6 decimal places). Display amounts use
   `toSix()` from `invoices.ts`. Plan prices are stored in decimal
   USDC and converted: `Math.round(price * 1_000_000)`.

5. **Webhook delivery is fire-and-forget.**
   `deliverWebhook(teamId, eventName, data).catch(err => console.warn(...))`
   Webhook failures must never block billing state transitions.

6. **Invoice creation is triggered by `triggerInvoice` flag.**
   Only SUBSCRIPTION_MINTED, SUBSCRIPTION_RENEWED, and CREDIT_ISSUED
   events set this flag. The flag is passed from the facilitator.

7. **Payment idempotency keys follow a naming convention.**
   `"payment:" + event.idempotencyKey` for events.
   `"subscription.activate:" + txHash` for activation recovery tasks.
   `"plan:.change:" + changeRequestId` for plan changes.
   `"grant:" + planId + ":" + companyId + ":" + periodStart` for credit grants.

### Route Auth Pattern

```typescript
// Team-scoped routes: require role
const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
if (isErrorResponse(auth))
  return c.json({ ok: false, error: auth.error }, auth.status as any);

// Facilitator-to-backend routes: middleware on router
const billingRoutes = new Hono()
  .use(requireFacilitatorAuth())
  .get("/events", billingEventsList)
  .post("/events", billingEventsIngest);

// SDK client routes: api key or embed token
const auth = await requireAnyAuth(c);
if (isAnyAuthError(auth))
  return c.json(auth.error, auth.status as any);
```

### Auth Roles & Permissions

| Role | Permissions |
|------|-------------|
| OWNER | catalog:rw, templates:rw+install, invoices:rw+send, audit:read, environment:switch, support:rw |
| ADMIN | catalog:rw, templates:rw+install, invoices:rw+send, audit:read, environment:switch |
| FINANCE | invoices:rw+send, audit:read |
| DEVELOPER | catalog:rw, templates:rw+install, invoices:read |
| SUPPORT | catalog:read, templates:read, invoices:read, audit:read, support:read |
| MEMBER | catalog:read, templates:read, invoices:read |

### Dunning & Maintenance Rules

- **Dunning sweeps are per-team and role-gated.** Never call
  `runBillingDunningSweep()` without a `teamId` from a user-facing route.
  The lib function accepts an optional `teamId` — if omitted, it sweeps ALL
  teams globally. Only the facilitator-triggered maintenance endpoint
  (`/api/v1/internal/billing/maintenance/all`) does global sweeps.
- **Maintenance is triggered by the facilitator** via
  `POST /api/v1/internal/billing/maintenance/all` (with `executeDunning: false`
  by default).
- **Dead-letter replay calls `ingestBillingEvent()` directly.** Never POST
  events back to the facilitator URL — it creates a circular loop.

### Contract Architecture

The 8 active core contracts form the on-chain settlement layer:

| Contract | Purpose |
|----------|---------|
| `SubscriptionRegistry` | ERC-5643 subscription NFT. Mint, renew, cancel, plan-change. Per-wallet, one active subscription. Cross-chain GMP dispatch. |
| `PlanFactory` | Provider registration + plan CRUD. EIP-712 meta-transactions. |
| `ERC7579AutopayModule` | ERC-7579 Executor. Velocity limits, spending caps. Pulls from subscriber's smart account. |
| `FeeCollector` | Protocol fee collection (0.5% sub, 0.3% settlement). Tiered provider rates. |
| `SessionVault` | Pre-funded stablecoin vault for ZKVUB sessions. `settle()` draws from session balance. |
| `ZKUsageVerifier` | Groth16 zk-SNARK proof verification for ZKVUB settlement. Nullifier-based double-spend prevention. |
| `FlagRegistry` | On-chain feature flag defaults per teamId. |
| `MirrorRegistry` | Cross-chain subscription state mirror via GMP (Axelar + CCIP). |

## Key Dependencies

| Package | Role | Version |
|---------|------|---------|
| `hono` | Backend HTTP framework | v4 |
| `@prisma/client` | ORM (PostgreSQL via `@prisma/adapter-pg`) | v7 |
| `viem` | Ethereum interaction | v2 |
| `express` | Facilitator HTTP server | v5 |
| `ioredis` | Facilitator queue backend | v5 |
| `resend` | Transactional email | v6 |
| `svix` | Signed webhook infrastructure | v1 |
| `@sentry/node` | Error monitoring | v8 |
| `zod` | Schema validation | v3 |
| `date-fns` | Date manipulation (**pinned to 4.1.0**) | 4.1.0 |
| `pdf-lib` | PDF invoice generation | latest |
| `next` | Dashboard framework | v16 |
| `turbo` | Monorepo orchestration | v2 |

**Package manager:** npm@10.2.4 with workspaces.
**React:** pinned to ^19.0.0 via root `overrides`.

## Testing

```bash
npm run test             # Full suite (turbo, all packages)
npm run test:sdk         # SDK packages only
npm run test:launch      # Dashboard + facilitator
```

### Test Infrastructure Per Package

| Package | Runner | Location | Notes |
|---------|--------|----------|-------|
| Backend | Vitest | `src/**/__tests__/` or alongside source | Tests alongside source files |
| Dashboard | Vitest | `lib/__tests__/` | 3 tests currently (http-json) |
| Facilitator | `node --import tsx --test` | `tests/**/*.test.ts` | Node built-in runner |
| Contracts | Foundry (`forge test`) | `test/` | Docker fallback when forge not installed |
| SDK packages | Vitest | within each package | CI-run only |

### Test Principles

1. **Test behavior, not implementation.** Assert outcomes + invariants, not
   internal function calls or intermediate state.
2. **Test idempotency explicitly.** Every billing function should have a test
   that calls it twice with the same input and verifies the second call
   is a no-op.
3. **Test reconciliation queries.** The billing-reconciliation module catches
   real bugs that unit tests miss. Add a reconciliation assertion when you
   add a new billing side-effect.
4. **Don't write change-detector tests.** Don't freeze enumeration counts,
   model lists, or config versions. Test relationships and invariants instead.

## Security Rules

- **Secrets in `.env` only.** Never commit private keys, API secrets, or
  tokens. `.env.example` is safe (placeholders only).
- **Ops routes require OWNER/ADMIN roles.** Every route under `/api/v1/ops/`
  that mutates billing state must call `requireTeamRoles(c, ["OWNER", "ADMIN"])`.
- **Facilitator-auth uses a shared bearer secret.** `FACILITATOR_SECRET` shared
  between backend and facilitator. Rotating requires coordinated redeployment
  of both services.
- **Webhook signatures use HMAC-SHA256** (svix pattern: `svix-signature`
  header, `webhookId.timestamp.signature` format).
- **Invoice download URLs are HMAC-signed** with `INVOICE_DOWNLOAD_URL_TTL_SECONDS`
  expiration (default 86400s = 24h).
- **Stripe-style credential rules.** Publishable keys (`pk_`) are client-safe and
  only unlock read-only endpoints; secret (`sk_`) / restricted (`rk_`) keys are
  server-only with optional permission scopes; `arc_tok_` temp tokens are short-lived
  and company-scoped. Keys are stored hashed (SHA-256) and shown once; revoke/rotate
  to limit leaked-key blast radius. `R2_*` secrets live in `.env`.

## Contribution Rubric

### What We Want

- **Fix real bugs at root cause.** Point to the exact line. Fix the whole bug
  class (sibling call paths), not just the one reported site.
- **Preserve idempotency.** Every billing operation survives duplicate calls.
  Test this.
- **Centralize, don't duplicate.** Check `lib/billing/utils.ts` and
  `@arcenpay/internal-core` before defining local helpers or constants.
- **Add Prisma indexes for new query patterns.** The schema has 50+ compound
  indexes across billing models. New access patterns need indexes or they'll
  table-scan production.
- **Ship tests with billing changes.** At minimum: test the happy path, test
  idempotency (call twice, verify no-op), test the edge case you're fixing.

### What We Don't Want

- **Speculative infrastructure.** New billing fields, recovery task kinds, or
  event types with no concrete consumer.
- **Hardcoded magic numbers.** `31_536_000` -> `YEARLY_INTERVAL`.
  `48` hours -> make configurable or pull from a named constant.
- **New env vars for non-secret config.** `.env` is secrets only. Behavioral
  settings go in `config.ts` with function-based resolution.
- **Direct chain RPC calls from billing code.** Billing state comes from events
  via the facilitator.
- **Dead-letter replay through the facilitator.** Replay goes directly to
  `ingestBillingEvent()`.

### Before You Call It a Bug

1. **Verify the premise.** A "missing" feature may be deliberate isolation.
   A "wrong" value may be correct in the internal micros representation
   (1 USDC = 1_000_000 micros, not 100 = $1.00).
2. **Trace the exact code path.** Point to the line where the bug manifests.
3. **Check the Prisma schema.** Many "bugs" are missing indexes or incorrect
   unique constraints, not logic errors.
4. **Read the original intent.** `git log -p -- apps/arcen-backend/src/lib/billing/<file>.ts`
   to understand why a decision was made.

## Known Pitfalls

1. **Do not define `asRecord`, `normalizeWallet`, `readString`, or
   `deriveBillingPeriodFromInterval` locally.** They are in
   `lib/billing/utils.ts`. Import them.

2. **Do not hardcode `31_536_000`.** Import `YEARLY_INTERVAL` from
   `@arcenpay/internal-core`.

3. **`toSix()` uses JavaScript `Number.toFixed(6)`.** For amounts above ~1e15
   micros (~$1B), precision is lost. Architecturally wrong for a financial
   system but acceptable at current scale. Do not add more `toFixed()` calls
   without understanding this tradeoff.

4. **Prisma `Json` fields are untyped at the TypeScript level.** Always
   validate/coerce with `asRecord()` before accessing nested keys on:
   `BillingEvent.payload`, `SubscriptionState.metadata`, `Payment.metadata`,
   `BillingRecoveryTask.payload`, `Invoice.metadata`.

5. **`shared-types` contains NO billing types.** Billing types currently
   live only in the Prisma-generated client. If you need shared billing
   types between packages, add them to `shared-types` first.

6. **`date-fns` is pinned to `4.1.0` across the monorepo.** The backend's
   `package.json` has the exact version. Do not upgrade without checking
   facilitator compatibility — it also uses `date-fns` transitively.

7. **The facilitator queue is in-memory by default.** Without Redis, jobs
   are lost on restart. Redis-backed persistence is gated by providing a
   Redis client to `DurableJobQueue.setRedis()`.

8. **`R2_BUCKET` must be the plain bucket name — never a URL.** The storage
   endpoint is derived from `R2_ACCOUNT_ID`. A URL-like value fails fast with
   `STORAGE_R2_BUCKET_INVALID`. In dev `INVOICE_STORAGE_DIR` is `/tmp`, which
   clears on reboot; production needs a persistent volume (or use R2).

9. **Invoice PDFs are generated on demand — never stored.** Do NOT reintroduce
   file writes / `externalRef` object keys for invoices. `readSignedInvoicePdf` was
   replaced by `renderSignedInvoicePdf` (renders from the invoice object).

10. **The seeded "Classic" template is `isProtected`** — delete returns
    `403 PROTECTED_TEMPLATE`. Only custom templates can be deleted.

11. **Credentials are typed and gated.** Publishable keys only work on
    read-only endpoints (`requireApiKey` `allow` list); permission strings are
    looked up with exact match. When adding an endpoint, decide which key types
    it accepts — never silently allow all.

8. **Cascade deletes on Team.** Deleting a Team cascades to ALL billing
   records (events, payments, subscriptions, invoices, etc.). This is
   intentional for tenant isolation but means team deletion is irreversible.

## Domain Vocabulary

| Term | Definition |
|------|------------|
| **Company** | A customer entity with a wallet + active plan. Scoped to a team + environment. The DB model is `ArcenCompany` (mapped to `SchematicCompany`). |
| **Plan** | A catalog plan (CatalogPlan) with price, billing interval, entitlements. Published on-chain via PlanFactory as an on-chain plan ID. |
| **Subscription State** | Per-company ledger entry. Status: ACTIVE, PAST_DUE, or CANCELLED. Tracks period, grace, on-chain references. Uniquely keyed by `companyId`. |
| **Subscription Change Request** | Lifecycle FSM record for plan changes. 6 stages, 5 change types, 4 sources. Tracks 4 on-chain txHash fields. |
| **Billing Event** | Idempotent event log. Source of truth for all state transitions. 5 event types from the facilitator. Dedup by `idempotencyKey`. |
| **Recovery Task** | Retryable work item for operations that touch external systems (chain, email). 4-stage exponential backoff. 4 task kinds. |
| **Dunning** | Grace-period enforcement: PAST_DUE + past graceEndsAt -> downgrade to free plan. 7-day default grace period. |
| **Proration** | Mid-cycle plan change charge/credit based on remaining time ratio. Negative delta = credit, positive = charge. |
| **Credit Ledger** | Audit trail for credit operations. Kinds: GRANT, CONSUME, REFUND, ADJUSTMENT, EXPIRE, REVOKE. Serialized transactions for concurrency safety. |
| **Facilitator** | The Express bridge node. Polls chain events, relays as billing events. Runs BillingKeeper for renewals. Writes settlements on-chain. Delivers signed webhooks. |
| **BillingKeeper** | Facilitator component that scans SubscriptionRegistry for expiring subscriptions and executes renewals via AutopayModule. |
| **Idempotency Key** | Unique key per operation ensuring at-most-once semantics across retries. Multiple uniqueness scopes: BillingEvent (@unique), Payment (@unique), BillingRecoveryTask (@unique, also txHash). |
| **Micros** | Internal amount representation: 1 USDC = 1,000,000 micros (6 decimal places). All billing calculations use integers in micros. |
| **ArcenPay Protocol** | Web3 Entitlement and Access Protocol — the core product protocol layer: subscription NFTs, plan catalog, entitlements. |
| **ZKVUB** | Zero-Knowledge Verifiable Usage Billing — settlement verification via Groth16 zk-SNARK proofs for metered billing sessions. |
| **x402** | HTTP 402 Payment Required protocol. Agent SDK negotiates auto-payment via EIP-712 signed headers, SessionVault balance checks. |

## Codebase Navigation

### Finding things quickly

```bash
# Find where a billing function is defined
grep -rn "export.*functionName" apps/arcen-backend/src/lib/billing/

# Find all imports of a module
grep -rn "from.*module-name" apps/arcen-backend/src/

# Find all Prisma @unique constraints
grep -n "@unique" apps/arcen-backend/prisma/schema.prisma

# Find all route registrations
grep -rn "\.route\|\.get\|\.post\|\.put\|\.patch\|\.delete" apps/arcen-backend/src/routes/

# Find facilitator job queue usage
grep -rn "enqueue\|startWorker\|DurableJobQueue" apps/facilitator/src/

# See git history for a billing file
git log -p -- apps/arcen-backend/src/lib/billing/billing-events.ts
```

### Key files for common tasks

| Task | File(s) |
|------|---------|
| Add a new billing event type | `billing-events.ts` (type + handler), `schema.prisma` (enum) |
| Change subscription state logic | `billing-ledger.ts` (`upsertSubscriptionLedgerState`) |
| Add a recovery task kind | `billing-recovery.ts` (kind + handler), `schema.prisma` (enum) |
| Modify dunning behavior | `billing-dunning.ts` |
| Add a new webhook event | `deliver-webhook.ts` |
| Change invoice generation | `invoice-documents.ts` (on-demand PDF), `billing-events.ts` (trigger) |
| Build an invoice template | `invoice-builder/` (schema → store → renderer), routes `invoices/templates.ts` |
| Add object storage (R2/local) | `lib/storage/` (`getStorage()`, `ObjectStore`), `config.ts` STORAGE_DRIVER/R2_* |
| Manage API keys / credentials | `lib/auth/api-key-auth.ts` + routes `api-keys.ts` |
| Rotate webhook secret | `routes/v1/provider/webhook-secret.ts` (`whsec_`) |
| Add a new Prisma model | `schema.prisma` + migration |
| Add a new route | `routes/v1/` + register in `routes/v1/index.ts` |
| Change auth rules | `middleware/auth.ts` + `lib/auth/api-auth.ts` |
| Modify the facilitator queue | `queue.ts` (DurableJobQueue) |
