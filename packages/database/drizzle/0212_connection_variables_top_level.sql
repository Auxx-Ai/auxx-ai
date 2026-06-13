ALTER TABLE "ConnectionDefinition" ADD COLUMN "connectionVariables" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE "ConnectionDefinition"
SET "connectionVariables" = COALESCE("oauth2Features"->'connectionVariables', '[]'::jsonb),
    "oauth2Features" = "oauth2Features" - 'connectionVariables'
WHERE "oauth2Features" ? 'connectionVariables';
