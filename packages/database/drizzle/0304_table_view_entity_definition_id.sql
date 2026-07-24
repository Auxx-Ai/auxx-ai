ALTER TABLE "TableView" ADD COLUMN "entityDefinitionId" text;--> statement-breakpoint
ALTER TABLE "TableView" ADD CONSTRAINT "TableView_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
-- Backfill entityDefinitionId for existing rows from the free-form tableId.
-- Entity table/kanban views use `entity-<defId>`; panel/dialog views use bare
-- `<defId>`. Only rows whose resolved key matches a real EntityDefinition.id in
-- the same org are linked; non-entity surfaces (workflow-runs, recordings, …) and
-- static system types (thread, message, …, which have no EntityDefinition row)
-- stay NULL, so structural writes on them fall closed to org-admin at the router.
UPDATE "TableView" AS tv
SET "entityDefinitionId" = ed."id"
FROM "EntityDefinition" AS ed
WHERE ed."organizationId" = tv."organizationId"
  AND ed."id" = CASE
    WHEN tv."tableId" LIKE 'entity-%' THEN substring(tv."tableId" FROM 8)
    ELSE tv."tableId"
  END;