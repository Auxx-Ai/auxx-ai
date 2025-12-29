ALTER TABLE "AppEventLog" RENAME COLUMN "workspaceSlug" TO "organizationId";--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD COLUMN "appVersionId" text;--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD CONSTRAINT "AppEventLog_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD CONSTRAINT "AppEventLog_appVersionId_AppVersion_id_fk" FOREIGN KEY ("appVersionId") REFERENCES "public"."AppVersion"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppEventLog_organizationId_idx" ON "AppEventLog" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AppEventLog_appVersionId_idx" ON "AppEventLog" USING btree ("appVersionId");