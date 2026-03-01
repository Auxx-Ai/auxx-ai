-- Clean up existing data before schema changes
DELETE FROM "AppInstallation";
--> statement-breakpoint
CREATE TABLE "AppBundle" (
	"id" text PRIMARY KEY NOT NULL,
	"appId" text NOT NULL,
	"bundleType" text NOT NULL,
	"sha256" text NOT NULL,
	"sizeBytes" integer,
	"uploadedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AppDeployment" (
	"id" text PRIMARY KEY NOT NULL,
	"appId" text NOT NULL,
	"deploymentType" text NOT NULL,
	"clientBundleId" text NOT NULL,
	"serverBundleId" text NOT NULL,
	"settingsSchema" jsonb,
	"targetOrganizationId" text,
	"environmentVariables" jsonb,
	"version" text,
	"status" text DEFAULT 'active' NOT NULL,
	"reviewedAt" timestamp (3),
	"reviewedBy" text,
	"rejectionReason" text,
	"releaseNotes" text,
	"metadata" jsonb,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AppEventLog" DROP CONSTRAINT "AppEventLog_appVersionId_AppVersion_id_fk";
--> statement-breakpoint
ALTER TABLE "AppInstallation" DROP CONSTRAINT "AppInstallation_currentVersionId_AppVersion_id_fk";
--> statement-breakpoint
ALTER TABLE "AppSetting" DROP CONSTRAINT "AppSetting_appVersionId_AppVersion_id_fk";
--> statement-breakpoint
DROP INDEX "AppEventLog_appVersionId_idx";--> statement-breakpoint
DROP INDEX "AppSetting_appVersionId_idx";--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD COLUMN "appDeploymentId" text;--> statement-breakpoint
ALTER TABLE "AppInstallation" ADD COLUMN "currentDeploymentId" text;--> statement-breakpoint
ALTER TABLE "AppSetting" ADD COLUMN "appDeploymentId" text;--> statement-breakpoint
ALTER TABLE "AppVersionBundle" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "AppVersion" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "AppVersionBundle" CASCADE;--> statement-breakpoint
DROP TABLE "AppVersion" CASCADE;--> statement-breakpoint
ALTER TABLE "AppBundle" ADD CONSTRAINT "AppBundle_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppDeployment" ADD CONSTRAINT "AppDeployment_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppDeployment" ADD CONSTRAINT "AppDeployment_clientBundleId_AppBundle_id_fk" FOREIGN KEY ("clientBundleId") REFERENCES "public"."AppBundle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AppDeployment" ADD CONSTRAINT "AppDeployment_serverBundleId_AppBundle_id_fk" FOREIGN KEY ("serverBundleId") REFERENCES "public"."AppBundle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AppDeployment" ADD CONSTRAINT "AppDeployment_targetOrganizationId_Organization_id_fk" FOREIGN KEY ("targetOrganizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AppBundle_content_idx" ON "AppBundle" USING btree ("appId","bundleType","sha256");--> statement-breakpoint
CREATE INDEX "AppBundle_appId_idx" ON "AppBundle" USING btree ("appId");--> statement-breakpoint
CREATE INDEX "AppDeployment_appId_idx" ON "AppDeployment" USING btree ("appId");--> statement-breakpoint
CREATE INDEX "AppDeployment_type_idx" ON "AppDeployment" USING btree ("appId","deploymentType");--> statement-breakpoint
CREATE INDEX "AppDeployment_targetOrganizationId_idx" ON "AppDeployment" USING btree ("targetOrganizationId");--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD CONSTRAINT "AppEventLog_appDeploymentId_AppDeployment_id_fk" FOREIGN KEY ("appDeploymentId") REFERENCES "public"."AppDeployment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_currentDeploymentId_AppDeployment_id_fk" FOREIGN KEY ("currentDeploymentId") REFERENCES "public"."AppDeployment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_appDeploymentId_AppDeployment_id_fk" FOREIGN KEY ("appDeploymentId") REFERENCES "public"."AppDeployment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppEventLog_appDeploymentId_idx" ON "AppEventLog" USING btree ("appDeploymentId");--> statement-breakpoint
CREATE INDEX "AppSetting_appDeploymentId_idx" ON "AppSetting" USING btree ("appDeploymentId");--> statement-breakpoint
ALTER TABLE "AppEventLog" DROP COLUMN "appVersionId";--> statement-breakpoint
ALTER TABLE "AppInstallation" DROP COLUMN "currentVersionId";--> statement-breakpoint
ALTER TABLE "AppSetting" DROP COLUMN "appVersionId";
