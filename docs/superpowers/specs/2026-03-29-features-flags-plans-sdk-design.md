# Features, Flags, Plans & SDK — End-to-End Design

**Date:** 2026-03-29
**Status:** Approved

---

## Context

ArcenPay has all the primitives for feature entitlement: plans with entitlement metadata, a rule-based flag engine, on-chain subscription NFTs, and SDK packages. However, the chain from plan creation → entitlement rules → subscription sync → SDK check is broken in four places:

1. Plan entitlements (stored as JSON) never auto-create `FlagRule`/`FlagRuleCondition` records, so `base_plan` rules never match.
2. On-chain subscription events are not wired to update `company.activePlanId`, so flag evaluation always misses plan context for blockchain subscribers.
3. The SDK requires company/user keys on every check — no Schematic-style "identify once, check anywhere."
4. There is no `checkEntitlement` shape — no `allocation / usage / exceeded` for metered features.

This design fixes all four gaps with a coherent architecture and no patch work.

---

## Design Principles

- **Identify once, check anywhere** — provider identifies their customer server-side once per session; all subsequent flag/entitlement checks use the session token with no keys.
- **Plan is the source of truth** — entitlement rules are derived from plan definitions, not managed separately.
- **DB-first, blockchain-fallback** — dashboard DB is the fast path; on-chain state is the repair mechanism when DB is stale.
- **Schematic-style consumer API** — `checkFlag` for boolean gating, `checkEntitlement` for quota-aware gating, `track` after successful actions.
- **Server enforcement is the guardrail** — client-side checks improve UX, but the API is the source of truth.

---

## Section 1: SDK Consumer Interface

### Node SDK

```ts
const arcen = new ArcenClient({ apiKey: 'api_...' });

// Called once per session (e.g., getServerSideProps, middleware, API handler)
const session = await arcen.identify({
  company: { id: 'company_123', wallet: '0x...', name: 'Acme Corp' },
  user:    { id: 'user_456', email: 'alice@acme.com' }
});
// → IdentifyResult { token, companyId, userId, expiresAt }

// No keys needed after identify()
const { enabled }                                  = await arcen.checkFlag('advanced-analytics');
const { enabled, allocation, usage, exceeded }     = await arcen.checkEntitlement('api.calls');
await arcen.track('api.calls'); // after successful action only
```

### React SDK

```tsx
// Provider gets token from your server session
<ArcenPayProvider token={session.token}>
  <App />
</ArcenPayProvider>

// Anywhere in the component tree — no wallet/company keys
const { enabled } = useFlag('advanced-analytics');
const { enabled, allocation, usage, exceeded } = useEntitlement('api.calls');
```

### Return Types

```ts
interface FlagResult {
  key: string;
  enabled: boolean;
  reason: string;
}

interface EntitlementResult {
  key: string;
  enabled: boolean;
  reason: string;
  allocation: number | null;  // null = unlimited
  usage: number;
  exceeded: boolean;
}

interface IdentifyResult {
  token: string;
  companyId: string;
  userId?: string;
  expiresAt: number;
}
```

---

## Section 2: Plan Entitlements → Flag Rules Auto-Sync

### Trigger

Saving entitlements via `PUT /api/catalog/plans/{id}/entitlements` triggers auto-sync.

### DB Sync (synchronous, within the same request)

For each entitlement in the plan:

```
CatalogFeatureFlag (upsert by teamId + key):
  { teamId, name: entitlement.featureName, key: entitlement.featureKey,
    type: entitlement.type, defaultValue: false | 0 }

FlagRule (upsert by flagId + source='plan' + sourceId=planId):
  { flagId, priority: 100, value: entitlement.value, enabled: entitlement.enabled }

FlagRuleCondition (upsert by ruleId):
  { ruleId, conditionType: 'base_plan', operator: 'eq', value: planId }
```

**Priority 100** for plan-level rules ensures company overrides (lower priority number = higher precedence) and custom targeting rules still win. Plan rules are the baseline.

When entitlement is removed: delete the corresponding `FlagRule` + `FlagRuleCondition`.
When plan is archived: disable all its `FlagRule` records (set `enabled = false`).

### On-Chain Sync (async, via facilitator)

After DB sync, enqueue an on-chain registration task:

```
POST /api/internal/flags/sync-to-chain
  { teamId, flags: [{ featureKey, defaultValue }] }

Facilitator calls:
  FlagRegistry.setFlags(teamId, featureKeys[], defaultValues[])
```

---

## Section 3: Subscription → Company Sync

### Primary Path (Facilitator → Dashboard)

```
On-chain: SubscriptionRegistry.mint(wallet, onChainPlanId, duration)
  → emits SubscriptionMinted(to: wallet, tokenId, onChainPlanId)

Facilitator EventListenerService detects event:
  → PATCH /api/internal/companies/sync-subscription
    { wallet, onChainPlanId, event: 'minted' | 'renewed' | 'cancelled' }

Dashboard handler:
  → find ArcenCompany by walletAddress
  → find CatalogPlan by onChainPlanId
  → 'minted' | 'renewed' → company.activePlanId = plan.id
  → 'cancelled'          → company.activePlanId = null (or free plan id)
```

### Fallback Path (Flag Engine — self-healing)

In `flag-engine.ts`, when `resolveCompany()` returns a company with `activePlanId = null`
and `walletAddress` is set:

```ts
const tokenId = await subscriptionRegistry.read.getWalletSubscription([wallet]);
if (tokenId > 0n) {
  const [onChainPlanId] = await subscriptionRegistry.read.getPlanFeatures([tokenId]);
  const plan = await db.catalogPlan.findFirst({ where: { onChainPlanId: Number(onChainPlanId) } });
  if (plan) {
    // Fire-and-forget repair
    db.arcenCompany.update({ where: { id: company.id }, data: { activePlanId: plan.id } });
    company.activePlanId = plan.id;
  }
}
```

One RPC lookup self-heals the DB so future checks hit the fast path.

---

## Section 4: Unified Check Endpoint

### Endpoint

```
GET /api/v1/check?key=<featureKey>
```

### Authentication

| Method | How | Context Source |
|--------|-----|---------------|
| Access token | `Authorization: Bearer <token>` | DB lookup by token hash → companyId/userId |
| API key | `Authorization: Bearer api_key_...` | `X-Arcen-Company-Keys` / `X-Arcen-User-Keys` headers |

Backward compat: existing `/api/v1/flags/check` endpoint is kept as-is.

### Logic

```
1. Resolve company + user (from token OR headers)
2. If activePlanId = null AND walletAddress set → on-chain fallback (Section 3)
3. evaluateFlag(teamId, featureKey, company, user) → FlagCheckResult
4. If featureFlag.type is NUMERIC or UNLIMITED:
     usage = aggregateUsage(companyId, featureKey, currentBillingWindow)
     allocation = matchedRule.value (null if UNLIMITED)
     exceeded = allocation !== null && usage >= allocation
5. Return FlagResult or EntitlementResult
```

### Responses

```json
// BOOLEAN flag
{ "key": "advanced-analytics", "enabled": true, "reason": "rule:plan_pro" }

// NUMERIC entitlement
{ "key": "api.calls", "enabled": true, "reason": "rule:plan_pro",
  "allocation": 1000, "usage": 247, "exceeded": false }

// UNLIMITED entitlement
{ "key": "storage", "enabled": true, "reason": "rule:plan_enterprise",
  "allocation": null, "usage": 42, "exceeded": false }
```

---

## Section 5: Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `apps/arcen-dashboard/app/api/v1/check/route.ts` | Unified check endpoint |
| `apps/arcen-dashboard/app/api/internal/companies/sync-subscription/route.ts` | Subscription sync from facilitator |
| `apps/arcen-dashboard/app/api/internal/flags/sync-to-chain/route.ts` | Trigger FlagRegistry.sol sync via facilitator |
| `packages/sdk-react/src/hooks/useEntitlement.ts` | New Schematic-style quota hook |

### Modified Files

| File | Change |
|------|--------|
| `apps/arcen-dashboard/app/api/catalog/plans/[id]/entitlements/route.ts` | After save: upsert FlagRule/FlagRuleCondition, queue on-chain sync |
| `apps/arcen-dashboard/lib/flag-engine.ts` | Add on-chain viem fallback, add usage aggregation to result |
| `apps/facilitator/src/server.ts` | Wire EventListenerService → dashboard sync-subscription call |
| `packages/sdk-core/src/types.ts` | Add FlagResult, EntitlementResult, IdentifyResult |
| `packages/sdk-node/src/client.ts` | Add identify() with session storage; update checkFlag(); add checkEntitlement() |
| `packages/sdk-react/src/hooks/useFlag.ts` | Use token from ArcenPayProvider context; company keys become optional |
| `packages/sdk-react/src/providers/ArcenPayProvider.tsx` | Accept company + user props; call identify on mount; store token in context |
| `packages/sdk-react/src/index.ts` | Export useEntitlement |

---

## Section 6: Data Flow Diagram

```
Provider setup:
  Dashboard: Create Plan → Add Entitlements
    ↓ (auto-sync)
  CatalogFeatureFlag + FlagRule + FlagRuleCondition (DB)
    ↓ (async)
  FlagRegistry.sol (on-chain defaults)

Customer subscribes:
  SubscriptionRegistry.mint() on-chain
    ↓ (EventListenerService)
  PATCH /api/internal/companies/sync-subscription
    ↓
  company.activePlanId = planId (DB)

Provider's app server:
  arcen.identify({ company, user })
    ↓
  POST /api/v1/access-tokens (auto-upsert company/user)
    ↓
  returns { token, companyId, userId }

Frontend check:
  useFlag('api.calls')
    ↓
  GET /api/v1/check?key=api.calls  (Bearer token)
    ↓
  resolveCompany(token) → company.activePlanId
    ↓ (if null, on-chain fallback)
  evaluateFlag() → NUMERIC → aggregateUsage()
    ↓
  { enabled, allocation, usage, exceeded }
```

---

## Section 7: Verification

### Unit Test (flag engine)
- Create a plan with NUMERIC entitlement (api.calls, 1000)
- Assign plan to a company via `activePlanId`
- Call `evaluateFlag('api.calls', company)` → should return `{ value: 1000, reason: 'rule:plan_...' }`

### Integration Test (check endpoint)
- Create access token for company on pro plan
- `GET /api/v1/check?key=api.calls` with Bearer token
- Assert: `{ enabled: true, allocation: 1000, usage: 0, exceeded: false }`
- Track 1001 events: `POST /api/v1/events` × 1001
- Re-check: `exceeded: true`

### SDK E2E Test
```ts
const arcen = new ArcenClient({ apiKey });
const session = await arcen.identify({ company: { id: 'test-co' } });
// session.token should be defined
const flag = await arcen.checkFlag('test-feature');
// flag.enabled should match plan entitlement
const ent = await arcen.checkEntitlement('api.calls');
// ent.allocation should equal plan's entitlement value
```

### Blockchain Sync Test
- Emit `SubscriptionMinted` event on local hardhat node
- Verify facilitator calls `PATCH /api/internal/companies/sync-subscription`
- Verify `company.activePlanId` is updated
- Verify subsequent `GET /api/v1/check` returns enabled = true
