-- Performance indexes for hot billing / usage / entitlement query paths.
--
-- These paths either table-scan today or cannot use the existing indexes because
-- their leading column is not in the query predicate. All are pure additive
-- index creates — no data migration, no locking rewrite.

-- CreateIndex
-- Usage-count aggregation filters teamId + companyId + eventType + name + sentAt
-- without environmentId, so the environmentId-leading indexes cannot serve it.
CREATE INDEX "ArcenEvent_teamId_companyId_eventType_name_sentAt_idx" ON "ArcenEvent"("teamId", "companyId", "eventType", "name", "sentAt");

-- CreateIndex
-- Dunning and platform-tier sweeps filter on status and order/filter by
-- graceEndsAt across all teams (no teamId predicate).
CREATE INDEX "SubscriptionState_status_graceEndsAt_idx" ON "SubscriptionState"("status", "graceEndsAt");

-- CreateIndex
-- Billing-event list / dead-letter queries filter teamId + processed, ordered by
-- createdAt.
CREATE INDEX "BillingEvent_teamId_processed_createdAt_idx" ON "BillingEvent"("teamId", "processed", "createdAt");

-- CreateIndex
-- Feature-flag override resolution fans out by teamId + featureKey.
CREATE INDEX "CompanyOverride_teamId_featureKey_idx" ON "CompanyOverride"("teamId", "featureKey");

-- CreateIndex
-- Companies are looked up by their assigned plan (catalog config load,
-- plan-companies listing).
CREATE INDEX "ArcenCompany_activePlanId_idx" ON "ArcenCompany"("activePlanId");
