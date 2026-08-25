// packages/lib/src/import/resolution/get-relation-create-counts.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import type { RelationCreateRequest, ResolvedValue } from '../types/resolution'
import { relationCreateKey } from './relation-create-key'

/** One column's pending relation creates */
export interface RelationCreateColumnCount {
  /** `ImportJobProperty.id`, the column's per-job identity */
  jobPropertyId: string
  /** `ImportMappingProperty.sourceColumnIndex` */
  sourceColumnIndex: number
  /** CSV header, when the mapping recorded one */
  sourceColumnName: string | null
  /** The relation target */
  entityDefinitionId: string
  /** The field the value will be minted onto (the target's display field) */
  matchField: string
  /** Distinct values that will become records, in first-seen order */
  values: string[]
}

/** Preview-facing summary of everything `onNoMatch: 'create'` will mint */
export interface RelationCreateCounts {
  /** Distinct records that will be created across the whole job */
  total: number
  /** Distinct records per relation target, keyed by entity definition */
  byEntityDefinition: Record<string, number>
  /** Per mapped column, for a row-level "8 companies will be created" note */
  byColumn: RelationCreateColumnCount[]
}

/** A resolution row carrying a pending relation create */
export interface PendingCreateRow {
  /** `ImportValueResolution.id`, the row the minted id is written back to */
  resolutionId: string
  jobPropertyId: string
  sourceColumnIndex: number
  sourceColumnName: string | null
  request: RelationCreateRequest
}

/**
 * Read every `status: 'create'` resolution for a job and extract its relation
 * create request. Shared by the preview count and the materializer so the two
 * can never disagree about what "8 companies" means.
 */
async function loadPendingCreates(db: Database, jobId: string): Promise<PendingCreateRow[]> {
  const rows = await db
    .select({
      resolutionId: schema.ImportValueResolution.id,
      jobPropertyId: schema.ImportJobProperty.id,
      sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
      sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
      resolvedValues: schema.ImportValueResolution.resolvedValues,
    })
    .from(schema.ImportValueResolution)
    .innerJoin(
      schema.ImportJobProperty,
      eq(schema.ImportValueResolution.importJobPropertyId, schema.ImportJobProperty.id)
    )
    .innerJoin(
      schema.ImportMappingProperty,
      eq(schema.ImportJobProperty.importMappingPropertyId, schema.ImportMappingProperty.id)
    )
    .where(
      and(
        eq(schema.ImportJobProperty.importJobId, jobId),
        eq(schema.ImportValueResolution.status, 'create'),
        // An overridden row is the user's decided value — never materialize a
        // create for it. Mirrors `loadPendingSelectCreates`; today the erased
        // `relationCreate` marker already skips these, but that is incidental
        // to how the override rewrites `resolvedValues`, not a contract.
        isNull(schema.ImportValueResolution.userOverride)
      )
    )

  const pending: PendingCreateRow[] = []
  for (const row of rows) {
    const values = row.resolvedValues as ResolvedValue[] | null
    const request = Array.isArray(values) ? values[0]?.relationCreate : undefined
    // `select:create` also writes `status: 'create'`; it carries no
    // `relationCreate`, so it falls out here rather than being mistaken for a
    // record to mint.
    if (!request?.entityDefinitionId || !request.matchField || !request.value) continue
    pending.push({
      resolutionId: row.resolutionId,
      jobPropertyId: row.jobPropertyId,
      sourceColumnIndex: row.sourceColumnIndex,
      sourceColumnName: row.sourceColumnName,
      request,
    })
  }
  return pending
}

export { loadPendingCreates }

/**
 * Count the records `onNoMatch: 'create'` will mint, before anything is
 * written, the number the preview shows as *"8 companies will be created"*.
 *
 * Counts DISTINCT targets, deduped with {@link relationCreateKey}, which is
 * the same key the materializer mints on. Two columns naming the same supplier
 * count once, because they will produce one company.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Totals overall, per target definition, and per mapped column
 */
export async function getRelationCreateCounts(
  db: Database,
  jobId: string
): Promise<RelationCreateCounts> {
  const pending = await loadPendingCreates(db, jobId)

  const seenGlobally = new Set<string>()
  const byEntityDefinition: Record<string, number> = {}
  const byColumn = new Map<string, RelationCreateColumnCount & { seen: Set<string> }>()

  for (const row of pending) {
    const key = relationCreateKey(row.request)

    let column = byColumn.get(row.jobPropertyId)
    if (!column) {
      column = {
        jobPropertyId: row.jobPropertyId,
        sourceColumnIndex: row.sourceColumnIndex,
        sourceColumnName: row.sourceColumnName,
        entityDefinitionId: row.request.entityDefinitionId,
        matchField: row.request.matchField,
        values: [],
        seen: new Set<string>(),
      }
      byColumn.set(row.jobPropertyId, column)
    }
    if (!column.seen.has(key)) {
      column.seen.add(key)
      column.values.push(row.request.value)
    }

    if (seenGlobally.has(key)) continue
    seenGlobally.add(key)
    byEntityDefinition[row.request.entityDefinitionId] =
      (byEntityDefinition[row.request.entityDefinitionId] ?? 0) + 1
  }

  return {
    total: seenGlobally.size,
    byEntityDefinition,
    byColumn: [...byColumn.values()]
      .map(({ seen: _seen, ...rest }) => rest)
      .sort((a, b) => a.sourceColumnIndex - b.sourceColumnIndex),
  }
}
