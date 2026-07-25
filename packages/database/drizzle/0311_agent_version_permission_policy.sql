-- `db:generate` produced exactly one statement for this column:
--   ALTER TABLE "AgentVersion" ADD COLUMN "permissionPolicy" jsonb NOT NULL;
-- which cannot succeed while any AgentVersion row exists. The three statements
-- below are a DELIBERATE hand-edit that keeps the migration SELF-SUFFICIENT
-- (plan 19 §5.2: inline the backfill before the constraint; never make a NOT NULL
-- depend on a runtime DataMigration having already run).
--
-- The backfilled value is EXACT for existing rows, not a placeholder: every agent
-- composes all-`full` today (plan 14 §0.3 — `composeAgentLevels` returns
-- `Level.Full` for any area with no explicit grant row, and enforcement is
-- dormant at that default). Preserving current behavior therefore IS the all-full
-- policy. The stricter `chat_agent` seed applies only to newly authored chat
-- agents, never retroactively (plan 19 §5.2 step 4).
--
-- Mirrors `LEGACY_FULL_AGENT_PERMISSION_POLICY` in
-- packages/database/src/db/schema/agent-version.ts. Data migration 042 then
-- honors any per-agent AGENT-grantee `PermissionGrant` rows this flat default
-- would have overwritten, and recomputes `configHash` to include the snapshot.
ALTER TABLE "AgentVersion" ADD COLUMN "permissionPolicy" jsonb;
--> statement-breakpoint
UPDATE "AgentVersion"
SET "permissionPolicy" = '{
  "sourceProfileId": null,
  "sourceProfileUpdatedAt": null,
  "publishedByUserId": null,
  "clamp": [],
  "areas": { "default": "full", "overrides": {} },
  "definitions": { "default": "full", "overrides": {} },
  "resourceDefault": "full",
  "resources": {}
}'::jsonb
WHERE "permissionPolicy" IS NULL;
--> statement-breakpoint
ALTER TABLE "AgentVersion" ALTER COLUMN "permissionPolicy" SET NOT NULL;
