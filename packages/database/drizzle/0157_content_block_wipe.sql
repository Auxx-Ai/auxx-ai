-- Destructive wipe for the content-block message migration.
-- See plans/kopilot/refresh/content-block-migration.md §4.4 + §7.
--
-- The `AiAgentSession.messages` JSONB shape changes from "1 message per LLM
-- call" to "1 message per turn with parts[]". Pre-launch (no production
-- users), so we drop session content rather than translating it.
--
-- `AiMessageFeedback` rows reference per-call message IDs that no longer
-- exist after the wipe, so they're truncated too.
UPDATE "AiAgentSession" SET "messages" = '[]'::jsonb, "domainState" = '{}'::jsonb;
--> statement-breakpoint
TRUNCATE TABLE "AiMessageFeedback";
