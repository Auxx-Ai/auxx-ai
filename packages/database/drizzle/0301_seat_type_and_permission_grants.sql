CREATE TABLE "PermissionGrant" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"granteeType" text NOT NULL,
	"granteeId" text NOT NULL,
	"levels" jsonb NOT NULL,
	"grantedById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD COLUMN "seatType" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_grantedById_User_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "PermissionGrant_grantee_key" ON "PermissionGrant" USING btree ("organizationId","granteeType","granteeId");