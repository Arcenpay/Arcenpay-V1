import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from '../route';
import { NextRequest } from 'next/server';
import * as flagEngine from '@/lib/flag-engine';
import * as aggregator from '@/lib/event-aggregator';
import { db } from '@/lib/db';

vi.mock('@/lib/flag-engine');
vi.mock('@/lib/event-aggregator');
vi.mock('@/lib/db', () => ({
  db: {
    arcenApiKey: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    embedAccessToken: { findFirst: vi.fn() },
    catalogFeatureFlag: { findUnique: vi.fn() },
    catalogPlan: { findFirst: vi.fn() },
    arcenCompany: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    arcenEvent: { create: vi.fn() },
  },
}));

// Mock rate-limit so requireApiKey never rate-limits in tests
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ ok: true, remaining: 499, resetAt: Date.now() + 60_000 })),
  applyRateLimitHeaders: vi.fn(),
}));

const mockEvaluateFlag = vi.mocked(flagEngine.evaluateFlag);
const mockAggregate = vi.mocked(aggregator.aggregateUsage);
const mockResolveCompany = vi.mocked(flagEngine.resolveCompany);

describe('GET /api/v1/check', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when key is missing', async () => {
    // requireApiKey uses findUnique internally
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 'team_1', id: 'key_1' });
    const req = new NextRequest('http://localhost/api/v1/check', {
      headers: { Authorization: 'Bearer api_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns enabled=true for a BOOLEAN flag', async () => {
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 'team_1', id: 'key_1' });
    (db.catalogFeatureFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ featureType: 'boolean' });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockEvaluateFlag.mockResolvedValue({ flag: 'advanced_analytics', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });

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
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 'team_1', id: 'key_1' });
    (db.catalogFeatureFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ featureType: 'event_based', eventKey: 'api_calls' });
    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      metadata: { entitlements: [{ featureKey: 'api_calls', type: 'NUMERIC', value: 1000, enabled: true }] },
    });
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ activePlanId: 'plan_1' });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockEvaluateFlag.mockResolvedValue({ flag: 'api_calls', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });
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
    (db.arcenApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ teamId: 'team_1', id: 'key_1' });
    (db.catalogFeatureFlag.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ featureType: 'event_based', eventKey: 'api_calls' });
    (db.catalogPlan.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      metadata: { entitlements: [{ featureKey: 'api_calls', type: 'NUMERIC', value: 100, enabled: true }] },
    });
    (db.arcenCompany.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ activePlanId: 'plan_1' });
    mockResolveCompany.mockResolvedValue({ id: 'co_1', traits: {}, activePlanId: 'plan_1', activeAddOnIds: [] });
    mockEvaluateFlag.mockResolvedValue({ flag: 'api_calls', value: true, reason: 'rule:plan_pro', companyId: 'co_1' });
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
