-- Backfill before the index: a row carrying a provider entry id and no company
-- would sit OUTSIDE the new uniqueness guarantee, because NULLs are distinct in
-- a unique index. The inbound sync never stamped a tenant (it reads rather than
-- exports), so every `provider_sync` row written before this migration is such a
-- row. Sourced from the org's active book, which is the company that sync read.
-- Tables referenced here are created in 0378/0379, so the ordering holds.
UPDATE "GlPosting" p
SET "providerTenantId" = b."externalCompanyId"
FROM "ExternalBookConnection" c
JOIN "ExternalAccountingBook" b
  ON b."id" = c."bookId"
 AND b."organizationId" = c."organizationId"
WHERE p."providerEntryId" IS NOT NULL
  AND p."providerTenantId" IS NULL
  AND c."organizationId" = p."organizationId"
  AND c."state" = 'active';--> statement-breakpoint
DROP INDEX "GlPosting_org_provider_entry_key";--> statement-breakpoint
CREATE UNIQUE INDEX "GlPosting_org_provider_entry_key" ON "GlPosting" USING btree ("organizationId","providerId","providerTenantId","providerEntryId") WHERE "GlPosting"."providerEntryId" IS NOT NULL;