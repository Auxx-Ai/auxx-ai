-- `db:generate` produced exactly one statement for this column:
--   ALTER TABLE "AgentVersion" ADD COLUMN "permissionPolicy" jsonb NOT NULL;
-- which cannot succeed while any AgentVersion row exists. The three statements
-- below are a DELIBERATE hand-edit that keeps the migration SELF-SUFFICIENT
-- (plan 19 §5.2: inline the backfill before the constraint; never make a NOT NULL
-- depend on a runtime DataMigration having already run).
--
-- The backfilled value is EXACT for existing rows, not a placeholder: every agent
-- composes all-top-rung today (plan 14 §0.3 — `composeAgentLevels` returns the
-- highest rung for any area with no explicit grant row, and enforcement is
-- dormant at that default). Preserving current behavior therefore IS the
-- all-`admin` policy. The stricter `chat_agent` seed applies only to newly
-- authored chat agents, never retroactively (plan 19 §5.2 step 4).
--
-- The literal below is written in the CURRENT shape of
-- `PublishedAgentPermissionPolicy` (packages/database/src/db/schema/agent-version.ts),
-- NOT the shape this file originally shipped with. Two later slices moved the
-- target after this hand-edit was written, and a migration that has not yet run
-- anywhere but dev must land already-correct rather than land wrong and wait for
-- a runtime DataMigration to repair it:
--   * #1351 / data migration 054 renamed the rung vocabulary
--     (`read → view`, `read_write → edit`, `full → admin`). `parsePublishedAgentPolicy`
--     DROPS a rung it no longer recognizes, so a blob written as `"full"` composes
--     the version to all-`none` for the whole window between `db:migrate` and the
--     worker draining its boot-enqueued data-migrations job.
--   * #1364 / data migration 055 retired `resourceDefault`. A resource type with
--     no rule of its own now falls through to its own L2 `areas` rung, so an empty
--     `resources` map under `areas.default = "admin"` is the same authority the
--     retired `"resourceDefault": "full"` carried.
-- Both migrations stay idempotent no-ops over this literal, so the ledger is
-- unaffected in environments where they have already run.
ALTER TABLE "AgentVersion" ADD COLUMN "permissionPolicy" jsonb;
--> statement-breakpoint
UPDATE "AgentVersion"
SET "permissionPolicy" = '{
  "sourceProfileId": null,
  "sourceProfileUpdatedAt": null,
  "publishedByUserId": null,
  "clamp": [],
  "areas": { "default": "admin", "overrides": {} },
  "definitions": { "default": "admin", "overrides": {} },
  "resources": {}
}'::jsonb
WHERE "permissionPolicy" IS NULL;
--> statement-breakpoint
ALTER TABLE "AgentVersion" ALTER COLUMN "permissionPolicy" SET NOT NULL;
