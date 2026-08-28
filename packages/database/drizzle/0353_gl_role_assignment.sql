CREATE TABLE "GlRoleAssignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"role" text NOT NULL,
	"glAccountId" text NOT NULL,
	"source" text NOT NULL,
	"confirmedAt" timestamp (3),
	"confirmedByUserId" text,
	"markedUnused" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "GlRoleAssignment" ADD CONSTRAINT "GlRoleAssignment_confirmedByUserId_User_id_fk" FOREIGN KEY ("confirmedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "GlRoleAssignment_org_role_key" ON "GlRoleAssignment" USING btree ("organizationId","role");--> statement-breakpoint
CREATE INDEX "GlRoleAssignment_org_account_idx" ON "GlRoleAssignment" USING btree ("organizationId","glAccountId");