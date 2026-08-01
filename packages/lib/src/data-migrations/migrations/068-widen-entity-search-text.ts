// packages/lib/src/data-migrations/migrations/068-widen-entity-search-text.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { searchTextExpressionSql } from '../../field-values/search-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-068')

/**
 * Rows scanned per statement. Keeps each UPDATE's lock footprint and WAL burst
 * small on a table that spans every org; the per-row work is an index lookup on
 * `FieldValue_entityId_idx` plus a small aggregate, so the batch is bounded by
 * round-trips rather than CPU.
 */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * Rebuild `EntityInstance.searchText` over every existing record, using the
 * widened corpus defined in `field-values/search-text.ts`.
 *
 * **Why.** The column was written as
 * `TRIM(CONCAT_WS(' ', "displayName", "secondaryDisplayValue"))`, so the ranked
 * Records search (tsvector + trigram over `searchText`, indexed by migration
 * `0058_add_index_entity_instance.sql`) could only ever match display fields.
 * The refresh hooks in `field-values/` now fold in allowlisted field values —
 * text, option labels, closed-shape jsonb, and related records' display names —
 * but those only fire on write. Existing rows need this one-time pass, or the
 * corpus stays display-only until every record happens to be edited.
 *
 * **Batched and resumable.** Keyset-paginated on `id` (the primary key, so the
 * scan is index-ordered and never re-reads a page), and every statement is
 * guarded by `IS DISTINCT FROM` — a row already carrying the correct value is
 * skipped rather than rewritten. That makes a re-run after a partial failure
 * cheap: it walks the whole key space again but only writes what is still
 * stale, so it converges instead of duplicating work. The runner re-runs a
 * failed migration from the top, which is exactly what this shape wants.
 *
 * **Raw SQL on purpose** (project convention for data migrations): the
 * field-value service path fires realtime publishes, display-field cascades and
 * inverse-relationship sync, none of which a search-corpus rebuild has any
 * business entering.
 *
 * Self-sufficient: the corpus expression is inlined into the statement, so this
 * depends on no runtime step landing first — only on the `searchText` column
 * (migration `0051_add_field_value.sql`) and the GIN indexes (`0058`) existing.
 */
export const migration068WidenEntitySearchText: DataMigrationDef = {
  id: '068-widen-entity-search-text',
  description: 'Rebuild EntityInstance.searchText from the widened field-value corpus',
  async run(db: Database): Promise<void> {
    const expression = sql.raw(searchTextExpressionSql('ei'))

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
          FROM "EntityInstance"
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        touched AS (
          UPDATE "EntityInstance" ei
          SET "searchText" = ${expression}
          FROM batch
          WHERE ei.id = batch.id
            AND ei."searchText" IS DISTINCT FROM ${expression}
          RETURNING ei.id
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
        logger.info('Rebuilding searchText', { scanned, updated, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Rebuilt EntityInstance.searchText from the widened corpus', {
      scanned,
      updated,
      batches,
    })
  },
}
