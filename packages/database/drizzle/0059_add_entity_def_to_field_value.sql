-- Step 1: Fix updatedAt default
ALTER TABLE "FieldValue" ALTER COLUMN "updatedAt" SET DEFAULT now();--> statement-breakpoint

-- Step 2: Add entityDefinitionId column as nullable first
ALTER TABLE "FieldValue" ADD COLUMN "entityDefinitionId" text;--> statement-breakpoint

-- Step 3: Backfill from CustomField.entityDefinitionId (for custom entities)
UPDATE "FieldValue" fv
SET "entityDefinitionId" = cf."entityDefinitionId"
FROM "CustomField" cf
WHERE fv."fieldId" = cf."id"
  AND cf."entityDefinitionId" IS NOT NULL
  AND fv."entityDefinitionId" IS NULL;--> statement-breakpoint

-- Step 4: Backfill from CustomField.modelType (for system types)
UPDATE "FieldValue" fv
SET "entityDefinitionId" = cf."modelType"
FROM "CustomField" cf
WHERE fv."fieldId" = cf."id"
  AND cf."modelType" IS NOT NULL
  AND cf."entityDefinitionId" IS NULL
  AND fv."entityDefinitionId" IS NULL;--> statement-breakpoint

-- Step 5: Make column NOT NULL after backfill
ALTER TABLE "FieldValue" ALTER COLUMN "entityDefinitionId" SET NOT NULL;--> statement-breakpoint

-- Step 6: Create indexes
CREATE INDEX "FieldValue_entityDefinitionId_idx" ON "FieldValue" USING btree ("entityDefinitionId");--> statement-breakpoint
CREATE INDEX "FieldValue_entityDefinitionId_entityId_idx" ON "FieldValue" USING btree ("entityDefinitionId","entityId");