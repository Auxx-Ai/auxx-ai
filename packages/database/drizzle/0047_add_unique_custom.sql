-- Add isUnique column to CustomField table for unique value enforcement
ALTER TABLE "CustomField" ADD COLUMN "isUnique" boolean DEFAULT false NOT NULL;

-- Create partial functional index for unique value lookups on CustomFieldValue
-- This index extracts the scalar value from JSONB and includes fieldId for filtered lookups
-- Only indexes non-null scalar values (value->>'data')
CREATE INDEX "CustomFieldValue_unique_value_lookup"
ON "CustomFieldValue" ((value->>'data'), "fieldId")
WHERE value->>'data' IS NOT NULL;