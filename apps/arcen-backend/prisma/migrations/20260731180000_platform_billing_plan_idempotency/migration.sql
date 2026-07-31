-- Retain the oldest first-party plan and archive duplicates before adding the
-- uniqueness guard. No financial records are deleted.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "teamId", "environmentId", "name"
           ORDER BY "createdAt", "id"
         ) AS row_number
  FROM "CatalogPlan"
  WHERE ("metadata"->>'isPlatformTierPlan') = 'true'
)
UPDATE "CatalogPlan" AS plan
SET "active" = false, "status" = 'ARCHIVED'
FROM ranked
WHERE plan."id" = ranked."id" AND ranked.row_number > 1;

-- Platform plans are provisioned by an idempotent enrollment operation.
-- Keep the uniqueness constraint scoped to first-party plans so existing
-- provider catalogs can continue to contain repeated display names.
CREATE UNIQUE INDEX "CatalogPlan_first_party_team_environment_name_key"
ON "CatalogPlan" ("teamId", "environmentId", "name")
WHERE ("metadata"->>'isFirstPartyPlan') = 'true';
