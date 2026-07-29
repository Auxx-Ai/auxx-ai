-- Plan 36 §7.2/§7.4 — retire the snippet's private sharing vocabulary and the
-- dead SignatureIntegrationShare table.
--
-- SELF-SUFFICIENT BY DESIGN: the data statements below run BEFORE the column
-- they read is dropped, in the same one-transaction batch. Prod and self-hosted
-- installs jump many releases in a single `migrate`, so this file must never
-- assume a runtime DataMigration ran between two schema files. DataMigration
-- `056-signatures-snippets-instance-access` still runs afterwards — it writes
-- the signature-side rows, re-asserts the snippet owner rows (a no-op here) and
-- busts the Redis caches this file cannot reach.
--
-- Conversion (user decision 2026-07-28: snippet volume is tiny, so resetting
-- sharing is acceptable — legacy `GROUPS` rows are disposable and are simply
-- left in place):
--   every non-deleted snippet -> ResourceAccess(user:createdById, admin)
--   sharingType = 'ORGANIZATION' -> + ResourceAccess(role:org_member, view)
--
-- `snippet` is `baselineAtCreate: true`, so a snippet with no ResourceAccess row
-- is reachable by NOBODY but the org owner. The owner `admin` row is what stops
-- every pre-existing snippet from disappearing for its own author.

-- Owner rows RAISE rather than skip: `setSnippetSharing`'s legacy GROUPS path
-- could already hold this exact unique key at `view`/`edit` for the owner
-- themselves, and plan 36 §0.6 leaves no admin override to repair that with.
INSERT INTO "ResourceAccess" ("id", "organizationId", "entityDefinitionId", "entityInstanceId", "granteeType", "granteeId", "permission", "grantedById")
SELECT gen_random_uuid()::text, s."organizationId", 'snippet', s."id", 'user', s."createdById", 'admin', s."createdById"
FROM "Snippet" s
WHERE s."isDeleted" = false
ON CONFLICT ON CONSTRAINT "ResourceAccess_entity_grantee_key"
DO UPDATE SET "permission" = 'admin', "lens" = NULL, "updatedAt" = now();--> statement-breakpoint

-- The workspace-baseline row, in contrast, never stomps: anything already at
-- this key is at least `view`, so a write could only downgrade a real grant.
INSERT INTO "ResourceAccess" ("id", "organizationId", "entityDefinitionId", "entityInstanceId", "granteeType", "granteeId", "permission", "grantedById")
SELECT gen_random_uuid()::text, s."organizationId", 'snippet', s."id", 'role', 'org_member', 'view', s."createdById"
FROM "Snippet" s
WHERE s."isDeleted" = false AND s."sharingType" = 'ORGANIZATION'
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "SignatureIntegrationShare" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "SignatureIntegrationShare" CASCADE;--> statement-breakpoint
DROP INDEX "Snippet_sharingType_idx";--> statement-breakpoint
ALTER TABLE "Snippet" DROP COLUMN "sharingType";--> statement-breakpoint
DROP TYPE "public"."SnippetSharingType";
