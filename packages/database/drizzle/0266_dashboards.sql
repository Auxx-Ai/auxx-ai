CREATE TABLE "DashboardVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"dashboardId" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"label" text,
	"layout" jsonb NOT NULL,
	"configHash" text NOT NULL,
	"editorId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Dashboard" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" jsonb,
	"activeVersionId" text,
	"createdById" text,
	"visibility" text DEFAULT 'org' NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"archivedAt" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "DashboardVersion" ADD CONSTRAINT "DashboardVersion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DashboardVersion" ADD CONSTRAINT "DashboardVersion_dashboardId_Dashboard_id_fk" FOREIGN KEY ("dashboardId") REFERENCES "public"."Dashboard"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DashboardVersion" ADD CONSTRAINT "DashboardVersion_editorId_User_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "DashboardVersion_dashboardId_idx" ON "DashboardVersion" USING btree ("dashboardId");--> statement-breakpoint
CREATE UNIQUE INDEX "DashboardVersion_dashboardId_versionNumber_key" ON "DashboardVersion" USING btree ("dashboardId","versionNumber");--> statement-breakpoint
CREATE INDEX "Dashboard_organizationId_idx" ON "Dashboard" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Dashboard_createdById_idx" ON "Dashboard" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Dashboard_archivedAt_idx" ON "Dashboard" USING btree ("archivedAt");