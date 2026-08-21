// packages/lib/src/data-migrations/migrations/098-prune-orphaned-option-values.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { updateSearchTextForInstances } from '../../field-values/search-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-098')

/** Rebuild `searchText` in bounded batches — the helper inlines every id into one `IN` list. */
const SEARCH_TEXT_BATCH = 500

/**
 * Only these three `CustomField.type`s store an option key in `FieldValue.optionId`.
 * Same list as `SEARCH_TEXT_OPTION_FIELD_TYPES` in `field-values/search-text.ts`.
 */
const OPTION_FIELD_TYPES = ['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS']

/**
 * The predicate for "this row points at an option that no longer exists, and the
 * key it holds was minted by `generateId()`".
 *
 * Two halves, both load-bearing:
 *
 * 1. **Both keyspaces.** An option row may carry an explicit `id` (app- and
 *    connector-provisioned sets do) or only a `value` (everything minted in the
 *    UI), and a `FieldValue` written before an option gained an `id` still holds
 *    the `value`. Matching one key alone would classify live values as orphans
 *    and delete them. This is character-for-character the rule
 *    `search-text.ts:213` uses; the two cannot share code, so they must agree by
 *    inspection.
 * 2. **id-shaped only.** `generateId()` is nanoid at length 21 over
 *    `[A-Za-z0-9_-]`, so this matches exactly what the pickers mint and nothing
 *    else. Label-shaped orphans (`Enterprise`) are NOT garbage: they are the live
 *    storage key for every option created through the field form, and the
 *    deliberate write-path fallback in `converters/select.ts` for imports,
 *    connectors and API writes. They must survive.
 *
 * `fv` and `cf` are joined on BOTH `organizationId` and `fieldId` so the partial
 * index `FieldValue_lookup_option_idx` on
 * `(organizationId, fieldId, optionId) WHERE optionId IS NOT NULL` is usable.
 */
const orphanPredicate = sql`
  cf."type" IN (${sql.join(
    OPTION_FIELD_TYPES.map((t) => sql`${t}`),
    sql`, `
  )})
  AND fv."optionId" IS NOT NULL
  AND fv."optionId" ~ '^[A-Za-z0-9_-]{21}$'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(cf."options"->'options') = 'array'
                THEN cf."options"->'options'
                ELSE '[]'::jsonb END) AS o
    WHERE o->>'value' = fv."optionId" OR o->>'id' = fv."optionId"
  )
`

/**
 * Type alias, not an interface: `db.execute<T>` constrains `T` to
 * `Record<string, unknown>`, and only a type literal picks up the implicit index
 * signature that satisfies it.
 */
type OrphanReportRow = {
  organizationId: string
  fieldId: string
  fieldName: string
  fieldType: string
  orphanedValues: number
  affectedRecords: number
  samples: string[]
}

/**
 * Delete `FieldValue` rows left behind by options that were deleted (or, before
 * Phase 0.5, silently rekeyed by a rename) from a SINGLE_SELECT / MULTI_SELECT /
 * TAGS field.
 *
 * **Why they exist.** `FieldValue.optionId` is a bare `text()` column with no
 * foreign key, and the option catalog is JSONB on `CustomField.options.options`.
 * Nothing linked them, so removing an option from the catalog left every carrying
 * record pointing at a key that resolves to nothing — rendered as a raw nanoid in
 * a badge, uncopyable, unfilterable. Phase 1 makes the deletion cascade; this pass
 * clears what the ungated years produced.
 *
 * **Why a shape heuristic, here and nowhere else.** Provenance is unrecoverable
 * for rows already written: an id-shaped orphan and a label-shaped one are the
 * same column. The 21-char nanoid regex is the tightest available proxy for
 * "minted by a picker, therefore meaningless without its option". A label that is
 * exactly 21 characters of `[A-Za-z0-9_-]` with no spaces would be swept up; that
 * is accepted, and the per-field counts are logged before anything is deleted so
 * the loss is inspectable after the fact.
 *
 * **searchText.** `search-text.ts` indexes the resolved option *label* and falls
 * back to the raw `optionId`, so every orphan is currently sitting in the search
 * corpus as a nanoid. The affected instance ids come straight off
 * `DELETE … RETURNING`, so the rebuild costs no extra scan.
 *
 * Raw Drizzle on purpose (project convention for data migrations): the field-value
 * write path fires realtime, record rules and reconciliation side effects that a
 * garbage-collection pass has no business entering.
 *
 * Idempotent: a re-run after a partial failure finds nothing left to match.
 */
export const migration098PruneOrphanedOptionValues: DataMigrationDef = {
  id: '098-prune-orphaned-option-values',
  description: 'Delete id-shaped select/tag field values whose option no longer exists',
  async run(db: Database): Promise<void> {
    // Report first — once the rows are gone there is no way to reconstruct what
    // each field lost.
    const report = await db.execute<OrphanReportRow>(sql`
      SELECT
        cf."organizationId",
        cf.id AS "fieldId",
        cf.name AS "fieldName",
        cf."type" AS "fieldType",
        count(*)::int AS "orphanedValues",
        count(DISTINCT fv."entityId")::int AS "affectedRecords",
        (array_agg(DISTINCT fv."optionId"))[1:5] AS samples
      FROM "FieldValue" fv
      JOIN "CustomField" cf
        ON cf.id = fv."fieldId"
       AND cf."organizationId" = fv."organizationId"
      WHERE ${orphanPredicate}
      GROUP BY cf."organizationId", cf.id, cf.name, cf."type"
      ORDER BY cf."organizationId", cf.id
    `)

    for (const row of report.rows) {
      logger.info('Orphaned option values found', {
        organizationId: row.organizationId,
        fieldId: row.fieldId,
        fieldName: row.fieldName,
        fieldType: row.fieldType,
        orphanedValues: row.orphanedValues,
        affectedRecords: row.affectedRecords,
        sampleOptionIds: row.samples,
      })
    }

    if (report.rows.length === 0) {
      logger.info('No orphaned option values to prune')
      return
    }

    const deleted = await db.execute<{ organizationId: string; entityId: string }>(sql`
      DELETE FROM "FieldValue" fv
      USING "CustomField" cf
      WHERE cf.id = fv."fieldId"
        AND cf."organizationId" = fv."organizationId"
        AND ${orphanPredicate}
      RETURNING fv."organizationId", fv."entityId"
    `)

    // searchText is rebuilt per org because the helper is org-scoped.
    const byOrganization = new Map<string, Set<string>>()
    for (const row of deleted.rows) {
      const ids = byOrganization.get(row.organizationId) ?? new Set<string>()
      ids.add(row.entityId)
      byOrganization.set(row.organizationId, ids)
    }

    let instancesRebuilt = 0
    for (const [organizationId, idSet] of byOrganization) {
      const entityInstanceIds = [...idSet]
      for (let i = 0; i < entityInstanceIds.length; i += SEARCH_TEXT_BATCH) {
        await updateSearchTextForInstances(
          db,
          organizationId,
          entityInstanceIds.slice(i, i + SEARCH_TEXT_BATCH)
        )
      }
      instancesRebuilt += entityInstanceIds.length
    }

    logger.info('Pruned orphaned option values', {
      valuesDeleted: deleted.rows.length,
      fieldsAffected: report.rows.length,
      organizationsAffected: byOrganization.size,
      instancesRebuilt,
    })
  },
}
