ALTER TABLE "ConnectionDefinition" DROP CONSTRAINT "ConnectionDefinition_owner_check";--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD COLUMN "providerKey" text;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD COLUMN "authApply" jsonb;--> statement-breakpoint
ALTER TABLE "Credential" ADD COLUMN "connectionDefinitionId" text;--> statement-breakpoint
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_connectionDefinitionId_ConnectionDefinition_id_fk" FOREIGN KEY ("connectionDefinitionId") REFERENCES "public"."ConnectionDefinition"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ConnectionDefinition_providerKey_major_idx" ON "ConnectionDefinition" USING btree ("providerKey","major");--> statement-breakpoint
CREATE INDEX "Credential_connectionDefinitionId_idx" ON "Credential" USING btree ("connectionDefinitionId");--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_owner_check" CHECK ((("appId" IS NOT NULL)::int + ("mcpServerId" IS NOT NULL)::int + ("providerKey" IS NOT NULL)::int) = 1);