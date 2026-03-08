-- Add public-facing provider profile fields to ProviderProfile
-- These replace localStorage-persisted settings with server-backed storage.

ALTER TABLE "ProviderProfile"
  ADD COLUMN "providerName"          TEXT,
  ADD COLUMN "website"               TEXT,
  ADD COLUMN "contactEmail"          TEXT;
