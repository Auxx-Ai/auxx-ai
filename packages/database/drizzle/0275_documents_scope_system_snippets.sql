ALTER TYPE "public"."SettingScope" ADD VALUE 'DOCUMENTS';--> statement-breakpoint
ALTER TABLE "Snippet" ADD COLUMN "systemType" text;--> statement-breakpoint
CREATE INDEX "Snippet_systemType_idx" ON "Snippet" USING btree ("systemType");--> statement-breakpoint
CREATE UNIQUE INDEX "Snippet_systemType_organizationId_key" ON "Snippet" USING btree ("systemType","organizationId") WHERE "Snippet"."systemType" IS NOT NULL AND "Snippet"."isDeleted" = false;