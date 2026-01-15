ALTER TABLE "ImportMapping" DROP CONSTRAINT "ImportMapping_entityDefinitionId_EntityDefinition_id_fk";
--> statement-breakpoint
DROP INDEX "ImportMapping_targetTable_idx";--> statement-breakpoint
ALTER TABLE "ImportMapping" ALTER COLUMN "entityDefinitionId" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ImportMapping_entityDefinitionId_idx" ON "ImportMapping" USING btree ("entityDefinitionId");--> statement-breakpoint
ALTER TABLE "ImportMapping" DROP COLUMN "targetTable";