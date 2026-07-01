ALTER TYPE "public"."SettingScope" ADD VALUE 'INVENTORY_BRIDGE';--> statement-breakpoint
CREATE TABLE "InventoryBridgeLink" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"dataConnectorId" text NOT NULL,
	"variantInstanceId" text NOT NULL,
	"partInstanceId" text NOT NULL,
	"lastSeenQuantity" integer NOT NULL,
	"mode" text DEFAULT 'confirm' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "InventoryBridgeLink" ADD CONSTRAINT "InventoryBridgeLink_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryBridgeLink" ADD CONSTRAINT "InventoryBridgeLink_dataConnectorId_DataConnector_id_fk" FOREIGN KEY ("dataConnectorId") REFERENCES "public"."DataConnector"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryBridgeLink" ADD CONSTRAINT "InventoryBridgeLink_variantInstanceId_EntityInstance_id_fk" FOREIGN KEY ("variantInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryBridgeLink" ADD CONSTRAINT "InventoryBridgeLink_partInstanceId_EntityInstance_id_fk" FOREIGN KEY ("partInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "InventoryBridgeLink_variantInstanceId_key" ON "InventoryBridgeLink" USING btree ("variantInstanceId");--> statement-breakpoint
CREATE INDEX "InventoryBridgeLink_dataConnectorId_idx" ON "InventoryBridgeLink" USING btree ("dataConnectorId");--> statement-breakpoint
CREATE INDEX "InventoryBridgeLink_organizationId_idx" ON "InventoryBridgeLink" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "InventoryBridgeLink_partInstanceId_idx" ON "InventoryBridgeLink" USING btree ("partInstanceId");