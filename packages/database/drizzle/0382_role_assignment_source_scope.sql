DROP INDEX "GlRoleAssignment_org_role_key";--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD COLUMN "sourceAccountId" text;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_sourceAccountId_fk" FOREIGN KEY ("organizationId","sourceAccountId") REFERENCES "public"."FinancialSourceAccount"("organizationId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_default_key" ON "GlRoleAssignment" USING btree ("organizationId","role") WHERE "GlRoleAssignment"."sourceAccountId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_source_key" ON "GlRoleAssignment" USING btree ("organizationId","role","sourceAccountId") WHERE "GlRoleAssignment"."sourceAccountId" IS NOT NULL;--> statement-breakpoint
-- The MANUAL bucket, one row per org (task 47 §3, §6.2).
--
-- 🛑 Minted INLINE rather than through a `DataMigration`, so the column and the
-- only row that can give `sourceAccountId IS NULL` a second meaning arrive in
-- the same transaction. An order with no connected source has to resolve
-- SOMEWHERE, and if it resolved through NULL then null would mean both "use the
-- org default" and "the manual bucket" - which is the discriminator column §3
-- rejects, arrived at by accident.
--
-- ✅ Satisfies `FinancialSourceAccount_identity_check` (both strings non-empty,
-- environment in ('live','test')) and cannot be duplicated: the existing
-- `FinancialSourceAccount_identity_key` already covers it, which is what makes
-- the bare `ON CONFLICT DO NOTHING` both correct and idempotent.
--
-- ✅ Invisible to every existing reader. Each one either filters
-- `providerKey = 'shopify'` or joins in from an evidence row, and this row has
-- no evidence pointing at it (47 §3.1).
INSERT INTO "FinancialSourceAccount"
  ("id", "organizationId", "providerKey", "externalAccountId", "environment")
SELECT gen_random_uuid()::text, o."id", 'auxx', 'manual', 'live'
FROM "Organization" o
ON CONFLICT DO NOTHING;
