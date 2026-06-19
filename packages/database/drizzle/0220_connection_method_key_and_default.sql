ALTER TABLE "ConnectionDefinition" DROP CONSTRAINT "ConnectionDefinition_owner_check";--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "isDefault" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ConnectionDefinition_app_key_major_idx" ON "ConnectionDefinition" USING btree ("appId","key","major") WHERE "appId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Credential_app_org_default_idx" ON "Credential" USING btree ("organizationId","appId") WHERE "isDefault" = true AND "userId" IS NULL AND "kind" = 'app';--> statement-breakpoint
-- Backfill: app rows must carry a method key before the owner check enforces it. Derive a
-- distinct key per scope so the (appId, key, major) unique index holds. Throwaway (pre-launch,
-- reseed supersedes); apps with both scopes get personal/workspace, single-scope gets one of them.
UPDATE "ConnectionDefinition" SET "key" = CASE WHEN "global" = true THEN 'workspace' ELSE 'personal' END WHERE "appId" IS NOT NULL AND "key" IS NULL;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_owner_check" CHECK ((("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int + ("providerKey" IS NOT NULL)::int) = 1
       AND ("appId" IS NULL OR "key" IS NOT NULL));