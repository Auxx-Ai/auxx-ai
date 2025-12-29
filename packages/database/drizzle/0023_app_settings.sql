CREATE TABLE "AppSetting" (
	"id" text PRIMARY KEY NOT NULL,
	"appInstallationId" text NOT NULL,
	"appVersionId" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_appVersionId_AppVersion_id_fk" FOREIGN KEY ("appVersionId") REFERENCES "public"."AppVersion"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AppSetting_appInstallationId_key_key" ON "AppSetting" USING btree ("appInstallationId","key");--> statement-breakpoint
CREATE INDEX "AppSetting_appInstallationId_idx" ON "AppSetting" USING btree ("appInstallationId");--> statement-breakpoint
CREATE INDEX "AppSetting_appVersionId_idx" ON "AppSetting" USING btree ("appVersionId");