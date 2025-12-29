CREATE TABLE "AppInstallation" (
	"id" text PRIMARY KEY NOT NULL,
	"appId" text NOT NULL,
	"organizationId" text NOT NULL,
	"installationType" text NOT NULL,
	"currentVersionId" text,
	"installedAt" timestamp (3) DEFAULT now() NOT NULL,
	"uninstalledAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AppVersionBundle" (
	"id" text PRIMARY KEY NOT NULL,
	"appVersionId" text NOT NULL,
	"versionType" text NOT NULL,
	"clientBundleS3Key" text,
	"serverBundleS3Key" text,
	"clientBundleUploadUrl" text,
	"serverBundleUploadUrl" text,
	"clientBundleUploaded" boolean DEFAULT false,
	"serverBundleUploaded" boolean DEFAULT false,
	"isComplete" boolean DEFAULT false,
	"completedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "versionType" text NOT NULL;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "targetOrganizationId" text;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "environmentVariables" jsonb;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "publicationStatus" text;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "isPublished" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "numInstallations" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "releasedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "cliVersion" text;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD COLUMN "updatedAt" timestamp (3) DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_currentVersionId_AppVersion_id_fk" FOREIGN KEY ("currentVersionId") REFERENCES "public"."AppVersion"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppVersionBundle" ADD CONSTRAINT "AppVersionBundle_appVersionId_AppVersion_id_fk" FOREIGN KEY ("appVersionId") REFERENCES "public"."AppVersion"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AppInstallation_unique_idx" ON "AppInstallation" USING btree ("appId","organizationId","installationType");--> statement-breakpoint
CREATE INDEX "AppInstallation_appId_idx" ON "AppInstallation" USING btree ("appId");--> statement-breakpoint
CREATE INDEX "AppInstallation_organizationId_idx" ON "AppInstallation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AppVersionBundle_appVersionId_idx" ON "AppVersionBundle" USING btree ("appVersionId");--> statement-breakpoint
CREATE INDEX "AppVersionBundle_versionType_idx" ON "AppVersionBundle" USING btree ("versionType");--> statement-breakpoint
ALTER TABLE "AppVersion" ADD CONSTRAINT "AppVersion_targetOrganizationId_Organization_id_fk" FOREIGN KEY ("targetOrganizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppVersion_versionType_idx" ON "AppVersion" USING btree ("versionType");