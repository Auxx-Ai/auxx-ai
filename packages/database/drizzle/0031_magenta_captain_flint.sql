-- Migration: Unified Model Types
-- Converts modelType from DataModelType enum (uppercase) to text (lowercase)

ALTER TABLE "CustomFieldGroup" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "CustomFieldGroup" CASCADE;--> statement-breakpoint

-- Step 1: Convert modelType column to text and convert values to lowercase
ALTER TABLE "CustomField" ALTER COLUMN "modelType" SET DATA TYPE text USING LOWER("modelType"::text);--> statement-breakpoint

-- Step 2: Convert 'conversation' to 'thread' (renaming)
UPDATE "CustomField" SET "modelType" = 'thread' WHERE "modelType" = 'conversation';--> statement-breakpoint

-- Step 3: Set the new default
ALTER TABLE "CustomField" ALTER COLUMN "modelType" SET DEFAULT 'contact';--> statement-breakpoint

-- Step 4: Drop the old enum type
DROP TYPE "public"."DataModelType";