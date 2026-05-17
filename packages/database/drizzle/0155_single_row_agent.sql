ALTER TABLE "Agent" ADD COLUMN "toolsets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Agent" ADD COLUMN "knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill `Agent.toolsets` from the (about-to-be-dropped) `AgentToolset` table.
UPDATE "Agent" a
SET "toolsets" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object(
      'slug', t."toolsetSlug",
      'appInstallationId', t."appInstallationId",
      'config', t."config",
      'enabled', t."enabled",
      'source', t."source"
    ))
    FROM "AgentToolset" t
    WHERE t."agentId" = a.id
  ),
  '[]'::jsonb
);--> statement-breakpoint
-- Backfill `Agent.knowledge` from the (about-to-be-dropped) `AgentResourceScope` table.
-- `entityInstanceId NULL` becomes a definition-level recordId (no colon).
UPDATE "Agent" a
SET "knowledge" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object(
      'recordId',
        CASE
          WHEN s."entityInstanceId" IS NULL THEN s."entityDefinitionId"
          ELSE s."entityDefinitionId" || ':' || s."entityInstanceId"
        END,
      'mode', s."mode",
      -- KnowledgeEntry.source is 'manual' | 'mention'; collapse any
      -- legacy auto_default → manual on backfill.
      'source', CASE WHEN s."source" = 'mention' THEN 'mention' ELSE 'manual' END
    ))
    FROM "AgentResourceScope" s
    WHERE s."agentId" = a.id
  ),
  '[]'::jsonb
);--> statement-breakpoint
DROP TABLE "AgentResourceScope" CASCADE;--> statement-breakpoint
DROP TABLE "AgentToolset" CASCADE;--> statement-breakpoint
ALTER TABLE "Agent" DROP COLUMN "pinnedRecords";--> statement-breakpoint
DROP TYPE "public"."AgentResourceScopeMode";--> statement-breakpoint
DROP TYPE "public"."AgentResourceScopeSource";--> statement-breakpoint
DROP TYPE "public"."AgentToolsetSource";
