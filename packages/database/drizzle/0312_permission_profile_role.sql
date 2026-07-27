ALTER TABLE "PermissionProfile" ADD COLUMN "role" "OrganizationRole" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
-- Inline system-slug ranks (plan 21 §3.1): the DEFAULT backfills 'USER' everywhere;
-- only the two ranked system rows differ. Never via a runtime DataMigration.
UPDATE "PermissionProfile" SET "role" = 'OWNER' WHERE "slug" = 'owner' AND "isSystem" = true;--> statement-breakpoint
UPDATE "PermissionProfile" SET "role" = 'ADMIN' WHERE "slug" = 'admin' AND "isSystem" = true;