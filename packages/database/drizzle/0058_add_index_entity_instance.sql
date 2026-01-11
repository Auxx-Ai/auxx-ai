ALTER TABLE "EntityInstance" ALTER COLUMN "archivedAt" SET DATA TYPE timestamp (3) with time zone;

-- Enable extensions for search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Composite GIN index for full-text search scoped by organization
CREATE INDEX "EntityInstance_org_searchText_gin_idx"
ON "EntityInstance"
USING gin ("organizationId", to_tsvector('english'::regconfig, COALESCE("searchText", '')));

-- Composite GIN index for trigram fuzzy matching scoped by organization
CREATE INDEX "EntityInstance_org_displayName_trgm_idx"
ON "EntityInstance"
USING gin ("organizationId", "displayName" gin_trgm_ops);