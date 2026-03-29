# Features, Flags, Plans & SDK — End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire plan entitlements → flag rules → subscription sync → SDK checks into a coherent, Schematic-style end-to-end system where `identify()` once enables zero-config `checkFlag()`/`checkEntitlement()` everywhere.

**Architecture:** Plan entitlements auto-sync to `FlagRule`/`FlagRuleCondition` rows on every save. On-chain subscription events (via the facilitator's existing `EventListenerService`) call a new internal dashboard endpoint to update `company.activePlanId`. The unified `/api/v1/check` endpoint resolves context from an access token (no company keys per-call), evaluates the flag via the existing engine, and enriches NUMERIC features with `allocation/usage/exceeded`. SDK packages wrap this into `identify()` + `checkFlag()` + `checkEntitlement()` + `useEntitlement()`.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, viem (on-chain reads), TypeScript, React, Node.js

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/arcen-dashboard/prisma/schema.prisma` | Modify | Add `source`/`sourceId` to `FlagRule` |
| `apps/arcen-dashboard/lib/sync-entitlements.ts` | **Create** | Pure helper: plan entitlements → DB flag rules upsert |
| `apps/arcen-dashboard/app/api/catalog/plans/[id]/entitlements/route.ts` | Modify | Call sync helper after every save |
| `apps/arcen-dashboard/app/api/internal/companies/sync-subscription/route.ts` | **Create** | Facilitator → dashboard subscription state sync |
| `apps/arcen-dashboard/app/api/v1/check/route.ts` | **Create** | Unified flag+entitlement check endpoint (token or API key) |
| `apps/arcen-dashboard/lib/flag-engine.ts` | Modify | On-chain viem fallback when `activePlanId` is null |
| `apps/facilitator/src/server.ts` | Modify | Wire `EventListenerService` minted/renewed/cancelled → dashboard |
| `packages/sdk-core/src/types.ts` | Modify | Add `FlagResult`, `EntitlementResult`, `IdentifyResult` |
| `packages/sdk-node/src/client.ts` | Modify | `identify()` returns token; add `checkEntitlement()`; update `checkFlag()` |
| `packages/sdk-react/src/providers/MEAPProvider.tsx` | Modify | Accept `company`/`user`/`token` props; store token in context |
| `packages/sdk-react/src/hooks/useFlag.ts` | Modify | Read token from context; company keys become optional |
| `packages/sdk-react/src/hooks/useEntitlement.ts` | **Create** | Schematic-style `{ enabled, allocation, usage, exceeded }` hook |
| `packages/sdk-react/src/index.ts` | Modify | Export `useEntitlement` |

---

## Task 1: Schema Migration — Add `source`/`sourceId` to `FlagRule`

**Files:**
- Modify: `apps/arcen-dashboard/prisma/schema.prisma`

Plan-generated rules must be distinguishable from manually created ones so they can be updated/deleted when plan entitlements change.

- [ ] **Step 1: Add fields to `FlagRule` model**

Open `apps/arcen-dashboard/prisma/schema.prisma`. Find the `model FlagRule` block (currently lines 827–837) and replace it with:

```prisma
model FlagRule {
  id       String  @id @default(cuid())
  flagId   String
  priority Int     // evaluation order — lower number = evaluated first
  value    Boolean // True or False to serve when this rule matches

  // 'manual' (default) | 'plan' — tracks auto-generated rules
  source   String? @default("manual")
  // For source='plan': the CatalogPlan.id that generated this rule
  sourceId String?

  conditions FlagRuleCondition[]
  flag       CatalogFeatureFlag @relation(fields: [flagId], references: [id], onDelete: Cascade)

  @@index([flagId, priority])
  @@index([flagId, source, sourceId])
}
```

- [ ] **Step 2: Generate and run the migration**

```bash
cd apps/arcen-dashboard
npx prisma migrate dev --name add_flagrule_source
```

Expected output includes: `The following migration(s) have been created and applied from new schema changes`

- [ ] **Step 3: Verify migration applied**

```bash
npx prisma studio
```

Open `FlagRule` table and confirm `source` and `sourceId` columns exist. Then close Prisma Studio.

- [ ] **Step 4: Commit**

```bash
cd /path/to/repo
git add apps/arcen-dashboard/prisma/schema.prisma apps/arcen-dashboard/prisma/migrations/
git commit -m "feat(schema): add source/sourceId to FlagRule for plan-generated rule tracking"
```

---

## Task 2: sdk-core Types — `FlagResult`, `EntitlementResult`, `IdentifyResult`

**Files:**
- Modify: `packages/sdk-core/src/types.ts`

- [ ] **Step 1: Add types to sdk-core**

Open `packages/sdk-core/src/types.ts`. Find the end of the file and append:

```typescript
// ─── Schematic-style SDK types ────────────────────────────────────────────────

/**
 * Result of checkFlag() — boolean feature gating.
 * Use for "should this feature be visible/enabled?"
 */
export interface FlagResult {
  key: string;
  /** Whether the feature is enabled for this company/user */
  enabled: boolean;
  /** Machine-readable reason: 'override', 'rule:<ruleId>', 'default' */
  reason: string;
}

/**
 * Result of checkEntitlement() — quota-aware feature gating.
 * Use for "can this action still be performed under the customer's plan limits?"
 */
export interface EntitlementResult {
  key: string;
  /** Whether the feature is enabled (regardless of quota) */
  enabled: boolean;
  /** Machine-readable reason */
  reason: string;
  /** Maximum allowed usage. null = unlimited */
  allocation: number | null;
  /** Current usage count in the active billing period */
  usage: number;
  /** true when usage >= allocation (and allocation is not null) */
  exceeded: boolean;
}

/**
 * Result of identify() — creates/updates company+user and returns a session token.
 */
export interface IdentifyResult {
  token: string;
  companyId: string;
  userId?: string;
  expiresAt: number; // unix timestamp
}
```

- [ ] **Step 2: Export from index**

Open `packages/sdk-core/src/index.ts`. Find the existing exports and add:

```typescript
export type { FlagResult, EntitlementResult, IdentifyResult } from './types';
```

- [ ] **Step 3: Build sdk-core to verify no type errors**

```bash
cd packages/sdk-core
npm run build
```

Expected: `Build succeeded` (or equivalent, no TypeScript errors).

- [ ] **Step 4: Commit**

```bash
git add packages/sdk-core/src/types.ts packages/sdk-core/src/index.ts
git commit -m "feat(sdk-core): add FlagResult, EntitlementResult, IdentifyResult types"
```

---

## Task 3: Plan Entitlement Sync Helper

**Files:**
- Create: `apps/arcen-dashboard/lib/sync-entitlements.ts`

This is a pure DB function — no HTTP, no side effects beyond Prisma writes. It takes plan entitlements and upserts/deletes the corresponding `CatalogFeatureFlag`, `FlagRule`, and `FlagRuleCondition` rows.

- [ ] **Step 1: Write the failing test**

Create `apps/arcen-dashboard/lib/__tests__/sync-entitlements.test.ts`:

```typescript
import { syncEntitlementsToFlagRules } from '../sync-entitlements';
import { db } from '../db';

// Mock db
jest.mock('../db', () => ({
  db: {
    catalogFeatureFlag: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    flagRule: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    flagRuleCondition: { create: jest.fn() },
  },
}));

describe('syncEntitlementsToFlagRules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts a CatalogFeatureFlag for each enabled entitlement', async () => {
    (db.catalogFeatureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1' });
    (db.flagRule.create as jest.Mock).mockResolvedValue({ id: 'rule_1' });

    await syncEntitlementsToFlagRules('team_1', 'plan_1', [
      { featureName: 'Advanced Analytics', featureKey: 'advanced_analytics', type: 'BOOLEAN', value: true, enabled: true },
    ]);

    expect(db.catalogFeatureFlag.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId_featureKey: { teamId: 'team_1', featureKey: 'advanced_analytics' } },
      create: expect.objectContaining({ featureKey: 'advanced_analytics', featureType: 'boolean' }),
    }));
  });

  it('creates a FlagRule with source=plan and sourceId=planId', async () => {
    (db.catalogFeatureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1' });
    (db.flagRule.create as jest.Mock).mockResolvedValue({ id: 'rule_1' });

    await syncEntitlementsToFlagRules('team_1', 'plan_1', [
      { featureName: 'API Calls', featureKey: 'api_calls', type: 'NUMERIC', value: 1000, enabled: true },
    ]);

    expect(db.flagRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'plan', sourceId: 'plan_1', value: true, priority: 100 }),
    }));
  });

  it('creates a FlagRuleCondition with criteriaType=base_plan and the planId in values', async () => {
    (db.catalogFeatureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1' });
    (db.flagRule.create as jest.Mock).mockResolvedValue({ id: 'rule_1' });

    await syncEntitlementsToFlagRules('team_1', 'plan_1', [
      { featureName: 'Webhooks', featureKey: 'webhooks', type: 'BOOLEAN', value: true, enabled: true },
    ]);

    expect(db.flagRuleCondition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        criteriaType: 'base_plan',
        operator: 'is_one_of',
        values: ['plan_1'],
      }),
    }));
  });

  it('deletes existing plan rules before recreating them', async () => {
    (db.catalogFeatureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1' });
    (db.flagRule.create as jest.Mock).mockResolvedValue({ id: 'rule_1' });

    await syncEntitlementsToFlagRules('team_1', 'plan_1', []);

    expect(db.flagRule.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ source: 'plan', sourceId: 'plan_1' }),
    }));
  });

  it('skips disabled entitlements', async () => {
    (db.catalogFeatureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1' });
    (db.flagRule.create as jest.Mock).mockResolvedValue({ id: 'rule_1' });

    await syncEntitlementsToFlagRules('team_1', 'plan_1', [
      { featureName: 'Disabled Feature', featureKey: 'disabled', type: 'BOOLEAN', value: true, enabled: false },
    ]);

    expect(db.flagRule.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/arcen-dashboard
npx jest lib/__tests__/sync-entitlements.test.ts --no-coverage
```

Expected: `FAIL` — `Cannot find module '../sync-entitlements'`

- [ ] **Step 3: Implement `sync-entitlements.ts`**

Create `apps/arcen-dashboard/lib/sync-entitlements.ts`:

```typescript
/**
 * Syncs plan entitlements to FlagRule + FlagRuleCondition rows.
 *
 * Called after any entitlement save (POST/PUT/DELETE).
 * Deletes existing plan-generated rules for this plan, then recreates them.
 */

import { db } from "@/lib/db";

export interface PlanEntitlement {
  featureName: string;
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  enabled: boolean;
}

/**
 * Maps entitlement type to the featureType string stored on CatalogFeatureFlag.
 * Uses 'event_based' for NUMERIC/UNLIMITED since those are metered by event counts.
 */
function toFeatureType(type: PlanEntitlement["type"]): string {
  switch (type) {
    case "NUMERIC":
    case "UNLIMITED":
      return "event_based";
    case "BOOLEAN":
    default:
      return "boolean";
  }
}

/**
 * Upserts CatalogFeatureFlag + FlagRule + FlagRuleCondition rows for each
 * enabled entitlement in the plan. Clears previous plan-generated rules first.
 *
 * Priority 100 means plan-level rules are baseline — company overrides
 * (evaluated at lower priority numbers) still win.
 */
export async function syncEntitlementsToFlagRules(
  teamId: string,
  planId: string,
  entitlements: PlanEntitlement[],
): Promise<void> {
  // Step 1: Delete all existing plan-generated rules for this plan.
  // FlagRuleConditions are deleted via cascade.
  await db.flagRule.deleteMany({
    where: {
      source: "plan",
      sourceId: planId,
      flag: { teamId },
    },
  });

  // Step 2: Recreate rules for each enabled entitlement.
  for (const entitlement of entitlements) {
    if (!entitlement.enabled) continue;

    // Upsert the feature flag (creates it if it doesn't exist yet).
    const flag = await db.catalogFeatureFlag.upsert({
      where: {
        teamId_featureKey: { teamId, featureKey: entitlement.featureKey },
      },
      update: {
        name: entitlement.featureName,
        featureType: toFeatureType(entitlement.type),
        // For event_based features, eventKey matches the featureKey
        eventKey: entitlement.type !== "BOOLEAN" ? entitlement.featureKey : undefined,
      },
      create: {
        teamId,
        featureKey: entitlement.featureKey,
        name: entitlement.featureName,
        featureType: toFeatureType(entitlement.type),
        defaultValue: false,
        eventKey: entitlement.type !== "BOOLEAN" ? entitlement.featureKey : undefined,
      },
    });

    // Create the plan-generated rule.
    const rule = await db.flagRule.create({
      data: {
        flagId: flag.id,
        priority: 100,
        value: true, // all plan entitlements grant access (allocation lives in plan metadata)
        source: "plan",
        sourceId: planId,
      },
    });

    // Create the condition: company must have this plan as their active plan.
    await db.flagRuleCondition.create({
      data: {
        ruleId: rule.id,
        criteriaType: "base_plan",
        operator: "is_one_of",
        values: [planId],
      },
    });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd apps/arcen-dashboard
npx jest lib/__tests__/sync-entitlements.test.ts --no-coverage
```

Expected: `PASS` — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/arcen-dashboard/lib/sync-entitlements.ts apps/arcen-dashboard/lib/__tests__/sync-entitlements.test.ts
git commit -m "feat(flags): add syncEntitlementsToFlagRules helper"
```

---

## Task 4: Wire Sync into Entitlements Route

**Files:**
- Modify: `apps/arcen-dashboard/app/api/catalog/plans/[id]/entitlements/route.ts`

- [ ] **Step 1: Add import and call sync after every mutating operation**

Open `apps/arcen-dashboard/app/api/catalog/plans/[id]/entitlements/route.ts`.

Add this import at the top (after existing imports):

```typescript
import { syncEntitlementsToFlagRules, type PlanEntitlement } from "@/lib/sync-entitlements";
```

In the `POST` handler, **after** the `db.catalogPlan.update()` call that saves `newEntitlements`, add:

```typescript
// Auto-sync entitlements to flag rules (fire-and-forget for performance)
syncEntitlementsToFlagRules(auth.team.teamId, plan.id, newEntitlements as PlanEntitlement[]).catch(
  (err) => console.error("[Entitlements] Flag rule sync failed:", err),
);
```

In the `PUT` handler, after `db.catalogPlan.update()`:

```typescript
syncEntitlementsToFlagRules(auth.team.teamId, plan.id, existing as PlanEntitlement[]).catch(
  (err) => console.error("[Entitlements] Flag rule sync failed:", err),
);
```

In the `DELETE` handler, after `db.catalogPlan.update()`:

```typescript
syncEntitlementsToFlagRules(auth.team.teamId, plan.id, filtered as PlanEntitlement[]).catch(
  (err) => console.error("[Entitlements] Flag rule sync failed:", err),
);
```

- [ ] **Step 2: Verify the route file still type-checks**

```bash
cd apps/arcen-dashboard
npx tsc --noEmit
```

Expected: No errors related to entitlements route.

- [ ] **Step 3: Commit**

```bash
git add apps/arcen-dashboard/app/api/catalog/plans/
git commit -m "feat(catalog): auto-sync entitlements to flag rules on save"
```

---

## Task 5: Internal Subscription Sync Endpoint

**Files:**
- Create: `apps/arcen-dashboard/app/api/internal/companies/sync-subscription/route.ts`

Called by the facilitator when it detects an on-chain `SubscriptionMinted`/`SubscriptionRenewed`/`SubscriptionCancelled` event.

Auth: `Authorization: Bearer <FACILITATOR_SECRET>` (same pattern as other internal endpoints).

- [ ] **Step 1: Write the failing test**

Create `apps/arcen-dashboard/app/api/internal/companies/sync-subscription/__tests__/route.test.ts`:

```typescript
import { PATCH } from '../route';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  db: {
    arcenCompany: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    catalogPlan: {
      findFirst: jest.fn(),
    },
  },
}));

const FACILITATOR_SECRET = 'test-secret';
process.env.FACILITATOR_SECRET = FACILITATOR_SECRET;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/internal/companies/sync-subscription', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FACILITATOR_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/internal/companies/sync-subscription', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without correct secret', async () => {
    const req = new NextRequest('http://localhost/api/internal/companies/sync-subscription', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer wrong' },
      body: JSON.stringify({ wallet: '0xabc', onChainPlanId: '1', event: 'minted' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('sets activePlanId on minted event', async () => {
    (db.arcenCompany.findFirst as jest.Mock).mockResolvedValue({ id: 'co_1' });
    (db.catalogPlan.findFirst as jest.Mock).mockResolvedValue({ id: 'plan_1' });
    (db.arcenCompany.update as jest.Mock).mockResolvedValue({});

    const res = await PATCH(makeRequest({ wallet: '0xabc', onChainPlanId: '42', event: 'minted' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { activePlanId: 'plan_1' },
    }));
  });

  it('clears activePlanId on cancelled event', async () => {
    (db.arcenCompany.findFirst as jest.Mock).mockResolvedValue({ id: 'co_1' });
    (db.arcenCompany.update as jest.Mock).mockResolvedValue({});

    const res = await PATCH(makeRequest({ wallet: '0xabc', onChainPlanId: null, event: 'cancelled' }));

    expect(res.status).toBe(200);
    expect(db.arcenCompany.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { activePlanId: null },
    }));
  });

  it('returns 404 if company not found', async () => {
    (db.arcenCompany.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ wallet: '0xabc', onChainPlanId: '1', event: 'minted' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/arcen-dashboard
npx jest app/api/internal/companies/sync-subscription --no-coverage
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement the route**

Create `apps/arcen-dashboard/app/api/internal/companies/sync-subscription/route.ts`:

```typescript
/**
 * PATCH /api/internal/companies/sync-subscription
 *
 * Called by the facilitator when a subscription event is detected on-chain.
 * Updates company.activePlanId based on the event type.
 *
 * Auth: Authorization: Bearer <FACILITATOR_SECRET>
 *
 * Body:
 *   wallet        — subscriber wallet address
 *   onChainPlanId — the planId from PlanFactory.sol (null for cancellation)
 *   event         — 'minted' | 'renewed' | 'cancelled'
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const FACILITATOR_SECRET = process.env.FACILITATOR_SECRET ?? "";

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
  onChainPlanId: z.string().nullable(),
  event: z.enum(["minted", "renewed", "cancelled"]),
});

export async function PATCH(req: NextRequest) {
  // Verify facilitator secret
  const auth = req.headers.get("authorization") ?? "";
  if (!FACILITATOR_SECRET || auth !== `Bearer ${FACILITATOR_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { wallet, onChainPlanId, event } = parsed.data;

  // Find company by wallet address (across all teams)
  const company = await db.arcenCompany.findFirst({
    where: { walletAddress: wallet.toLowerCase() },
    select: { id: true, teamId: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found for wallet" }, { status: 404 });
  }

  if (event === "cancelled") {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { activePlanId: null },
    });
    return NextResponse.json({ ok: true, activePlanId: null });
  }

  // minted | renewed — resolve the on-chain plan to our internal plan
  const plan = await db.catalogPlan.findFirst({
    where: { onChainPlanId, teamId: company.teamId },
    select: { id: true },
  });

  if (!plan) {
    // Log but don't fail — the plan may not be registered in dashboard yet
    console.warn(
      `[SyncSubscription] No CatalogPlan found for onChainPlanId=${onChainPlanId} teamId=${company.teamId}`,
    );
    return NextResponse.json(
      { ok: false, error: "Plan not found for onChainPlanId" },
      { status: 404 },
    );
  }

  await db.arcenCompany.update({
    where: { id: company.id },
    data: { activePlanId: plan.id },
  });

  return NextResponse.json({ ok: true, activePlanId: plan.id });
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd apps/arcen-dashboard
npx jest app/api/internal/companies/sync-subscription --no-coverage
```

Expected: `PASS` — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/arcen-dashboard/app/api/internal/
git commit -m "feat(internal): add sync-subscription endpoint for facilitator callbacks"
```

---

## Task 6: Unified `/api/v1/check` Endpoint

**Files:**
- Create: `apps/arcen-dashboard/app/api/v1/check/route.ts`

Resolves context from access token OR API key + headers. Evaluates the flag. Enriches NUMERIC/UNLIMITED features with `allocation`/`usage`/`exceeded`.

- [ ] **Step 1: Write the failing test**

Create `apps/arcen-dashboard/app/api/v1/check/__tests__/route.test.ts`:

```typescript
import { GET } from '../route';
import { NextRequest } from 'next/server';
import * as flagEngine from '@/lib/flag-engine';
import * as aggregator from '@/lib/event-aggregator';
import { db } from '@/lib/db';
import crypto from 'crypto';

jest.mock('@/lib/flag-engine');
jest.mock('@/lib/event-aggregator');
jest.mock('@/lib/db', () => ({
  db: {
    arcenApiKey: { findFirst: jest.fn() },
    embedAccessToken: { findFirst: jest.fn() },
    catalogFeatureFlag: { findUnique: jest.fn() },
    catalogPlan: { findFirst: jest.fn() },
    arcenCompany: { findFirst: jest.fn() },
  },
}));

const mockFlag = jest.mocked(flagEngine.evaluateFlag);
const mockAggregate = jest.mocked(aggregator.aggregateUsage);
const mockResolveCompany = jest.mocked(flagEngine.resolveCompany);

describe('GET /api/v1/check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when key is missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/check', {
      headers: { Authorization: 'Bearer api_test' },
    });
    // Mock valid API key
    (db.arcenApiKey.findFirst as jest.Mock).mockResolvedValue({ teamId: 'team_1' });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns enabled=true for a BOOLEAN flag', async () => {
    (db.arcenApiKey.findFirst as jest.Mock).mockResolvedValue({ teamId: 'team_1' });
    (db.catalogFeatureFlag.findUnique as jest.Mock).mockResolvedValue({ featureType: 'boolean' });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockFlag.mockResolvedValue({ flag: 'advanced_analytics', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });

    const req = new NextRequest('http://localhost/api/v1/check?key=advanced_analytics', {
      headers: {
        Authorization: 'Bearer api_test',
        'X-Arcen-Company-Keys': 'id=co_1',
      },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.enabled).toBe(true);
    expect(json.reason).toBe('rule:plan_pro');
    expect(json.allocation).toBeUndefined();
  });

  it('returns allocation/usage/exceeded for NUMERIC flag', async () => {
    (db.arcenApiKey.findFirst as jest.Mock).mockResolvedValue({ teamId: 'team_1' });
    (db.catalogFeatureFlag.findUnique as jest.Mock).mockResolvedValue({ featureType: 'event_based', eventKey: 'api_calls' });
    (db.catalogPlan.findFirst as jest.Mock).mockResolvedValue({
      metadata: { entitlements: [{ featureKey: 'api_calls', type: 'NUMERIC', value: 1000, enabled: true }] },
    });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockFlag.mockResolvedValue({ flag: 'api_calls', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });
    mockAggregate.mockResolvedValue(247);

    const req = new NextRequest('http://localhost/api/v1/check?key=api_calls', {
      headers: {
        Authorization: 'Bearer api_test',
        'X-Arcen-Company-Keys': 'id=co_1',
      },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(json.enabled).toBe(true);
    expect(json.allocation).toBe(1000);
    expect(json.usage).toBe(247);
    expect(json.exceeded).toBe(false);
  });

  it('returns exceeded=true when usage >= allocation', async () => {
    (db.arcenApiKey.findFirst as jest.Mock).mockResolvedValue({ teamId: 'team_1' });
    (db.catalogFeatureFlag.findUnique as jest.Mock).mockResolvedValue({ featureType: 'event_based', eventKey: 'api_calls' });
    (db.catalogPlan.findFirst as jest.Mock).mockResolvedValue({
      metadata: { entitlements: [{ featureKey: 'api_calls', type: 'NUMERIC', value: 100, enabled: true }] },
    });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockFlag.mockResolvedValue({ flag: 'api_calls', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });
    mockAggregate.mockResolvedValue(101);

    const req = new NextRequest('http://localhost/api/v1/check?key=api_calls', {
      headers: {
        Authorization: 'Bearer api_test',
        'X-Arcen-Company-Keys': 'id=co_1',
      },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(json.exceeded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/arcen-dashboard
npx jest app/api/v1/check --no-coverage
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement the check endpoint**

Create `apps/arcen-dashboard/app/api/v1/check/route.ts`:

```typescript
/**
 * GET /api/v1/check?key=<featureKey>
 *
 * Unified flag + entitlement check endpoint.
 *
 * Auth (either):
 *  A) Bearer <access_token>  — resolves company/user from EmbedAccessToken record
 *  B) Bearer api_<key>       — API key auth; reads X-Arcen-Company-Keys / X-Arcen-User-Keys headers
 *
 * Returns:
 *  BOOLEAN features: { key, enabled, reason }
 *  NUMERIC/UNLIMITED features: { key, enabled, reason, allocation, usage, exceeded }
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { evaluateFlag, resolveCompany, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { aggregateUsage } from "@/lib/event-aggregator";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";

// ─── Access Token Resolution ─────────────────────────────────────────────────

interface TokenContext {
  teamId: string;
  companyId: string | null;
  userId: string | null;
}

async function resolveAccessToken(token: string): Promise<TokenContext | null> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await db.embedAccessToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: { teamId: true, companyId: true, userId: true },
  });
  return record ?? null;
}

// ─── Header parsing (same as /api/v1/flags/check) ────────────────────────────

function parseKeyHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key && val) result[key] = val;
  }
  return result;
}

// ─── Entitlement allocation from plan metadata ────────────────────────────────

interface EntitlementEntry {
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  enabled: boolean;
}

async function getAllocationFromPlan(
  teamId: string,
  activePlanId: string,
  featureKey: string,
): Promise<{ allocation: number | null; type: string }> {
  const plan = await db.catalogPlan.findFirst({
    where: { id: activePlanId, teamId },
    select: { metadata: true },
  });

  if (!plan?.metadata) return { allocation: null, type: "UNLIMITED" };

  const meta = plan.metadata as { entitlements?: EntitlementEntry[] };
  const entitlement = meta.entitlements?.find((e) => e.featureKey === featureKey);

  if (!entitlement) return { allocation: null, type: "UNLIMITED" };
  if (entitlement.type === "UNLIMITED") return { allocation: null, type: "UNLIMITED" };
  if (entitlement.type === "NUMERIC") return { allocation: Number(entitlement.value), type: "NUMERIC" };
  return { allocation: null, type: "BOOLEAN" };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const featureKey = req.nextUrl.searchParams.get("key");
  if (!featureKey || featureKey.length > 128) {
    return NextResponse.json({ error: "Missing or invalid query param: key" }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  let teamId: string;
  let companyId: string | null = null;
  let userId: string | null = null;
  let companyKeys: CompanyKeys | undefined;
  let userKeys: UserKeys | undefined;

  // Determine auth path
  if (bearerToken.startsWith("api_")) {
    // API key path — use standard requireApiKey + header-based company keys
    const ctx = await requireApiKey(req, { rateLimit: { limit: 500, windowMs: 60_000 } });
    if (isApiKeyError(ctx)) return ctx;
    teamId = ctx.teamId;

    const rawCompanyKeys = parseKeyHeader(req.headers.get("x-arcen-company-keys"));
    const rawUserKeys = parseKeyHeader(req.headers.get("x-arcen-user-keys"));

    companyKeys = {
      id: rawCompanyKeys["id"],
      wallet: rawCompanyKeys["wallet"] ?? rawCompanyKeys["wallet_address"],
      email: rawCompanyKeys["email"],
    };

    if (!companyKeys.id && !companyKeys.wallet && !companyKeys.email) {
      return NextResponse.json(
        { error: "At least one company key (id, wallet, or email) is required" },
        { status: 400 },
      );
    }

    userKeys =
      rawUserKeys["id"] || rawUserKeys["clerk_user_id"] || rawUserKeys["wallet"]
        ? {
            id: rawUserKeys["id"],
            clerkUserId: rawUserKeys["clerk_user_id"],
            wallet: rawUserKeys["wallet"],
          }
        : undefined;
  } else if (bearerToken) {
    // Access token path — resolve company/user from token
    const tokenCtx = await resolveAccessToken(bearerToken);
    if (!tokenCtx) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    teamId = tokenCtx.teamId;
    companyId = tokenCtx.companyId;
    userId = tokenCtx.userId;
  } else {
    return NextResponse.json({ error: "Authorization required" }, { status: 401 });
  }

  // Evaluate the flag
  const result = await evaluateFlag(teamId, featureKey, companyKeys ?? { id: companyId ?? undefined }, userKeys ?? (userId ? { id: userId } : undefined));

  const resolvedCompanyId = result.companyId ?? companyId ?? undefined;

  // Look up the feature type to determine if we need allocation/usage
  const flagDef = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId, featureKey } },
    select: { featureType: true, eventKey: true },
  });

  const isMetered =
    flagDef?.featureType === "event_based" ||
    flagDef?.featureType === "numeric" ||
    flagDef?.featureType === "unlimited";

  if (!isMetered) {
    // Boolean feature — simple response
    return NextResponse.json({
      key: featureKey,
      enabled: result.value,
      reason: result.reason,
    });
  }

  // Metered feature — fetch allocation + usage
  const company = resolvedCompanyId
    ? await db.arcenCompany.findFirst({
        where: { id: resolvedCompanyId },
        select: { activePlanId: true },
      })
    : null;

  const { allocation, type: entitlementType } = company?.activePlanId
    ? await getAllocationFromPlan(teamId, company.activePlanId, featureKey)
    : { allocation: null, type: "UNLIMITED" };

  const metricKey = flagDef?.eventKey ?? featureKey;
  const usage = resolvedCompanyId
    ? await aggregateUsage(teamId, resolvedCompanyId, metricKey, "monthly")
    : 0;

  const exceeded = allocation !== null && usage >= allocation;

  return NextResponse.json({
    key: featureKey,
    enabled: result.value,
    reason: result.reason,
    allocation,
    usage,
    exceeded,
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/arcen-dashboard
npx jest app/api/v1/check --no-coverage
```

Expected: `PASS` — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/arcen-dashboard/app/api/v1/check/
git commit -m "feat(api): add unified /api/v1/check endpoint with token auth and entitlement enrichment"
```

---

## Task 7: On-Chain Fallback in Flag Engine

**Files:**
- Modify: `apps/arcen-dashboard/lib/flag-engine.ts`

When `resolveCompany()` returns a company with `activePlanId = null` and a wallet address, try reading the on-chain subscription state to self-heal the DB.

- [ ] **Step 1: Add viem imports and RPC config at the top of flag-engine.ts**

Open `apps/arcen-dashboard/lib/flag-engine.ts`. After the existing imports, add:

```typescript
import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";
import { getContractAddresses } from "@arcenpay/sdk";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);
const RPC_URL = process.env.RPC_URL ?? "";

// Lazy-initialized viem client for on-chain reads
let _viemClient: PublicClient | null = null;
function getViemClient(): PublicClient | null {
  if (!RPC_URL) return null;
  if (_viemClient) return _viemClient;
  const chain = CHAIN_ID === 8453 ? base : CHAIN_ID === 84532 ? baseSepolia : sepolia;
  _viemClient = createPublicClient({ chain, transport: http(RPC_URL) });
  return _viemClient;
}

// Minimal ABI subset for on-chain subscription lookup
const SUBSCRIPTION_REGISTRY_ABI = [
  {
    name: "getWalletSubscription",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "getPlanFeatures",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "onChainPlanId", type: "uint256" },
      { name: "planTier", type: "string" },
    ],
  },
] as const;
```

- [ ] **Step 2: Add the on-chain fallback function after the ABI definition**

After the ABI definition, add:

```typescript
/**
 * Tries to read the on-chain subscription for a wallet and update the DB.
 * Returns the resolved activePlanId if found, null otherwise.
 * Called only when company.activePlanId is null and a wallet is available.
 */
async function resolveOnChainPlan(
  teamId: string,
  companyId: string,
  wallet: string,
): Promise<string | null> {
  const client = getViemClient();
  if (!client) return null;

  try {
    const contracts = getContractAddresses(CHAIN_ID);
    if (!contracts.subscriptionRegistry) return null;

    const tokenId = await client.readContract({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SUBSCRIPTION_REGISTRY_ABI,
      functionName: "getWalletSubscription",
      args: [wallet as `0x${string}`],
    });

    if (!tokenId || tokenId === 0n) return null;

    const [onChainPlanId] = await client.readContract({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SUBSCRIPTION_REGISTRY_ABI,
      functionName: "getPlanFeatures",
      args: [tokenId],
    });

    const plan = await db.catalogPlan.findFirst({
      where: { onChainPlanId: String(onChainPlanId), teamId },
      select: { id: true },
    });

    if (!plan) return null;

    // Fire-and-forget DB repair — future checks use the fast path
    db.arcenCompany
      .update({ where: { id: companyId }, data: { activePlanId: plan.id } })
      .catch(() => {});

    return plan.id;
  } catch {
    // On-chain read failed — not a hard error, just skip
    return null;
  }
}
```

- [ ] **Step 3: Call the fallback in `resolveCompany()`**

Find the `return` at the end of `resolveCompany()` (the line that returns the company object). Replace:

```typescript
  return {
    id: company.id,
    traits: (company.traits as Record<string, unknown>) ?? {},
    activePlanId: company.activePlanId,
    activeAddOnIds: Array.isArray(company.activeAddOnIds) ? (company.activeAddOnIds as string[]) : [],
  };
```

With:

```typescript
  let activePlanId = company.activePlanId;

  // On-chain fallback: if activePlanId is null but we have a wallet, try to resolve from chain
  if (!activePlanId && keys.wallet) {
    const onChainPlanId = await resolveOnChainPlan(teamId, company.id, keys.wallet.toLowerCase());
    if (onChainPlanId) activePlanId = onChainPlanId;
  }

  return {
    id: company.id,
    traits: (company.traits as Record<string, unknown>) ?? {},
    activePlanId,
    activeAddOnIds: Array.isArray(company.activeAddOnIds) ? (company.activeAddOnIds as string[]) : [],
  };
```

- [ ] **Step 4: Type-check**

```bash
cd apps/arcen-dashboard
npx tsc --noEmit
```

Expected: No new errors in flag-engine.ts.

- [ ] **Step 5: Commit**

```bash
git add apps/arcen-dashboard/lib/flag-engine.ts
git commit -m "feat(flag-engine): add on-chain viem fallback for activePlanId resolution"
```

---

## Task 8: Facilitator Subscription Event Wiring

**Files:**
- Modify: `apps/facilitator/src/server.ts`

The facilitator already has `postToDashboard()` and handlers for `minted`/`renewed`/`cancelled`. We add one `postToDashboard` call in each handler.

- [ ] **Step 1: Add `postToDashboard` call in the `minted` handler**

Open `apps/facilitator/src/server.ts`. Find the `eventListener.on("minted", ...)` callback (around line 1287). After the `tokenIdToSubscriber.set(...)` line, add:

```typescript
  // Sync subscription to dashboard DB so flag evaluation uses the correct plan
  if (event.subscriber) {
    postToDashboard("/api/internal/companies/sync-subscription", {
      wallet: event.subscriber,
      onChainPlanId: event.planId?.toString() ?? null,
      event: "minted",
    }).catch((err) =>
      console.error("[Facilitator] sync-subscription (minted) failed:", err),
    );
  }
```

- [ ] **Step 2: Find the `renewed` handler and add the same call**

Find `eventListener.on("renewed", ...)`. After any existing logic in the callback, add:

```typescript
  if (event.subscriber) {
    postToDashboard("/api/internal/companies/sync-subscription", {
      wallet: event.subscriber,
      onChainPlanId: event.planId?.toString() ?? null,
      event: "renewed",
    }).catch((err) =>
      console.error("[Facilitator] sync-subscription (renewed) failed:", err),
    );
  }
```

- [ ] **Step 3: Find the `cancelled` handler and add the clear call**

Find `eventListener.on("cancelled", ...)`. Add:

```typescript
  if (event.subscriber) {
    postToDashboard("/api/internal/companies/sync-subscription", {
      wallet: event.subscriber,
      onChainPlanId: null,
      event: "cancelled",
    }).catch((err) =>
      console.error("[Facilitator] sync-subscription (cancelled) failed:", err),
    );
  }
```

- [ ] **Step 4: Type-check facilitator**

```bash
cd apps/facilitator
npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/facilitator/src/server.ts
git commit -m "feat(facilitator): wire subscription events to dashboard sync-subscription endpoint"
```

---

## Task 9: Node SDK — `identify()` Returns Token, Add `checkEntitlement()`

**Files:**
- Modify: `packages/sdk-node/src/client.ts`

Three changes:
1. `identify()` now calls `/api/v1/access-tokens` and stores the session token internally.
2. `checkFlag(key)` no longer requires company keys if a session exists.
3. New `checkEntitlement(key)` method using the unified `/api/v1/check` endpoint.

- [ ] **Step 1: Write failing tests**

Create `packages/sdk-node/src/__tests__/client.test.ts`:

```typescript
import { ArcenClient } from '../client';

const BASE_URL = 'http://localhost';
const API_KEY = 'api_testkey123';

// Mock fetch globally
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

describe('ArcenClient', () => {
  let client: ArcenClient;

  beforeEach(() => {
    mockFetch.mockClear();
    client = new ArcenClient({ apiKey: API_KEY, baseUrl: BASE_URL });
  });

  describe('identify()', () => {
    it('calls /api/v1/access-tokens and returns IdentifyResult', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        data: { token: 'tok_abc', company_id: 'co_1', user_id: 'u_1', expires_at: 9999999999 },
      }));

      const result = await client.identify({ company: { id: 'co_1' } });

      expect(result.token).toBe('tok_abc');
      expect(result.companyId).toBe('co_1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/access-tokens'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('stores session token internally after identify()', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          data: { token: 'tok_abc', company_id: 'co_1', expires_at: 9999999999 },
        }))
        .mockResolvedValueOnce(mockResponse({
          key: 'feature', enabled: true, reason: 'rule:plan_pro',
        }));

      await client.identify({ company: { id: 'co_1' } });
      await client.checkFlag('feature');

      // Second call should use Bearer tok_abc (not the API key)
      const secondCallHeaders = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
      expect(secondCallHeaders['Authorization']).toBe('Bearer tok_abc');
    });
  });

  describe('checkFlag()', () => {
    it('uses /api/v1/check endpoint and returns FlagResult', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ key: 'feature', enabled: true, reason: 'default' }));

      const result = await client.checkFlag('feature');

      expect(result.enabled).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/check?key=feature'),
        expect.anything(),
      );
    });
  });

  describe('checkEntitlement()', () => {
    it('returns EntitlementResult with allocation/usage/exceeded', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        key: 'api_calls', enabled: true, reason: 'rule:plan_pro',
        allocation: 1000, usage: 247, exceeded: false,
      }));

      const result = await client.checkEntitlement('api_calls');

      expect(result.allocation).toBe(1000);
      expect(result.usage).toBe(247);
      expect(result.exceeded).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/sdk-node
npx jest src/__tests__/client.test.ts --no-coverage
```

Expected: `FAIL` — existing `checkFlag` doesn't use `/api/v1/check`, `identify` doesn't return token.

- [ ] **Step 3: Rewrite `ArcenClient` with the new interface**

Open `packages/sdk-node/src/client.ts`. Replace the entire file content with:

```typescript
/**
 * ArcenClient — Node.js SDK for the ArcenPay Protocol.
 *
 * Usage pattern (Schematic-style):
 *  1. Call identify() once per session → stores session token
 *  2. Call checkFlag() / checkEntitlement() / track() with no keys
 *
 * @example
 * const arcen = new ArcenClient({ apiKey: process.env.ARCEN_API_KEY! });
 *
 * const session = await arcen.identify({ company: { id: 'co_123', wallet: '0x...' } });
 * // session.token → pass to React SDK
 *
 * const { enabled } = await arcen.checkFlag('advanced-analytics');
 * const { enabled, allocation, usage, exceeded } = await arcen.checkEntitlement('api.calls');
 * await arcen.track('api.calls'); // after successful action
 */

import type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  ArcenCompany,
  EmbedAccessTokenResponse,
  FlagResult,
  EntitlementResult,
  IdentifyResult,
} from '@arcenpay/sdk';

export interface ArcenClientConfig {
  /** Your ArcenPay API key (starts with api_) */
  apiKey: string;
  /** Base URL of your ArcenPay dashboard (default: https://dashboard.arcenpay.xyz) */
  baseUrl?: string;
  /** Request timeout in ms (default: 10_000) */
  timeoutMs?: number;
}

export interface TrackEventInput {
  name: string;
  company?: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
}

export interface IdentifyInput {
  company?: ArcenCompanyKeys & { name?: string; traits?: Record<string, unknown> };
  user?: ArcenUserKeys & { name?: string; email?: string };
  expiresIn?: number; // seconds, default 3600
}

export class ArcenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  // Session stored after identify()
  private session: { token: string; companyId: string; userId?: string } | null = null;

  constructor(config: ArcenClientConfig) {
    if (!config.apiKey.startsWith('api_')) {
      throw new Error('ArcenClient: apiKey must start with "api_"');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://dashboard.arcenpay.xyz').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private buildAuthHeader(): string {
    return this.session ? `Bearer ${this.session.token}` : `Bearer ${this.apiKey}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      companyKeys?: ArcenCompanyKeys;
      userKeys?: ArcenUserKeys;
      query?: Record<string, string>;
      useApiKey?: boolean; // force API key even if session exists
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: options.useApiKey ? `Bearer ${this.apiKey}` : this.buildAuthHeader(),
      'Content-Type': 'application/json',
    };

    // Only send company/user key headers when using API key auth (no session)
    if (!this.session || options.useApiKey) {
      if (options.companyKeys) {
        const parts: string[] = [];
        if (options.companyKeys.id) parts.push(`id=${options.companyKeys.id}`);
        if (options.companyKeys.wallet) parts.push(`wallet=${options.companyKeys.wallet}`);
        if (options.companyKeys.email) parts.push(`email=${options.companyKeys.email}`);
        if (parts.length > 0) headers['X-Arcen-Company-Keys'] = parts.join(',');
      }

      if (options.userKeys) {
        const parts: string[] = [];
        if (options.userKeys.id) parts.push(`id=${options.userKeys.id}`);
        if (options.userKeys.clerkUserId) parts.push(`clerk_user_id=${options.userKeys.clerkUserId}`);
        if (options.userKeys.wallet) parts.push(`wallet=${options.userKeys.wallet}`);
        if (parts.length > 0) headers['X-Arcen-User-Keys'] = parts.join(',');
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const json = await res.json() as T & { error?: string };

      if (!res.ok) {
        throw new ArcenApiError(
          (json as { error?: string }).error ?? `HTTP ${res.status}`,
          res.status,
        );
      }

      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Identity ──────────────────────────────────────────────────────────────

  /**
   * Identify (upsert) a company and/or user. Returns a session token.
   * After calling identify(), all subsequent checkFlag/checkEntitlement/track
   * calls use the session token — no company keys needed.
   *
   * Pass the returned token to the React SDK (ArcenPayProvider token prop).
   */
  async identify(input: IdentifyInput): Promise<IdentifyResult> {
    const res = await this.request<{ data: EmbedAccessTokenResponse }>(
      'POST',
      '/api/v1/access-tokens',
      {
        useApiKey: true, // always use API key for identify
        body: {
          company: input.company,
          user: input.user ? {
            id: input.user.id,
            clerk_user_id: input.user.clerkUserId,
            wallet: input.user.wallet,
            name: input.user.name,
            email: input.user.email,
          } : undefined,
          expires_in: input.expiresIn ?? 3600,
        },
      },
    );

    const data = res.data;
    this.session = {
      token: data.token,
      companyId: data.company_id,
      userId: data.user_id,
    };

    return {
      token: data.token,
      companyId: data.company_id,
      userId: data.user_id,
      expiresAt: data.expires_at,
    };
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  /** Track a usage event. Call this AFTER a successful action, not before. */
  async track(event: string | TrackEventInput): Promise<void> {
    const input: TrackEventInput = typeof event === 'string' ? { name: event } : event;
    await this.request('POST', '/api/v1/events', {
      useApiKey: true,
      body: {
        event_type: 'track',
        name: input.name,
        company: input.company ?? (this.session ? { id: this.session.companyId } : undefined),
        traits: input.traits,
      },
    });
  }

  // ─── Feature Checks ────────────────────────────────────────────────────────

  /**
   * Check if a feature flag is enabled.
   * Use for boolean gating: "should this feature be visible/enabled?"
   *
   * If identify() was called, no company keys are needed.
   * If not identified, pass companyKeys.
   */
  async checkFlag(key: string, companyKeys?: ArcenCompanyKeys, userKeys?: ArcenUserKeys): Promise<FlagResult> {
    const res = await this.request<FlagResult>(
      'GET',
      '/api/v1/check',
      { query: { key }, companyKeys, userKeys },
    );
    return res;
  }

  /**
   * Check a metered/quota-aware entitlement.
   * Use for "can this action still be performed under the customer's plan limits?"
   * Returns allocation (plan limit), usage (current period count), exceeded flag.
   *
   * If identify() was called, no company keys are needed.
   */
  async checkEntitlement(key: string, companyKeys?: ArcenCompanyKeys, userKeys?: ArcenUserKeys): Promise<EntitlementResult> {
    const res = await this.request<EntitlementResult>(
      'GET',
      '/api/v1/check',
      { query: { key }, companyKeys, userKeys },
    );
    return res;
  }

  // ─── Batch Flag Check (backward compat) ───────────────────────────────────

  async checkFlags(
    featureKeys: string[],
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
  ): Promise<Record<string, FlagResult>> {
    const results = await Promise.all(
      featureKeys.map((key) => this.checkFlag(key, companyKeys, userKeys)),
    );
    return Object.fromEntries(results.map((r) => [r.key, r]));
  }

  // ─── Companies ──────────────────────────────────────────────────────────────

  async listCompanies(options: { limit?: number; search?: string; cursor?: string } = {}): Promise<{
    data: ArcenCompany[];
    count: number;
    nextCursor?: string;
  }> {
    const query: Record<string, string> = {};
    if (options.limit) query.limit = String(options.limit);
    if (options.search) query.search = options.search;
    if (options.cursor) query.cursor = options.cursor;
    return this.request('GET', '/api/v1/companies', { useApiKey: true, query });
  }

  async getCompany(id: string): Promise<{ data: ArcenCompany & { entitlements: unknown[] } }> {
    return this.request('GET', `/api/v1/companies/${id}`, { useApiKey: true });
  }

  async createCompany(data: {
    name: string;
    wallet?: string;
    email?: string;
    id?: string;
    traits?: Record<string, unknown>;
  }): Promise<{ data: ArcenCompany }> {
    return this.request('POST', '/api/v1/companies', { useApiKey: true, body: data });
  }

  async updateCompany(
    id: string,
    data: { name?: string; traits?: Record<string, unknown>; activePlanId?: string | null },
  ): Promise<{ data: ArcenCompany }> {
    return this.request('PATCH', `/api/v1/companies/${id}`, { useApiKey: true, body: data });
  }

  async setCompanyOverride(companyId: string, featureKey: string, value: boolean, reason?: string): Promise<void> {
    await this.request('POST', `/api/v1/companies/${companyId}/overrides`, {
      useApiKey: true,
      body: { featureKey, value, reason },
    });
  }

  /** @deprecated Use identify() instead */
  async createAccessToken(
    companyKeys?: ArcenCompanyKeys,
    userKeys?: ArcenUserKeys,
    expiresIn = 3600,
  ): Promise<EmbedAccessTokenResponse> {
    const res = await this.request<{ data: EmbedAccessTokenResponse }>(
      'POST',
      '/api/v1/access-tokens',
      {
        useApiKey: true,
        body: {
          company: companyKeys,
          user: userKeys ? {
            id: userKeys.id,
            clerk_user_id: userKeys.clerkUserId,
            wallet: userKeys.wallet,
          } : undefined,
          expires_in: expiresIn,
        },
      },
    );
    return res.data;
  }
}

export class ArcenApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ArcenApiError';
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/sdk-node
npx jest src/__tests__/client.test.ts --no-coverage
```

Expected: `PASS` — all tests green.

- [ ] **Step 5: Build to verify types**

```bash
npm run build
```

Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-node/src/client.ts packages/sdk-node/src/__tests__/
git commit -m "feat(sdk-node): identify() returns token, add checkEntitlement(), update checkFlag() to use /api/v1/check"
```

---

## Task 10: React SDK — Provider Accepts `company`/`user`/`token` Props

**Files:**
- Modify: `packages/sdk-react/src/providers/MEAPProvider.tsx`

Add a second context (`ArcenSessionContext`) to hold the access token. Accept `company`, `user`, and `token` props. When `company`/`user` are provided and no `token`, call identify on mount.

- [ ] **Step 1: Add session context to MEAPProvider.tsx**

Open `packages/sdk-react/src/providers/MEAPProvider.tsx`. After the existing context/types, add:

```typescript
// ─── Session Context ──────────────────────────────────────────────────────────

export interface ArcenSessionContextValue {
  token: string | null;
  companyId: string | null;
  userId: string | null;
  isReady: boolean;
}

const ArcenSessionContext = createContext<ArcenSessionContextValue>({
  token: null,
  companyId: null,
  userId: null,
  isReady: false,
});

export function useArcenSession(): ArcenSessionContextValue {
  return useContext(ArcenSessionContext);
}
```

- [ ] **Step 2: Add new props to `MEAPProviderProps` / `ArcenPayProviderProps`**

Find the `MEAPProviderProps` interface and add:

```typescript
export interface MEAPProviderProps {
  children: ReactNode;
  config?: Partial<MEAPConfig>;
  chainId?: number;
  walletConnectProjectId?: string;
  /** API key for server-to-server identify() calls (client-side use is insecure; prefer token) */
  apiKey?: string;
  /** Pre-minted session token from arcen.identify() on your server */
  token?: string;
  /** If provided with apiKey, auto-identify on mount */
  company?: { id?: string; wallet?: string; email?: string; name?: string; traits?: Record<string, unknown> };
  /** If provided with apiKey, include user in identify */
  user?: { id?: string; clerkUserId?: string; wallet?: string; email?: string; name?: string };
}
```

- [ ] **Step 3: Add session state and identify effect to `MEAPProvider`**

Inside the `MEAPProvider` function, after the existing state declarations, add:

```typescript
  const [sessionCtx, setSessionCtx] = useState<ArcenSessionContextValue>({
    token: props.token ?? null,
    companyId: null,
    userId: null,
    isReady: !!props.token,
  });

  const { apiKey, token: tokenProp, company, user } = props;

  // Effect: if a token was passed directly, mark ready
  useEffect(() => {
    if (tokenProp) {
      setSessionCtx({ token: tokenProp, companyId: null, userId: null, isReady: true });
    }
  }, [tokenProp]);

  // Effect: if company/user + apiKey provided (and no direct token), auto-identify
  useEffect(() => {
    if (tokenProp || !apiKey || (!company && !user)) return;

    const baseUrl =
      (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_ARCEN_BASE_URL : undefined) ??
      'https://dashboard.arcenpay.xyz';

    fetch(`${baseUrl}/api/v1/access-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ company, user, expires_in: 3600 }),
    })
      .then((r) => r.json())
      .then((json: { data?: { token: string; company_id: string; user_id?: string } }) => {
        if (json.data?.token) {
          setSessionCtx({
            token: json.data.token,
            companyId: json.data.company_id,
            userId: json.data.user_id ?? null,
            isReady: true,
          });
        }
      })
      .catch((err) => console.error('[ArcenPayProvider] identify failed:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);
```

- [ ] **Step 4: Wrap children with `ArcenSessionContext.Provider`**

Find the `return` statement of `MEAPProvider`. Wrap the existing JSX to also provide the session context:

```typescript
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MEAPContext.Provider value={contextValue}>
          <ArcenSessionContext.Provider value={sessionCtx}>
            {children}
          </ArcenSessionContext.Provider>
        </MEAPContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
```

- [ ] **Step 5: Build to check for type errors**

```bash
cd packages/sdk-react
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-react/src/providers/MEAPProvider.tsx
git commit -m "feat(sdk-react): add session context and token/company/user props to ArcenPayProvider"
```

---

## Task 11: React SDK — `useFlag` Uses Token from Context

**Files:**
- Modify: `packages/sdk-react/src/hooks/useFlag.ts`

Currently `useFlag` requires `companyKeys` to be passed. After this change, if a session token is available from the provider, no keys are needed.

- [ ] **Step 1: Add `useArcenSession` import and use token in the hook**

Open `packages/sdk-react/src/hooks/useFlag.ts`. Add this import near the top:

```typescript
import { useArcenSession } from '../providers/MEAPProvider';
```

Inside the `useFlag` hook function, after existing state declarations, add:

```typescript
  const session = useArcenSession();
```

Find where the `Authorization` header is built. It currently uses `apiKey` or `accessToken`. Update to also check session:

```typescript
  const effectiveToken = accessToken ?? (session.token ?? undefined);
  // ... use effectiveToken instead of accessToken in the Authorization header
```

Find the `headers` construction in the fetch call and update:

```typescript
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
};

if (effectiveToken) {
  headers['Authorization'] = `Bearer ${effectiveToken}`;
} else if (apiKey) {
  headers['Authorization'] = `Bearer ${apiKey}`;
}

// Only send company/user keys when NOT using a session token
if (!effectiveToken) {
  if (companyKeys?.id) {
    const parts: string[] = [];
    if (companyKeys.id) parts.push(`id=${companyKeys.id}`);
    if (companyKeys.wallet) parts.push(`wallet=${companyKeys.wallet}`);
    if (companyKeys.email) parts.push(`email=${companyKeys.email}`);
    if (parts.length) headers['X-Arcen-Company-Keys'] = parts.join(',');
  }
  // ... same for userKeys
}
```

Also update the fetch URL to use `/api/v1/check` instead of `/api/v1/flags/check`:

```typescript
const url = new URL(`${baseUrl}/api/v1/check`);
url.searchParams.set('key', featureKey);
```

Update the response parsing. The old endpoint returned `{ data: { flag, value, reason } }`. The new `/api/v1/check` returns `{ key, enabled, reason }`. Update:

```typescript
// Old:
setValue(json.data?.value ?? false);
setReason(json.data?.reason ?? 'default');

// New:
setValue(json.enabled ?? false);
setReason(json.reason ?? 'default');
```

- [ ] **Step 2: Build to check for type errors**

```bash
cd packages/sdk-react
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk-react/src/hooks/useFlag.ts
git commit -m "feat(sdk-react): useFlag reads token from ArcenPayProvider context, uses /api/v1/check"
```

---

## Task 12: React SDK — New `useEntitlement` Hook

**Files:**
- Create: `packages/sdk-react/src/hooks/useEntitlement.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk-react/src/hooks/__tests__/useEntitlement.test.tsx`:

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useEntitlement } from '../useEntitlement';

// Mock the session context
jest.mock('../providers/MEAPProvider', () => ({
  useArcenSession: () => ({ token: 'tok_test', companyId: 'co_1', isReady: true }),
  useMEAP: () => ({ config: { tablelandConfig: {} } }),
}));

global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('useEntitlement', () => {
  beforeEach(() => mockFetch.mockClear());

  it('returns EntitlementResult with allocation/usage/exceeded', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'api_calls',
        enabled: true,
        reason: 'rule:plan_pro',
        allocation: 1000,
        usage: 247,
        exceeded: false,
      }),
    } as Response);

    const { result } = renderHook(() => useEntitlement('api_calls'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.enabled).toBe(true);
    expect(result.current.allocation).toBe(1000);
    expect(result.current.usage).toBe(247);
    expect(result.current.exceeded).toBe(false);
  });

  it('starts with loading=true', () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    const { result } = renderHook(() => useEntitlement('feature'));
    expect(result.current.loading).toBe(true);
  });

  it('calls /api/v1/check with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ key: 'api_calls', enabled: true, reason: 'default', allocation: null, usage: 0, exceeded: false }),
    } as Response);

    renderHook(() => useEntitlement('api_calls'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/v1/check?key=api_calls');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok_test');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/sdk-react
npx jest src/hooks/__tests__/useEntitlement.test.tsx --no-coverage
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement `useEntitlement`**

Create `packages/sdk-react/src/hooks/useEntitlement.ts`:

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useArcenSession, useMEAP } from "../providers/MEAPProvider";
import type { EntitlementResult } from "@arcenpay/sdk";

export interface UseEntitlementOptions {
  /** Override the base URL for the API call */
  baseUrl?: string;
  /** Cache duration in ms (default: 30_000) */
  cacheTtlMs?: number;
}

export interface UseEntitlementReturn extends Partial<EntitlementResult> {
  enabled: boolean;
  allocation: number | null;
  usage: number;
  exceeded: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// Module-level cache: key → { result, expiresAt }
const cache = new Map<string, { result: EntitlementResult; expiresAt: number }>();

/**
 * useEntitlement — Schematic-style quota-aware feature check.
 *
 * Returns enabled, allocation (plan limit), usage (current period), and exceeded flag.
 * Requires ArcenPayProvider with a token prop (or company prop for auto-identify).
 *
 * @example
 * const { enabled, allocation, usage, exceeded } = useEntitlement('api.calls');
 *
 * if (!enabled) return <UpgradeGate />;
 * if (exceeded) return <LimitReached used={usage} limit={allocation} />;
 *
 * return <DoTheAction />;
 */
export function useEntitlement(
  featureKey: string,
  options: UseEntitlementOptions = {},
): UseEntitlementReturn {
  const session = useArcenSession();
  const { config } = useMEAP();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const baseUrl =
    options.baseUrl ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ARCEN_BASE_URL : undefined) ??
    "https://dashboard.arcenpay.xyz";

  const [result, setResult] = useState<EntitlementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlement = useCallback(async () => {
    if (!session.token) return;

    const cacheKey = `entitlement:${session.token}:${featureKey}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      setResult(cached.result);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const url = new URL(`${baseUrl}/api/v1/check`);
      url.searchParams.set("key", featureKey);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const json = (await res.json()) as EntitlementResult;
      cache.set(cacheKey, { result: json, expiresAt: Date.now() + cacheTtlMs });
      setResult(json);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [session.token, featureKey, baseUrl, cacheTtlMs]);

  useEffect(() => {
    fetchEntitlement();
    return () => abortRef.current?.abort();
  }, [fetchEntitlement]);

  return {
    key: result?.key ?? featureKey,
    enabled: result?.enabled ?? false,
    reason: result?.reason,
    allocation: result?.allocation ?? null,
    usage: result?.usage ?? 0,
    exceeded: result?.exceeded ?? false,
    loading,
    error,
    refetch: fetchEntitlement,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/sdk-react
npx jest src/hooks/__tests__/useEntitlement.test.tsx --no-coverage
```

Expected: `PASS` — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-react/src/hooks/useEntitlement.ts packages/sdk-react/src/hooks/__tests__/
git commit -m "feat(sdk-react): add useEntitlement hook with allocation/usage/exceeded"
```

---

## Task 13: Export `useEntitlement` from sdk-react

**Files:**
- Modify: `packages/sdk-react/src/index.ts`

- [ ] **Step 1: Add export**

Open `packages/sdk-react/src/index.ts`. Find the existing hook exports and add:

```typescript
export { useEntitlement } from './hooks/useEntitlement';
export type { UseEntitlementReturn, UseEntitlementOptions } from './hooks/useEntitlement';
```

Also export the new session context helpers:

```typescript
export { useArcenSession } from './providers/MEAPProvider';
export type { ArcenSessionContextValue } from './providers/MEAPProvider';
```

- [ ] **Step 2: Build to verify**

```bash
cd packages/sdk-react
npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk-react/src/index.ts
git commit -m "feat(sdk-react): export useEntitlement and useArcenSession"
```

---

## Verification

### End-to-End Test: Plan → Flag Rule → SDK Check

```ts
// 1. Create a plan via dashboard with a NUMERIC entitlement
// POST /api/catalog/plans → creates plan with id='plan_123'
// POST /api/catalog/plans/plan_123/entitlements:
//   { featureKey: 'api_calls', type: 'NUMERIC', value: 1000, enabled: true }

// 2. Verify flag rule was created in DB
// SELECT * FROM FlagRule WHERE source='plan' AND sourceId='plan_123'
// → should return 1 row with value=true
// SELECT * FROM FlagRuleCondition WHERE ruleId=<above>
// → should return 1 row with criteriaType='base_plan', values='["plan_123"]'

// 3. Assign plan to company
// PATCH /api/v1/companies/co_test → activePlanId='plan_123'

// 4. Identify via Node SDK
const arcen = new ArcenClient({ apiKey: 'api_test', baseUrl: 'http://localhost:3000' });
const session = await arcen.identify({ company: { id: 'co_test' } });
console.assert(session.token, 'token must be returned');

// 5. Check flag — should be enabled
const flag = await arcen.checkFlag('api_calls');
console.assert(flag.enabled === true, 'api_calls should be enabled for plan company');

// 6. Check entitlement — should have allocation=1000, usage=0, exceeded=false
const ent = await arcen.checkEntitlement('api_calls');
console.assert(ent.allocation === 1000);
console.assert(ent.usage === 0);
console.assert(ent.exceeded === false);

// 7. Track 1001 events
for (let i = 0; i < 1001; i++) await arcen.track('api_calls');

// Wait for cache to expire (30s) then re-check
const ent2 = await arcen.checkEntitlement('api_calls');
console.assert(ent2.exceeded === true);
```

### Subscription Sync Test

```bash
# Simulate facilitator calling the sync endpoint
curl -X PATCH http://localhost:3000/api/internal/companies/sync-subscription \
  -H "Authorization: Bearer $FACILITATOR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"0xabc...","onChainPlanId":"42","event":"minted"}'
# Expected: { ok: true, activePlanId: 'plan_...' }

# Verify company.activePlanId was updated
curl http://localhost:3000/api/v1/companies/co_test \
  -H "Authorization: Bearer $API_KEY"
# Expected: company.activePlanId is set
```

### React SDK Test

```tsx
// In a Next.js page:
export async function getServerSideProps() {
  const arcen = new ArcenClient({ apiKey: process.env.ARCEN_API_KEY! });
  const session = await arcen.identify({ company: { id: 'co_test' } });
  return { props: { token: session.token } };
}

function Page({ token }: { token: string }) {
  return (
    <ArcenPayProvider token={token}>
      <FeatureCheck />
    </ArcenPayProvider>
  );
}

function FeatureCheck() {
  const { enabled } = useFlag('api_calls');           // no keys needed
  const { enabled: e2, allocation, usage, exceeded } = useEntitlement('api_calls');
  return <pre>{JSON.stringify({ enabled, e2, allocation, usage, exceeded }, null, 2)}</pre>;
}
// Expected: enabled=true, allocation=1000, usage=<n>, exceeded=false
```
