CREATE TABLE "OrganizationAiQuota" (
	"organizationId" text PRIMARY KEY NOT NULL,
	"quotaType" text NOT NULL,
	"quotaLimit" integer NOT NULL,
	"quotaUsed" integer DEFAULT 0 NOT NULL,
	"quotaPeriodStart" timestamp (3) DEFAULT now() NOT NULL,
	"quotaPeriodEnd" timestamp (3) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "OrganizationAiQuota" ADD CONSTRAINT "OrganizationAiQuota_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;