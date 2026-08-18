// packages/lib/src/data-migrations/migrations/090-thread-events-extraction.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-090')

/**
 * The six thread lifecycle event types being extracted. Byte-identical to the
 * strings the emitters write — two of them are public webhook event names, so
 * the vocabulary is externally pinned and must not be touched here.
 */
const THREAD_EVENT_TYPES = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
] as const

/** `IN (…)` list — Drizzle's `= ANY(${array})` matches nothing, so join scalars. */
const typeList = sql.join(
  THREAD_EVENT_TYPES.map((t) => sql`${t}`),
  sql`, `
)

/**
 * Move the six thread lifecycle event types out of the generic `Event` log and
 * into the dedicated `ThreadEvent` table (Phase 3 of `plans/threads/thread-events.md`).
 *
 * - **`id` is reused** from the `Event` row on purpose: the chat panel's client
 *   dedupe keys on it (`use-thread-events.ts`), so a page open across the deploy
 *   would double-render under fresh ids.
 * - **`actorId`** is derived the way the client's `pickActorUserId` did it:
 *   `toUserId` (the new assignee) for `thread:assignee:changed`, `userId` for
 *   everything else, `NULL` when neither is present.
 * - **INNER JOIN on `Thread` deliberately drops orphans** — `deletePermanently`
 *   never cleaned up `Event` rows, and `ThreadEvent.threadId` is a real FK, so
 *   rows whose thread was hard-deleted cannot and should not move.
 * - The trailing DELETE removes all six types from `Event` (orphans included);
 *   after Phase 2 nothing reads them there.
 *
 * Self-sufficient (backfill inlined) and idempotent: `ON CONFLICT (id) DO
 * NOTHING` makes a re-run after a halfway failure repair instead of duplicate,
 * and the DELETE is a no-op once the rows are gone.
 */
export const migration090ThreadEventsExtraction: DataMigrationDef = {
  id: '090-thread-events-extraction',
  description: 'Move the six thread lifecycle event types from Event into ThreadEvent',
  async run(db: Database): Promise<void> {
    const inserted = await db.execute<{ moved: number }>(sql`
      WITH moved AS (
        INSERT INTO "ThreadEvent" (id, "organizationId", "threadId", type, "actorId", data, "createdAt")
        SELECT
          e.id,
          e."organizationId",
          t.id,
          e.type,
          CASE
            WHEN e.type = 'thread:assignee:changed' AND e.data->>'toUserId' IS NOT NULL
              THEN 'user:' || (e.data->>'toUserId')
            WHEN e.data->>'userId' IS NOT NULL
              THEN 'user:' || (e.data->>'userId')
            ELSE NULL
          END,
          e.data,
          e."createdAt"
        FROM "Event" e
        JOIN "Thread" t ON t.id = e.data->>'threadId'
        WHERE e.type IN (${typeList})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT count(*)::int AS moved FROM moved
    `)

    const deleted = await db.execute<{ deleted: number }>(sql`
      WITH deleted AS (
        DELETE FROM "Event"
        WHERE type IN (${typeList})
        RETURNING id
      )
      SELECT count(*)::int AS deleted FROM deleted
    `)

    logger.info('Extracted thread lifecycle events into ThreadEvent', {
      moved: Number(inserted.rows[0]?.moved ?? 0),
      deleted: Number(deleted.rows[0]?.deleted ?? 0),
    })
  },
}
