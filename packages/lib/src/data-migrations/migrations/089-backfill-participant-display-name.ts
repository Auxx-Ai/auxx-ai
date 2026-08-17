// packages/lib/src/data-migrations/migrations/089-backfill-participant-display-name.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-089')

/** Participants scanned per statement. */
const BATCH_SIZE = 500

/** Log a progress line every N batches so a long run is observable. */
const LOG_EVERY = 20

/**
 * `calculateDisplayName(name, identifier)` as SQL, against the `p` alias.
 *
 * 🔴 **Name first, identifier second — and that order is the whole correctness
 * story of this migration.** 316 of the 403 NULL rows on the dev database carry a
 * real human name in `Participant.name` (`Daniel Jackson`,
 * `daniel.jackson18@outlook.com`). A flat `SET "displayName" = identifier` would
 * write the address as the display name for those rows, which is worse than the
 * NULL it replaces: it contradicts the write path's own preference order, it makes
 * the fuzzy-name arm match an address instead of a name (the exact recall this
 * backfill exists to restore), and it would make the picker render the address as
 * the row's title.
 *
 * Mirrors `ingest/participants/display.ts` branch for branch, including the
 * truncation arm, so a row backfilled here is byte-identical to what ingest would
 * write for the same inputs today. That arm is reachable — one `CHAT_VISITOR` row
 * on the dev DB has a 36-character opaque identifier and no name — and a
 * divergence there is the kind that gets discovered years later as "why is this
 * one row shaped differently".
 *
 * ⚠️ A frozen copy, deliberately — it must stay pinned to the version of
 * `calculateDisplayName` that existed when this migration ran. A data migration
 * that tracks a live function is not idempotent; it means something different on
 * every deploy. Exported only so the tests can assert on the expression itself
 * rather than grepping a stringified closure.
 */
export const DISPLAY_NAME_SQL = `
  CASE
    WHEN btrim(coalesce(p."name", '')) <> '' THEN btrim(p."name")
    WHEN btrim(p."identifier") = '' THEN NULL
    WHEN btrim(p."identifier") LIKE '%@%' THEN btrim(p."identifier")
    WHEN btrim(p."identifier") ~ '^\\+?[0-9]+$' THEN btrim(p."identifier")
    WHEN length(btrim(p."identifier")) > 20
      THEN substr(btrim(p."identifier"), 1, 15) || '...'
    ELSE btrim(p."identifier")
  END`

/**
 * Fill `Participant.displayName` where it is NULL, using the same fallback chain
 * every write site already applies.
 *
 * **Why.** `displayName` is the column the ranked recipient search fuzzy-matches
 * names against (`participants/search/participant-search-sql.ts`, and the
 * `Participant_org_displayName_trgm_idx` GIN index from migration `0334`). A NULL
 * there is unreachable by that arm — `similarity(NULL, q)` is NULL, scored 0 by the
 * rank's `COALESCE`, and the `ILIKE` arm never matches — so the row is findable
 * only by its identifier. Counted 2026-08-17: **403 of 15 246 rows repo-wide**,
 * but concentrated — 29% of one live org and 100% of eleven small ones. The
 * `recipient-search.md` §0 claim that every create site computes this was an
 * inference, and it was wrong for rows written before `calculateDisplayName`
 * existed.
 *
 * 🔴 **NOT a NOT NULL constraint, deliberately.** `calculateDisplayName` still
 * returns `undefined` when both the name and the identifier are blank
 * (`ingest/participants/display.ts`), and `participant-service.ts` guards its own
 * update with `displayName !== undefined`. Ingest must never throw, so a NOT NULL
 * on this column would be a latent ingest failure dressed as a tightening. This is
 * a data backfill and nothing else.
 *
 * **Raw SQL on purpose** (project convention for data migrations, and load-bearing
 * here): the ingest path that maintains this column also emits `participant:updated`
 * realtime patches, which a bulk quality pass has no business firing. Going through
 * Drizzle would also be wrong for a second reason — `Participant.updatedAt` is
 * `notNull` with no default, and a bulk derivation is not a user edit.
 *
 * **Idempotent and resumable.** Keyset-paginated on `id` (the primary key, so the
 * scan is index-ordered), and the `WHERE` matches only rows still at NULL — a
 * re-run after a partial failure repairs the remainder and rewrites nothing. The
 * `IS NOT NULL` guard on the expression means the both-blank case is left at NULL
 * rather than written to `''`.
 *
 * Self-sufficient: touches one existing column on one table, depends on no runtime
 * step or seeded row landing first, and reads nothing from the org cache.
 */
export const migration089BackfillParticipantDisplayName: DataMigrationDef = {
  id: '089-backfill-participant-display-name',
  description: 'Backfill Participant.displayName from name, falling back to the identifier',
  async run(db: Database): Promise<void> {
    const expression = sql.raw(DISPLAY_NAME_SQL)

    let cursor = ''
    let scanned = 0
    let updated = 0
    let batches = 0

    for (;;) {
      // `batch` is MATERIALIZED so the keyset page is computed once and shared by
      // the UPDATE and the accounting SELECT — an inlined CTE would evaluate the
      // LIMIT twice.
      const result = await db.execute<{
        lastId: string | null
        scanned: number
        updated: number
      }>(sql`
        WITH batch AS MATERIALIZED (
          SELECT id
          FROM "Participant"
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        ),
        touched AS (
          UPDATE "Participant" p
          SET "displayName" = ${expression}
          FROM batch
          WHERE p.id = batch.id
            AND p."displayName" IS NULL
            AND (${expression}) IS NOT NULL
          RETURNING p.id
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
        logger.info('Backfilling Participant.displayName', { scanned, updated, cursor })
      }

      if (Number(row.scanned) < BATCH_SIZE) break
    }

    logger.info('Backfilled Participant.displayName', { scanned, updated, batches })
  },
}
