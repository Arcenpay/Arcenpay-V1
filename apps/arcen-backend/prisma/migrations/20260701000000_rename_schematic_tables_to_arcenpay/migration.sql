-- Rename legacy Schematic table names to ArcenPay table names.
-- Uses ALTER TABLE RENAME to preserve all data and foreign keys.

ALTER TABLE "SchematicCompany" RENAME TO "ArcenCompany";
ALTER TABLE "SchematicUser" RENAME TO "ArcenUser";
ALTER TABLE "SchematicEvent" RENAME TO "ArcenEvent";
ALTER TABLE "SchematicApiKey" RENAME TO "ArcenApiKey";
