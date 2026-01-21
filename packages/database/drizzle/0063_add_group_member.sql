CREATE TABLE "ResourceAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"entityInstanceId" text,
	"granteeType" text NOT NULL,
	"granteeId" text NOT NULL,
	"permission" text NOT NULL,
	"grantedById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ResourceAccess" ADD CONSTRAINT "ResourceAccess_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ResourceAccess" ADD CONSTRAINT "ResourceAccess_grantedById_User_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ResourceAccess_entity_grantee_key" ON "ResourceAccess" USING btree ("organizationId","entityDefinitionId","entityInstanceId","granteeType","granteeId");--> statement-breakpoint
CREATE INDEX "ResourceAccess_entityDef_idx" ON "ResourceAccess" USING btree ("entityDefinitionId");--> statement-breakpoint
CREATE INDEX "ResourceAccess_instance_idx" ON "ResourceAccess" USING btree ("entityDefinitionId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "ResourceAccess_grantee_idx" ON "ResourceAccess" USING btree ("granteeType","granteeId");--> statement-breakpoint
CREATE INDEX "ResourceAccess_org_idx" ON "ResourceAccess" USING btree ("organizationId");