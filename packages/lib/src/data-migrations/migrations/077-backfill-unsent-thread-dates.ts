// packages/lib/src/data-migrations/migrations/077-backfill-unsent-thread-dates.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-077')

/** Threads scanned per statement. */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Repair `Thread.firstMessageAt` / `Thread.lastMessageAt` on threads whose only
 * messages were never delivered.
 *
 * **Why.** Both thread-metadata recomputes used to aggregate
 * `MIN/MAX("sentAt")` filtered on `sentAt IS NOT NULL`, and the reconciler nulls
 * `sentAt` when a provider rejects a send. An outbound-only thread whose send
 * failed therefore ended up with `lastMessageAt = NULL` while still carrying a
 * real `latestMessageId`. Two things went wrong downstream, and neither raised
 * an error:
 *
 * 1. The list projection substituted the current time for the NULL, so the row
 *    rendered its age as "0 seconds" on every fetch, forever.
 * 2. List ordering is `ORDER BY "lastMessageAt" DESC`, and Postgres sorts NULLs
 *    first under `DESC` — so every one of these threads pinned itself to the top
 *    of every newest-first list.
 *
 * The recomputes now coalesce to `createdAt`, but that only fixes threads that
 * get written again. This pass repairs the rows already sitting at NULL.
 *
 * **Scoped to the broken rows.** The `WHERE` matches only threads that have at
 * least one message and a NULL `lastMessageAt`, so a healthy thread is never
 * rewritten. `messageCount` is deliberately left alone: it still counts
 * delivered messages only, which is the existing semantic everywhere else.
 *
 * **Batched and resumable.** Keyset-paginated on `id`, and because the predicate
 * only ever matches rows that are still NULL, a re-run after a partial failure
 * is a no-op over the part that already succeeded.
 *
 * Self-sufficient: touches only columns that already exist, and depends on no
 * runtime step landing first.
 */
export const migration077BackfillUnsentThreadDates: DataMigrationDef = {
  id: '077-backfill-unsent-thread-dates',
  description: 'Backfill Thread first/lastMessageAt for threads whose sends never landed',
  async run(db: Database): Promise<void> {
    let cursor = ''
    let scanned = 0
    let updated = 0
    let batches = 0

    for (;;) {
      // `batch` is MATERIALIZED so the keyset page is computed once and shared
      // by the UPDATE and the accounting SELECT.
      const result = await db.execute<{
        lastId: string | null
        scanned: number
        updated: number
      }>(sql`
        WITH batch AS MATERIALIZED (
          SELECT id
          FROM "Thread"
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        touched AS (
          UPDATE "Thread" t
          SET
            "firstMessageAt" = m.first_at,
            "lastMessageAt" = m.last_at
          FROM batch
          JOIN LATERAL (
            SELECT
              MIN(COALESCE("sentAt", "createdAt")) AS first_at,
              MAX(COALESCE("sentAt", "createdAt")) AS last_at
            FROM "Message"
            WHERE "threadId" = batch.id
          ) m ON TRUE
          WHERE t.id = batch.id
            AND t."lastMessageAt" IS NULL
            AND m.last_at IS NOT NULL
          RETURNING t.id
        )
        SELECT
          (SELECT max(id) FROM batch) AS "lastId",
          (SELECT count(*) FROM batch)::int AS "scanned",
          (SELECT count(*) FROM touched)::int AS "updated"
      `)

      const row = result.rows[0]
      if (!row?.lastId || Number(row.scanned) === 0) break

      cursor = row.lastId
      scanned += Number(row.scanned)
      updated += Number(row.updated)
      batches += 1

      if (batches % LOG_EVERY === 0) {
        logger.info('Backfilling unsent thread dates', { scanned, updated, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Backfilled thread dates for sends that never landed', {
      scanned,
      updated,
      batches,
    })
  },
}
