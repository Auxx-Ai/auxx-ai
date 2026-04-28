-- Phase 1 — Foundation migration
-- - Thread multi-entity linking (M1): primary instance + definition columns,
--   backfill from legacy `ticketId`, drop the old column.
-- - ThreadEntityLink (M2): secondary thread→entity links.
-- - Task.firedAt (M3): deadline-scanner idempotence column.
-- - EntityInstance.lastActivityAt (M4): staleness driver, backfilled from
--   the latest message on any thread already linked to the entity.
-- - NotificationType += TASK_DEADLINE (consumed by the new scanner).

ALTER TYPE "public"."NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE';--> statement-breakpoint

CREATE TABLE "ThreadEntityLink" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"threadId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdById" text,
	"unlinkedAt" timestamp (3)
);
--> statement-breakpoint

ALTER TABLE "EntityInstance" ADD COLUMN "lastActivityAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN "firedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "primaryEntityInstanceId" text;--> statement-breakpoint
ALTER TABLE "Thread" ADD COLUMN "primaryEntityDefinitionId" text;--> statement-breakpoint

-- Backfill the new (instance, definition) pair from the legacy ticketId column.
-- Reads `entityDefinitionId` from EntityInstance — never trusted from anywhere else.
UPDATE "Thread" t
SET
  "primaryEntityInstanceId" = t."ticketId",
  "primaryEntityDefinitionId" = ei."entityDefinitionId"
FROM "EntityInstance" ei
WHERE t."ticketId" IS NOT NULL
  AND t."ticketId" = ei."id";
--> statement-breakpoint

-- Backfill EntityInstance.lastActivityAt from the most recent linked thread
-- message. After backfill, monotonic touchEntityActivity() takes over.
UPDATE "EntityInstance" e
SET "lastActivityAt" = sub."last_message_at"
FROM (
  SELECT "primaryEntityInstanceId" AS instance_id, MAX("lastMessageAt") AS last_message_at
  FROM "Thread"
  WHERE "primaryEntityInstanceId" IS NOT NULL
    AND "lastMessageAt" IS NOT NULL
  GROUP BY "primaryEntityInstanceId"
) sub
WHERE e."id" = sub.instance_id;
--> statement-breakpoint

-- Sanity check: refuse to proceed if any thread still has a non-null ticketId
-- without a corresponding primaryEntityInstanceId (orphan from EntityInstance
-- delete). Surfaces silently-bad data before the column drop.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM "Thread"
  WHERE "ticketId" IS NOT NULL AND "primaryEntityInstanceId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Phase 1 backfill aborted: % thread(s) reference a deleted EntityInstance via ticketId', orphan_count;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "Thread" DROP CONSTRAINT "Thread_ticketId_EntityInstance_id_fk";
--> statement-breakpoint
DROP INDEX "Thread_ticketId_idx";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "ticketId";--> statement-breakpoint

ALTER TABLE "ThreadEntityLink" ADD CONSTRAINT "ThreadEntityLink_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadEntityLink" ADD CONSTRAINT "ThreadEntityLink_threadId_Thread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadEntityLink" ADD CONSTRAINT "ThreadEntityLink_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadEntityLink" ADD CONSTRAINT "ThreadEntityLink_entityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("entityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ThreadEntityLink" ADD CONSTRAINT "ThreadEntityLink_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ThreadEntityLink_organizationId_idx" ON "ThreadEntityLink" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ThreadEntityLink_threadId_idx" ON "ThreadEntityLink" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "ThreadEntityLink_entityInstanceId_idx" ON "ThreadEntityLink" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE INDEX "ThreadEntityLink_entityDefinitionId_idx" ON "ThreadEntityLink" USING btree ("entityDefinitionId");--> statement-breakpoint
CREATE INDEX "ThreadEntityLink_unlinkedAt_idx" ON "ThreadEntityLink" USING btree ("unlinkedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadEntityLink_threadId_entityInstanceId_active_key" ON "ThreadEntityLink" USING btree ("threadId","entityInstanceId") WHERE "unlinkedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_primaryEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("primaryEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_primaryEntityDefinitionId_EntityDefinition_id_fk" FOREIGN KEY ("primaryEntityDefinitionId") REFERENCES "public"."EntityDefinition"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "EntityInstance_organizationId_entityDefinitionId_lastActivityAt_idx" ON "EntityInstance" USING btree ("organizationId","entityDefinitionId","lastActivityAt");--> statement-breakpoint
CREATE INDEX "Task_organizationId_firedAt_deadline_idx" ON "Task" USING btree ("organizationId","firedAt","deadline") WHERE "completedAt" IS NULL AND "archivedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "Thread_organizationId_primaryEntityInstanceId_idx" ON "Thread" USING btree ("organizationId","primaryEntityInstanceId");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_primaryEntityDefinitionId_lastMessageAt_idx" ON "Thread" USING btree ("organizationId","primaryEntityDefinitionId","lastMessageAt" DESC NULLS FIRST);
