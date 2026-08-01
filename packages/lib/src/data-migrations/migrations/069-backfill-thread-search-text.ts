// packages/lib/src/data-migrations/migrations/069-backfill-thread-search-text.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { threadSearchTextExpressionSql } from '../../mail-query/thread-search-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-069')

/**
 * Threads scanned per statement.
 *
 * Half of migration 068's batch: the per-row work here is heavier — up to 30
 * message bodies read, HTML-stripped and concatenated — and the column it writes
 * is TOAST-sized, so a batch is bounded by WAL volume rather than round-trips.
 */
const BATCH_SIZE = 250

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Populate `Thread.searchText` for every existing thread from the corpus defined
 * in `mail-query/thread-search-text.ts`.
 *
 * **Why.** Migration `0320_thread_search_text.sql` adds the column and its
 * org-scoped composite GIN index, and the two thread-metadata recomputes now
 * refresh the corpus on every message write — but only on write. Without this
 * one-time pass every thread that predates the change stays `NULL`, so mail
 * free-text search would match subjects only and silently lose body recall on
 * the entire existing mailbox. That failure is invisible: the query still
 * succeeds, it just returns fewer rows.
 *
 * **Batched and resumable.** Keyset-paginated on `id` (the primary key, so the
 * scan is index-ordered and never re-reads a page), and guarded by
 * `IS DISTINCT FROM` — a thread already carrying the correct corpus is skipped
 * rather than rewritten. A re-run after a partial failure walks the key space
 * again but only writes what is still stale, which is exactly the shape the
 * runner wants (it restarts a failed migration from the top).
 *
 * **Raw SQL on purpose** (project convention for data migrations): the ingest
 * path that normally maintains this column also publishes `thread:updated`
 * realtime patches, which a bulk corpus rebuild has no business firing.
 *
 * Self-sufficient: the corpus expression is inlined into the statement, so this
 * depends on no runtime step landing first — only on the `searchText` column and
 * the GIN indexes from migration `0320` existing.
 */
export const migration069BackfillThreadSearchText: DataMigrationDef = {
  id: '069-backfill-thread-search-text',
  description: 'Backfill Thread.searchText from the bounded message-body corpus',
  async run(db: Database): Promise<void> {
    const expression = sql.raw(threadSearchTextExpressionSql('t'))

    let cursor = ''
    let scanned = 0
    let updated = 0
    let batches = 0

    for (;;) {
      // `batch` is MATERIALIZED so the keyset page is computed once and shared
      // by the UPDATE and the accounting SELECT — an inlined CTE would evaluate
      // the LIMIT twice.
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
          SET "searchText" = ${expression}
          FROM batch
          WHERE t.id = batch.id
            AND t."searchText" IS DISTINCT FROM ${expression}
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
        logger.info('Backfilling Thread.searchText', { scanned, updated, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Backfilled Thread.searchText from the message-body corpus', {
      scanned,
      updated,
      batches,
    })
  },
}
