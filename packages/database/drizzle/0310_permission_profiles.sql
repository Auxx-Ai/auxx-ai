CREATE TABLE "PermissionProfile" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" jsonb,
	"seat" text DEFAULT 'full' NOT NULL,
	"appliesTo" text DEFAULT 'member' NOT NULL,
	"baseLevel" integer,
	"ceiling" jsonb,
	"agentPolicy" jsonb,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Agent" ADD COLUMN "permissionProfileId" text;--> statement-breakpoint
ALTER TABLE "OrganizationInvitation" ADD COLUMN "permissionProfileId" text;--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD COLUMN "permissionProfileId" text;--> statement-breakpoint
ALTER TABLE "PermissionProfile" ADD CONSTRAINT "PermissionProfile_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PermissionProfile_organizationId_slug_key" ON "PermissionProfile" USING btree ("organizationId","slug");--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_permissionProfileId_PermissionProfile_id_fk" FOREIGN KEY ("permissionProfileId") REFERENCES "public"."PermissionProfile"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_permissionProfileId_PermissionProfile_id_fk" FOREIGN KEY ("permissionProfileId") REFERENCES "public"."PermissionProfile"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_permissionProfileId_PermissionProfile_id_fk" FOREIGN KEY ("permissionProfileId") REFERENCES "public"."PermissionProfile"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Agent_organizationId_permissionProfileId_idx" ON "Agent" USING btree ("organizationId","permissionProfileId");--> statement-breakpoint
CREATE INDEX "OrganizationInvitation_organizationId_permissionProfileId_idx" ON "OrganizationInvitation" USING btree ("organizationId","permissionProfileId");--> statement-breakpoint
CREATE INDEX "OrganizationMember_organizationId_permissionProfileId_idx" ON "OrganizationMember" USING btree ("organizationId","permissionProfileId");