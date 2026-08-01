// packages/lib/src/data-migrations/migrations/070-backfill-article-search-text.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { articleSearchTextExpressionSql } from '../../kb/article-search-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-070')

/**
 * Articles scanned per statement.
 *
 * Twice migration 069's batch: an article reads exactly one revision body rather
 * than up to 50 message bodies, so the per-row work is a single TOAST fetch plus
 * four `regexp_replace` passes. Still bounded by WAL volume rather than
 * round-trips, because the column it writes is TOAST-sized.
 */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Populate `Article.searchText` for every existing article from the corpus
 * defined in `kb/article-search-text.ts`.
 *
 * **Why.** Migration `0322_article_search_text.sql` adds the column and its two
 * org-scoped composite GIN indexes, and `syncArticleDenormalizedFields` now
 * refreshes the corpus on every revision write — but only on write. Without this
 * one-time pass every article that predates the change stays `NULL`, so KB
 * free-text search would match titles only and silently lose body recall on the
 * entire existing knowledge base. That failure is invisible: the query still
 * succeeds, it just returns fewer rows — which is exactly the failure mode this
 * whole change exists to end.
 *
 * **Batched and resumable.** Keyset-paginated on `id` (the primary key, so the
 * scan is index-ordered and never re-reads a page), and guarded by
 * `IS DISTINCT FROM` — an article already carrying the correct corpus is skipped
 * rather than rewritten. A re-run after a partial failure walks the key space
 * again but only writes what is still stale, which is the shape the runner wants
 * (it restarts a failed migration from the top).
 *
 * **Raw SQL on purpose** (project convention for data migrations): the write path
 * that normally maintains this column is `syncArticleDenormalizedFields`, which
 * also rewrites `title`/`excerpt`/`emoji`/`color` from the revision tree and is
 * reached through mutations that publish realtime patches and clear Kopilot
 * snapshots. A bulk corpus rebuild has no business firing any of that.
 *
 * Self-sufficient: the corpus expression is inlined into the statement, so this
 * depends on no runtime step landing first — only on the `searchText` column from
 * migration `0322` existing.
 */
export const migration070BackfillArticleSearchText: DataMigrationDef = {
  id: '070-backfill-article-search-text',
  description: 'Backfill Article.searchText from the bounded title + body corpus',
  async run(db: Database): Promise<void> {
    const expression = sql.raw(articleSearchTextExpressionSql('a'))

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
          FROM "Article"
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        touched AS (
          UPDATE "Article" a
          SET "searchText" = ${expression}
          FROM batch
          WHERE a.id = batch.id
            AND a."searchText" IS DISTINCT FROM ${expression}
          RETURNING a.id
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
        logger.info('Backfilling Article.searchText', { scanned, updated, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Backfilled Article.searchText from the title + body corpus', {
      scanned,
      updated,
      batches,
    })
  },
}
