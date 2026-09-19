ALTER TYPE "public"."GlPostingType" ADD VALUE 'landed_cost_clear';--> statement-breakpoint
CREATE TABLE "EntityInstanceEditSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"capturedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"byUserId" text NOT NULL,
	CONSTRAINT "EntityInstanceEditSnapshot_org_instance_key" UNIQUE("organizationId","entityInstanceId")
);
--> statement-breakpoint
ALTER TABLE "MoneyApplication" DROP CONSTRAINT "MoneyApplication_shape_check";--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD COLUMN "discountMinor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "EntityInstanceEditSnapshot" ADD CONSTRAINT "EntityInstanceEditSnapshot_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EntityInstanceEditSnapshot" ADD CONSTRAINT "EntityInstanceEditSnapshot_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EntityInstanceEditSnapshot" ADD CONSTRAINT "EntityInstanceEditSnapshot_entityInstanceId_fk" FOREIGN KEY ("organizationId","entityInstanceId") REFERENCES "public"."EntityInstance"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "EntityInstanceEditSnapshot_org_def_idx" ON "EntityInstanceEditSnapshot" USING btree ("organizationId","entityDefinitionId");--> statement-breakpoint
ALTER TABLE "MoneyApplication" ADD CONSTRAINT "MoneyApplication_shape_check" CHECK ("MoneyApplication"."amountMinor" > 0 AND "MoneyApplication"."discountMinor" >= 0 AND num_nonnulls("MoneyApplication"."orderInstanceId", "MoneyApplication"."invoiceInstanceId", "MoneyApplication"."vendorBillInstanceId") = 1 AND (("MoneyApplication"."operation" = 'apply' AND "MoneyApplication"."reversesApplicationId" IS NULL) OR ("MoneyApplication"."operation" = 'unapply' AND "MoneyApplication"."reversesApplicationId" IS NOT NULL)));