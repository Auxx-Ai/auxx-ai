ALTER TABLE "UserSetting" DROP CONSTRAINT "UserSetting_organizationSettingId_OrganizationSetting_id_fk";
--> statement-breakpoint
DROP INDEX "UserSetting_organizationSettingId_idx";--> statement-breakpoint
DROP INDEX "UserSetting_userId_organizationSettingId_key";--> statement-breakpoint
ALTER TABLE "UserSetting" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "UserSetting" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "UserSetting_userId_organizationId_key_key" ON "UserSetting" USING btree ("userId","organizationId","key");--> statement-breakpoint
ALTER TABLE "UserSetting" DROP COLUMN "organizationSettingId";