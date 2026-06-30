ALTER TABLE "DataConnectorMapping" DROP CONSTRAINT "DataConnectorMapping_entityDefinitionId_EntityDefinition_id_fk";
--> statement-breakpoint
ALTER TABLE "DataConnectorMapping" ADD CONSTRAINT "DataConnectorMapping_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;