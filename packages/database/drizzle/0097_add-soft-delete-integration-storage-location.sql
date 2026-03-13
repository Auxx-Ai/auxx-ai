DROP INDEX "Integration_organizationId_email_key";--> statement-breakpoint
ALTER TABLE "Integration" ADD COLUMN "deletedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "StorageLocation" ADD COLUMN "organizationId" text;--> statement-breakpoint
ALTER TABLE "StorageLocation" ADD COLUMN "deletedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "StorageLocation_organizationId_idx" ON "StorageLocation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "StorageLocation_deletedAt_idx" ON "StorageLocation" USING btree ("deletedAt") WHERE "StorageLocation"."deletedAt" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Integration_organizationId_email_key" ON "Integration" USING btree ("organizationId","email") WHERE "Integration"."deletedAt" IS NULL;