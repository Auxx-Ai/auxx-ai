// packages/lib/src/data-migrations/migrations/105-prune-dangling-relation-values.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import { updateSearchTextForInstances } from '../../field-values/search-text'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-105')

/** Rebuild `searchText` in bounded batches — the helper inlines every id into one `IN` list. */
const SEARCH_TEXT_BATCH = 500

/**
 * Every table a `FieldValue.entityId` / `relatedEntityId` can legitimately
 * resolve against.
 *
 * 🛑 **Getting this list short is how this migration destroys live data.**
 * `relatedEntityDefinitionId` spans a dual keyspace and the column addresses
 * several backing tables, not one. A prune that joins only `EntityInstance`
 * deletes 1,256 perfectly healthy `Thread` / `Article` / `DispatchWorker`
 * references — measured, not hypothetical.
 *
 * The list is deliberately **generous**: an extra table can only leave a genuine
 * orphan behind (harmless, the next run catches it), while a missing one deletes
 * live rows. It is the set of non-junction, id-bearing record tables reachable
 * from `ModelTypeMeta[*].dbTable` (`packages/database/src/enums.ts`) that
 * actually exist in `packages/database/src/db/schema/`. Note that `Contact` and
 * `Ticket` appear in `ModelTypeMeta` but have **no** table — both are
 * `EntityInstance`-backed, which is why their dangling references are real.
 *
 * Hardcoded rather than derived, because a data migration must keep meaning what
 * it meant on the day it ran: deriving the set from a live registry would let a
 * later refactor silently change which rows a re-run deletes.
 */
const TARGET_TABLES = [
  'EntityInstance',
  'Thread',
  'Article',
  'DispatchWorker',
  'Invoice',
  'Message',
  'Tag',
  'Participant',
  'Dataset',
  'KnowledgeBase',
  'WorkOrderVisit',
  'EndUser',
  'User',
] as const

/**
 * `NOT EXISTS` over every table in {@link TARGET_TABLES} for one column.
 *
 * 🛑 **No `archivedAt` predicate, on purpose.** Archived is not deleted. Zero
 * dangling references point at an archived row today, and treating archived as
 * dead would prune references to records a user can still restore.
 *
 * Nothing here is caller-supplied, so `sql.raw` is safe.
 */
function unresolvableSql(column: string): string {
  return TARGET_TABLES.map(
    (table) => `NOT EXISTS (SELECT 1 FROM "${table}" t WHERE t.id = fv."${column}")`
  ).join('\n      AND ')
}

/**
 * The mirror half: a relation value on a LIVE record pointing at a record that
 * was hard-deleted.
 *
 * Restricted to `cf."type" = 'RELATIONSHIP'` so `ACTOR` rows — which also
 * populate `relatedEntityId`, with a different keyspace and a different set of
 * backing tables — are out of scope entirely.
 */
const danglingInboundPredicate = sql`
  fv."relatedEntityId" IS NOT NULL
  AND cf."type" = 'RELATIONSHIP'
  AND ${sql.raw(unresolvableSql('relatedEntityId'))}
`

/**
 * The other orphan class: a value whose OWNING record is gone. Produced by the
 * thread/article permanent-delete path, which never touched `FieldValue` at all
 * and so leaked both halves.
 *
 * No field-type restriction — a value with no owner is unreachable whatever its
 * type, and this population is mostly `thread_tags` / `article_tags` plus a set
 * of billing projections written onto invoices that had already been deleted.
 */
const orphanOutboundPredicate = sql`${sql.raw(unresolvableSql('entityId'))}`

/**
 * Type alias, not an interface: `db.execute<T>` constrains `T` to
 * `Record<string, unknown>`, and only a type literal picks up the implicit index
 * signature that satisfies it.
 */
type ReportRow = {
  organizationId: string
  fieldId: string
  fieldName: string
  fieldType: string
  relatedEntityDefinitionId: string | null
  danglingValues: number
  affectedRecords: number
  samples: string[]
}

type OutboundReportRow = {
  organizationId: string
  entityDefinitionId: string
  fieldType: string
  orphanedValues: number
  affectedEntities: number
}

/**
 * Delete `FieldValue` rows on both sides of relations whose other end no longer
 * exists.
 *
 * **Why they exist.** A relation is stored as TWO mirror rows, one on each end,
 * and `FieldValue.relatedEntityId` is a bare `text()` column with no foreign key
 * (`packages/database/src/db/schema/field-value.ts:93`) — same for `entityId`.
 * `deleteEntityInstance` removed only the dead record's own values, so the
 * mirror row stayed on the still-living record; the thread and article
 * permanent-delete paths removed neither. In the dev database that left 1,619
 * dangling inbound references (15.5% of all relation values, all of them hanging
 * off live records — one contact displayed 475 work orders that no longer exist
 * against 15 that do) plus 275 owner-less outbound rows.
 *
 * **Prune, not repoint.** Unlike a merge — where `merge-service.ts` repoints
 * `relatedEntityId` at the winner — the target here is hard-deleted and
 * unrecoverable. There is nothing to point at.
 *
 * 🛑 **Ordering.** This must run only AFTER the relation picker stops
 * re-committing dead ids on save. Run it first and ordinary editing puts the
 * rows straight back, silently, from users who never knew they touched them.
 *
 * **searchText.** `EntityInstance.searchText` folds in the related record's
 * `displayName` and is recomputed only on write, so every holder is currently
 * carrying a dead record's name in its search corpus. The affected ids come
 * straight off `DELETE … RETURNING`, so the rebuild costs no extra scan. Stale
 * `displayName` / `secondaryDisplayValue` projections are NOT repaired here —
 * that cascade needs the deleted record's entity type, which is exactly the
 * thing no longer available.
 *
 * Raw Drizzle on purpose (project convention for data migrations): the
 * field-value write path fires realtime, record rules and reconciliation side
 * effects that a garbage-collection pass has no business entering.
 *
 * Idempotent: a re-run after a partial failure finds nothing left to match.
 */
export const migration105PruneDanglingRelationValues: DataMigrationDef = {
  id: '105-prune-dangling-relation-values',
  description: 'Delete relation field values whose target record, or whose own record, is gone',
  async run(db: Database): Promise<void> {
    // Report first — once the rows are gone there is no way to reconstruct what
    // each field lost.
    const inboundReport = await db.execute<ReportRow>(sql`
      SELECT
        fv."organizationId",
        cf.id AS "fieldId",
        cf.name AS "fieldName",
        cf."type" AS "fieldType",
        fv."relatedEntityDefinitionId",
        count(*)::int AS "danglingValues",
        count(DISTINCT fv."entityId")::int AS "affectedRecords",
        (array_agg(DISTINCT fv."relatedEntityId"))[1:5] AS samples
      FROM "FieldValue" fv
      JOIN "CustomField" cf
        ON cf.id = fv."fieldId"
       AND cf."organizationId" = fv."organizationId"
      WHERE ${danglingInboundPredicate}
      GROUP BY fv."organizationId", cf.id, cf.name, cf."type", fv."relatedEntityDefinitionId"
      ORDER BY fv."organizationId", cf.id
    `)

    for (const row of inboundReport.rows) {
      logger.info('Dangling relation references found', {
        organizationId: row.organizationId,
        fieldId: row.fieldId,
        fieldName: row.fieldName,
        relatedEntityDefinitionId: row.relatedEntityDefinitionId,
        danglingValues: row.danglingValues,
        affectedRecords: row.affectedRecords,
        sampleTargetIds: row.samples,
      })
    }

    const outboundReport = await db.execute<OutboundReportRow>(sql`
      SELECT
        fv."organizationId",
        fv."entityDefinitionId",
        cf."type" AS "fieldType",
        count(*)::int AS "orphanedValues",
        count(DISTINCT fv."entityId")::int AS "affectedEntities"
      FROM "FieldValue" fv
      JOIN "CustomField" cf
        ON cf.id = fv."fieldId"
       AND cf."organizationId" = fv."organizationId"
      WHERE ${orphanOutboundPredicate}
      GROUP BY fv."organizationId", fv."entityDefinitionId", cf."type"
      ORDER BY fv."organizationId", fv."entityDefinitionId"
    `)

    for (const row of outboundReport.rows) {
      logger.info('Owner-less field values found', {
        organizationId: row.organizationId,
        entityDefinitionId: row.entityDefinitionId,
        fieldType: row.fieldType,
        orphanedValues: row.orphanedValues,
        affectedEntities: row.affectedEntities,
      })
    }

    // Inbound first: its `RETURNING` names the LIVE records whose search corpus
    // needs rebuilding. The outbound pass returns nothing worth rebuilding —
    // those records no longer exist.
    const inboundDeleted = await db.execute<{ organizationId: string; entityId: string }>(sql`
      DELETE FROM "FieldValue" fv
      USING "CustomField" cf
      WHERE cf.id = fv."fieldId"
        AND cf."organizationId" = fv."organizationId"
        AND ${danglingInboundPredicate}
      RETURNING fv."organizationId", fv."entityId"
    `)

    const outboundDeleted = await db.execute<{ id: string }>(sql`
      DELETE FROM "FieldValue" fv
      WHERE ${orphanOutboundPredicate}
      RETURNING fv.id
    `)

    // searchText is rebuilt per org because the helper is org-scoped. Ids that
    // belong to a non-`EntityInstance` holder (a Thread's `thread_tags`, say)
    // simply match no row.
    const byOrganization = new Map<string, Set<string>>()
    for (const row of inboundDeleted.rows) {
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

    logger.info('Pruned dangling relation values', {
      inboundDeleted: inboundDeleted.rows.length,
      outboundDeleted: outboundDeleted.rows.length,
      fieldsAffected: inboundReport.rows.length,
      organizationsAffected: byOrganization.size,
      instancesRebuilt,
    })
  },
}
