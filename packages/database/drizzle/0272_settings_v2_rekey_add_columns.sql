ALTER TABLE "UserSetting" ADD COLUMN "organizationId" text;--> statement-breakpoint
ALTER TABLE "UserSetting" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "UserSetting_organizationId_idx" ON "UserSetting" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "UserSetting_key_idx" ON "UserSetting" USING btree ("key");--> statement-breakpoint
ALTER TABLE "OrganizationSetting" DROP COLUMN "allowUserOverride";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "settings";