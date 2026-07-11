# ArcenPay Backend — Agent Guide

This file supplements the root `AGENTS.md` with backend-specific details.
The root file covers project-wide conventions; this file covers the backend
in depth.

## Backend at a Glance

- **Framework:** Hono v4 (Express-compatible API on Node.js)
- **Database:** PostgreSQL via Prisma v7 with `@prisma/adapter-pg`
- **Runtime:** Node.js 20+, ESM (`"type": "module"`)
- **Port:** 3300 (default)
- **~15,000+ LOC** across routes, services, lib modules

## Source Map

```
src/
├── server.ts                  # Entry point: Sentry init + serve
├── app.ts                     # Hono app factory (middleware + routes)
├── config.ts                  # All env -> config resolution (~350 lines)
├── db.ts                      # Prisma singleton + reconnect logic
├── load-env.ts                # dotenv loader
├── middleware/
│   ├── auth.ts                # requirePermission, requireFacilitatorAuth, resolveSession
│   ├── cors.ts                # CORS headers for SDK routes
│   └── rate-limit.ts          # Rate limiting
├── routes/
│   ├── index.ts               # App router: mounts v1Router at /
│   └── v1/
│       ├── index.ts            # Main v1 router: ~60 route registrations
│       ├── auth/               # Session, wallet, email auth
│       ├── billing/            # Facilitator-only: GET/POST /events
│       ├── catalog/            # Plans, add-ons, coupons, credit types, config
│       ├── companies/          # Company CRUD
│       ├── internal/           # Facilitator-only: maintenance, sync, agent configs
│       ├── ops/                # Admin-only: dunning, reconciliation, runtime, dead-letter
│       ├── webhooks/           # Webhook delivery, test, log
│       ├── invoices/           # Invoice CRUD, PDF download, ISO 20022 export, refunds
│       ├── provider/           # Provider profile, webhook secrets, API key management
│       ├── proofs/             # ZK proof tracking
│       ├── subscriber/         # Subscriber email registry
│       ├── templates/          # Component template management
│       ├── entitlements/       # Feature flag + entitlement resolution
│       ├── environment/        # Workspace environment management
│       ├── team/               # Team CRUD, invites, members
│       ├── audit/              # Audit log
│       ├── platform/           # Platform config, Tier management
│       └── public/             # Unauthenticated routes
├── lib/
│   ├── billing/                # 23 files — the billing engine (see root AGENTS.md for module map)
│   ├── catalog/                # Plan catalog, coupons, entitlements, component design
│   ├── webhooks/               # deliver-webhook.ts + verify-signature.ts
│   ├── auth/                   # api-auth.ts, facilitator-auth.ts, api-key-auth.ts, require-any-auth.ts
│   ├── entitlements/           # flag-engine.ts, flag-cache.ts, embed-access-token.ts
│   ├── payments/               # checkout-sessions.ts, payment-links.ts
│   ├── platform/               # audit.ts, default-chain.ts, launch-flags.ts
│   ├── companies/              # addon-grants.ts
│   └── environments/           # workspace-environments.ts, company-scope.ts
├── services/                   # Thin wrappers around lib/
│   ├── billing.service.ts      # BillingError class + facade for all billing operations
│   ├── catalog.service.ts
│   ├── company.service.ts
│   ├── checkout.service.ts
│   ├── payment.service.ts
│   ├── invoice.service.ts
│   ├── webhook.service.ts
│   ├── auth.service.ts
│   ├── entitlement.service.ts
│   └── platform.service.ts
├── utils/
│   ├── prisma-json.ts          # toPrismaJson(), toPrismaNullableJson()
│   ├── api-response.ts         # apiError(), apiSuccess()
│   └── logger.ts               # Structured JSON logger
└── generated/
    └── client/                 # Prisma-generated client (DO NOT EDIT)
```

## Route Registration Rules

1. Flat route files (Next.js-style `GET`, `POST`, `OPTIONS` exports) are
   imported directly in `routes/v1/index.ts`:
   ```typescript
   import { GET as listEvents, POST as trackEvent } from "./events.js";
   // ...
   .get("/events", listEvents)
   .post("/events", trackEvent)
   ```

2. Sub-routers are mounted with `.route()`:
   ```typescript
   .route("/billing", billingRoutes)
   .route("/catalog", catalogRoutes)
   ```

3. Route files should NOT contain business logic — they validate input,
   call a service/lib function, and return the result.

## Config Module (`config.ts`)

All env resolution happens here. Key exports:

```typescript
export const PORT: number                           // default 3300
export const BACKEND_URL: string                    // default "http://localhost:3300"
export const FACILITATOR_URL: string                // default "http://localhost:3402"
export const FACILITATOR_SECRET: string             // required in prod
export const RESEND_API_KEY: string                 // for transactional email
export const INVOICE_DOWNLOAD_SIGNING_SECRET: string // for HMAC-signed PDF URLs
export const INVOICE_STORAGE_DIR: string            // default "/tmp/arcenpay/invoices"
export const INVOICE_DOWNLOAD_URL_TTL_SECONDS: number // default 86400 (24h)
export const PIMLICO_API_KEY: string                // account abstraction infrastructure
export const WALLETCONNECT_PROJECT_ID: string       // required in prod
export function getRpcUrl(chainId: number): string  // round-robin RPC resolution
```

**Pattern:** fail-fast in production, warn in development. Never silently
fall back to localhost defaults in production.

## DB Module (`db.ts`)

```typescript
export const db = getClient();  // PrismaClient singleton

// For operations that need reconnect resilience:
export async function withPrismaReconnect<T>(
  operation: (client: PrismaClient) => Promise<T>,
): Promise<T>
```

The Prisma client is:
- Lazily created on first access
- Stored on `globalThis` (survives hot reload in dev)
- Auto-reconnects on connection loss (3 retries, exponential backoff)
- Retryable errors: P1001, P1017, P2024 + connection-terminated patterns

For transactions that need a custom client, pass a `client` parameter
through the billing function chain (many billing functions accept this).

## Prisma Schema (`prisma/schema.prisma`)

- **~70 models**, **~22 enum types**
- Generator outputs to `src/generated/client/`
- Datasource: PostgreSQL
- Key billing models documented in root AGENTS.md

### Billing Enums (complete list)

```
BillingEventType: SUBSCRIPTION_MINTED | SUBSCRIPTION_RENEWED | SUBSCRIPTION_CANCELLED | PAYMENT_FAILED | CREDIT_ISSUED
PaymentKind: SUBSCRIPTION_ACTIVATION | SUBSCRIPTION_RENEWAL | SUBSCRIPTION_PLAN_CHANGE_UPGRADE | MANUAL_INVOICE_PAYMENT | ADDON_PURCHASE | CUSTOM_PAYMENT
PaymentStatus: PENDING | SUCCEEDED | FAILED | CANCELLED
SubscriptionStatus: ACTIVE | PAST_DUE | CANCELLED
BillingRecoveryTaskKind: SUBSCRIPTION_ACTIVATION | SUBSCRIPTION_PLAN_CHANGE | SUBSCRIPTION_CANCELLATION | SUBSCRIPTION_RESUME
BillingRecoveryTaskStatus: PENDING | PROCESSING | COMPLETED | FAILED
SubscriptionChangeType: UPGRADE | DOWNGRADE | CANCELLATION | RESUME | BILLING_PERIOD_CHANGE
SubscriptionChangeStage: REQUESTED | PENDING_VERIFICATION | PENDING_RECOVERY | APPLIED | FAILED | REVERTED
SubscriptionChangeSource: SELF_SERVICE | ADMIN | RECOVERY | SYNC
BillingAdjustmentKind: UPGRADE_PRORATION_CHARGE | DOWNGRADE_PRORATION_CREDIT | MANUAL_CREDIT | MANUAL_DEBIT
CreditLedgerEntryKind: GRANT | CONSUME | REFUND | ADJUSTMENT | EXPIRE | REVOKE
CompanyCreditGrantStatus: ACTIVE | EXPIRED | REVOKED
CompanyCreditGrantSource: PLAN_GRANT | CREDIT_BUNDLE | ADMIN | ADJUSTMENT
CheckoutSessionStatus: PENDING | PAID | EXPIRED | CANCELLED | FAILED
```

### Cascade Delete Warning

Deleting a **Team** cascades to all related records:
BillingEvent, SubscriptionState, SubscriptionChangeRequest, Payment,
BillingRecoveryTask, Invoice, PaymentLink, CheckoutSession, etc.

This is intentional tenant isolation — team deletion is irreversible.

## Billing Recovery Lifecycle

```
1. enqueueSubscriptionActivationRecovery()
   └─> creates BillingRecoveryTask (status: PENDING)
   └─> idempotent by "subscription.activate:" + txHash

2. processPendingBillingRecoveryTasks()
   └─> finds tasks with status PENDING and nextAttemptAt <= now
   └─> claims task (sets status: PROCESSING) with optimistic P2002 handling
   └─> dispatches to processBillingRecoveryTask()

3. processBillingRecoveryTask()
   └─> switch on task.kind:
       ├─ SUBSCRIPTION_ACTIVATION -> processSubscriptionActivationTask()
       │   └─> creates invoice, records payment, upserts ledger state
       │   └─> grants plan credits, syncs subscriber email
       ├─ SUBSCRIPTION_PLAN_CHANGE -> processSubscriptionLifecycleTask()
       ├─ SUBSCRIPTION_CANCELLATION -> processSubscriptionLifecycleTask()
       └─ SUBSCRIPTION_RESUME -> processSubscriptionLifecycleTask()

4a. On success: task.status = COMPLETED, completedAt = now
4b. On failure: task.status = FAILED, attempts++, nextAttemptAt computed
    Retry delays: 5min -> 30min -> 2h -> 8h (clamped after attempt 4)
```

### Subscription Change Request FSM

```
REQUESTED ──> PENDING_VERIFICATION ──> PENDING_RECOVERY ──> APPLIED
                  │                       │                   │
                  └──> REVERTED           └──> FAILED         └──> FAILED (rare)
```

States transitioned by `updateSubscriptionChangeRequestStage()`.

## Internal Routes (Facilitator-Only)

All mounted at `/api/v1/internal/` with `requireFacilitatorAuth()` middleware:

```
GET  /agent-configs          # Agent configs for x402 payment negotiation
POST /billing/maintenance/all # Trigger maintenance sweep (optional executeDunning)
POST /subscription/sync       # Sync on-chain subscription to dashboard
POST /catalog/resolve-plan    # Resolve plan details for a given chain/token
POST /preview-token           # Create short-lived preview token for dashboard embeds
```

## Working with Billing Functions

When adding or modifying a billing function:

1. **Choose the right `idempotencyKey`.** Follow the naming conventions:
   - Events: `"payment:" + event.idempotencyKey`
   - Recovery: `"subscription.activate:" + txHash`
   - Plan changes: `"plan:.change:" + changeRequestId`
   - Credit grants: `"grant:" + planId + ":" + companyId + ":" + periodStart`

2. **Use Prisma `upsert` where possible.** For models with `@unique` on
   `idempotencyKey`, upsert is the simplest idempotent pattern.

3. **Use `findUnique` + `create` for multi-unique-key models.** For models
   like Payment (unique on both `idempotencyKey` and `txHash`), check both
   keys before creating.

4. **Pass `client` parameter for transactions.** When the function is called
   inside a `db.$transaction()`, accept an optional `client` parameter.
   The pattern: `(input, client: DbClient = db)`.

5. **Return a `deduped` flag.** Every mutation function's return type should
   indicate whether the operation was a duplicate so callers can handle
   side-effects conditionally.

6. **Fire-and-forget webhooks and emails.** Use `.catch()` — never `await`
   a webhook or email delivery inside a state mutation. This is a hard rule:
   webhook/email failures must never block billing state transitions.

## Common Pitfalls (Backend-Specific)

1. **Import paths use `.js` extensions.** ESM requires explicit extensions
   even for TypeScript: `import { db } from "../../db.js"`.

2. **Prisma `Json` fields need coercion.** `BillingEvent.payload` and
   `BillingRecoveryTask.payload` are `Json` type. Always wrap with
   `asRecord()` from `lib/billing/utils.ts` before accessing nested keys.

3. **Amounts are in micros.** `1000000` = 1 USDC. The database stores
   `Decimal(20,6)` — convert with `toSix()` for display. Plan prices in
   the database are in decimal USDC and must be converted to micros:
   `Math.round(price * 1_000_000)`.

4. **`date-fns` is pinned.** Do not upgrade. Version `4.1.0` is used by
   both the backend and facilitator transitively.

5. **Cascade deletes are intentional but dangerous.** Deleting a Team
   deletes all billing data for that tenant. There is no undo.

6. **The `shared-types` package has no billing types.** When adding types
   shared between backend and facilitator, prefer adding them to
   `shared-types` rather than duplicating.

## Prisma Commands

```bash
# Run these from apps/arcen-backend/
npm run db:generate         # Regenerate Prisma client (required after schema changes)
npm run db:migrate          # Create migration from schema changes (dev only)
npm run db:migrate:deploy   # Apply pending migrations (production)
npm run db:push             # Push schema directly (prototyping, no migration)
npm run db:studio           # Open Prisma Studio GUI on localhost
```

## Running Backend Tests

```bash
# From project root
npm run test                # All packages

# From apps/arcen-backend/
npm run test                # vitest run

# Run a specific test file
npx vitest run src/lib/billing/__tests__/billing-ledger.test.ts
```

Backend tests use Vitest. Tests live alongside source files or in
`__tests__/` directories. The billing module tests are the most
important — they exercise the idempotency and state transition logic.
