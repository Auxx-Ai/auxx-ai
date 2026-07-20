ALTER TABLE "UserSetting" DROP CONSTRAINT "UserSetting_organizationSettingId_OrganizationSetting_id_fk";
--> statement-breakpoint
DROP INDEX "UserSetting_organizationSettingId_idx";--> statement-breakpoint
DROP INDEX "UserSetting_userId_organizationSettingId_key";--> statement-breakpoint
-- Inline backfill: data migration 035 (runtime) normally fills these columns between
-- 0272 and 0273, but a deploy that applies both files in one batch never runs it.
-- Backfill from the parent OrganizationSetting via the legacy FK column (still
-- present until the end of this file), then drop rows that cannot be rekeyed —
-- they are unrepresentable in the new model.
UPDATE "UserSetting" us
SET "organizationId" = os."organizationId",
    "key" = os."key"
FROM "OrganizationSetting" os
WHERE us."organizationSettingId" = os."id"
  AND (us."organizationId" IS NULL OR us."key" IS NULL);--> statement-breakpoint
DELETE FROM "UserSetting" WHERE "organizationId" IS NULL OR "key" IS NULL;--> statement-breakpoint
ALTER TABLE "UserSetting" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "UserSetting" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "UserSetting_userId_organizationId_key_key" ON "UserSetting" USING btree ("userId","organizationId","key");--> statement-breakpoint
ALTER TABLE "UserSetting" DROP COLUMN "organizationSettingId";