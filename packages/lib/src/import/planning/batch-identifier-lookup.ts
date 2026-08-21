// packages/lib/src/import/planning/batch-identifier-lookup.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { createTypedValueInput } from '@auxx/types/field-value'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { getCachedFieldMap } from '../../cache'
import { normalizeForLookup } from '../../field-values/normalize-for-lookup'
import { typedColumnMatch } from '../../field-values/typed-column-match'
import type { Resource, ResourceField } from '../../resources'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { hashValue } from '../hashing/hash-value'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'
import {
  type FindExistingRecord,
  type FindExistingRecordResult,
  hasSystemTable,
  stripRecordIdPrefix,
} from './find-existing-record'

const logger = createScopedLogger('batch-identifier-lookup')

/**
 * Values per `IN (...)` list. Postgres has no hard limit, but one bind per
 * value means a 5,000-row file would otherwise send 5,000 parameters in one
 * statement; chunking keeps each statement plannable.
 */
const CHUNK_SIZE = 1000

/**
 * `FieldValue` payload columns this pre-pass will index.
 *
 * Deliberately a SUBSET of {@link typedColumnMatch}'s eight columns. A column
 * is only safe to batch when the value Postgres hands back is
 * `String()`-identical to the value the per-row path binds — that round-trip IS
 * the index key, and a key that disagrees would report `none` for a value the
 * per-row query matches, i.e. a silent duplicate record.
 *
 *  - `valueDate` is excluded: the column is `mode: 'string'`, so Postgres
 *    returns its own timestamp rendering while `typedColumnMatch` binds
 *    `toISOString()`. The two never compare equal in memory even though `eq()`
 *    compares them fine in SQL.
 *  - `valueJson` is excluded: jsonb equality is not string equality.
 *  - `valueBoolean` is excluded: a boolean can never usefully identify a
 *    record, so batching it only adds a round-trip that answers "ambiguous".
 *
 * Anything excluded here simply falls through to the per-row query, which is
 * exactly today's behaviour.
 */
const BATCHABLE_COLUMNS = new Set([
  'valueText',
  'valueNumber',
  'optionId',
  'relatedEntityId',
  'actorId',
])

type BatchableColumn = 'valueText' | 'valueNumber' | 'optionId' | 'relatedEntityId' | 'actorId'

/** One identifier cell, prepared for the in-memory index. */
type PreparedValue =
  | { kind: 'indexed'; column: BatchableColumn; indexKey: string; bind: string | number }
  /** The per-row lookup would build no condition at all, which is a hard `none`. */
  | { kind: 'no-match' }
  /** Not safely batchable — this value keeps the per-row query. */
  | { kind: 'unbatchable' }

/** Options for {@link createBatchedFindExistingRecord}. */
export interface BatchIdentifierLookupOptions {
  db: Database
  organizationId: string
  resource: Resource
  /** Ordered identifier fields, exactly as `createFindExistingRecord` took them. */
  identifierFields: ResourceField[]
  /** Every row of the file — already fully in memory before analysis begins. */
  rawData: Map<number, Record<number, string>>
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  /**
   * The per-row resolver. Used verbatim for every case the pre-pass could not
   * index, so the batched resolver can only ever be FASTER than it, never
   * different.
   */
  fallback: FindExistingRecord
}

/** A {@link FindExistingRecord} plus what the pre-pass actually managed to do. */
export interface BatchedIdentifierLookup {
  /** Same contract as {@link FindExistingRecord}, answered from memory. */
  find: FindExistingRecord
  /** True when the pre-pass ran and populated an index. */
  batched: boolean
  /** DB round-trips the pre-pass spent (0 when it did not engage). */
  queryCount: number
  /** Distinct identifier values indexed. */
  indexedValues: number
}

/**
 * Resolve every row's identifier lookup up front, in a handful of queries, and
 * return a resolver with the SAME signature and the SAME result contract as
 * `createFindExistingRecord`.
 *
 * `generatePlan` holds the whole file in memory before it analyzes any row, and
 * `analyzeRow` awaits one `findExistingRecord` per identifier VALUE. A
 * 5,000-row single-identifier file therefore issued 5,000 fully serialized
 * queries. This walks the same cells once, collects the distinct values, and
 * resolves them with `ceil(distinct / 1000)` queries.
 *
 * Shape copied from `resolution/resolve-relation-lookups.ts`'s
 * `resolveLookupsForTable`: group, one `IN (...)` query per group, build a
 * `value -> Set<recordId>` map, and read ambiguity off `set.size` rather than
 * off a capped `limit(2)`.
 *
 * What it does NOT batch, each falling through to `fallback` unchanged:
 *  - COMPOSITE keys (two or more identifier fields). They are rare, and the
 *    AND-of-candidates intersection is done in SQL by the lookup core; there is
 *    no in-memory index shape that preserves it without re-implementing the
 *    intersection.
 *  - SYSTEM-table resources (`Thread`, `User`, `Participant`, …). They take a
 *    different lane in `find-existing-record.ts` and, per that file's note, no
 *    registry-shipped system resource currently reaches it at all.
 *  - Any single value whose typed column is outside {@link BATCHABLE_COLUMNS},
 *    or that the pre-pass never saw (a resolver drift safety net).
 *
 * Failure of the pre-pass is never fatal and never fails OPEN: any error is
 * logged and the caller gets `fallback`, which is exactly today's behaviour.
 *
 * @param options - The file, its mappings/resolutions, and the per-row resolver
 * @returns The resolver to hand `analyzeRow`, plus pre-pass telemetry
 */
export async function createBatchedFindExistingRecord(
  options: BatchIdentifierLookupOptions
): Promise<BatchedIdentifierLookup> {
  const {
    db,
    organizationId,
    resource,
    identifierFields,
    rawData,
    mappings,
    resolutions,
    fallback,
  } = options

  const notBatched: BatchedIdentifierLookup = {
    find: fallback,
    batched: false,
    queryCount: 0,
    indexedValues: 0,
  }

  // Composite key: one tuple, one lookup, and the intersection lives in SQL.
  if (identifierFields.length !== 1) return notBatched

  const field = identifierFields[0]!
  const identifierKey = getFieldOutputKey(field)

  try {
    // System tables keep their own lane.
    if (hasSystemTable(resource.id)) return notBatched
    if (resource.type !== 'custom' || !resource.entityDefinitionId) return notBatched
    const entityDefinitionId = resource.entityDefinitionId

    const rawValues = collectIdentifierValues(identifierKey, rawData, mappings, resolutions)
    if (rawValues.size === 0) return notBatched

    const index =
      field.dbColumn === 'id'
        ? await indexByInstanceId(db, organizationId, entityDefinitionId, rawValues)
        : await indexByFieldValue(db, organizationId, entityDefinitionId, field, rawValues)

    if (!index) return notBatched

    logger.info('Identifier lookups pre-resolved', {
      entityDefinitionId,
      identifierKey,
      rows: rawData.size,
      distinctValues: rawValues.size,
      indexedValues: index.keyByRawValue.size,
      queries: index.queryCount,
    })

    return {
      find: buildResolver(identifierKey, index, fallback),
      batched: true,
      queryCount: index.queryCount,
      indexedValues: index.keyByRawValue.size,
    }
  } catch (error) {
    // Degrade to the per-row path rather than failing the plan. The per-row
    // path re-issues the query and, if it fails too, `analyzeRow` turns that
    // into a row error — which is what must happen. Silently answering `none`
    // here would create a duplicate for every row instead.
    logger.warn('Identifier pre-pass failed, falling back to per-row lookups', {
      resourceId: resource.id,
      identifierKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return notBatched
  }
}

/**
 * The in-memory answer set.
 *
 * `keyByRawValue` is the membership test, and the three states matter:
 *  - absent          — the pre-pass never saw this value, use the per-row query
 *  - `null`          — prepared, and no condition could be built, a hard `none`
 *  - an index key    — look it up in `matchesByKey`
 *
 * `matchesByKey` holds an EMPTY set for a prepared key that matched nothing, so
 * "indexed, zero rows" is distinguishable from "never indexed".
 */
interface IdentifierIndex {
  keyByRawValue: Map<string, string | null>
  matchesByKey: Map<string, Set<string>>
  queryCount: number
}

/**
 * Turn the index into a {@link FindExistingRecord}.
 *
 * Ambiguity is `set.size > 1` and the count is the REAL count: nothing here is
 * capped at `limit(2)`, so a value shared by five records reports five.
 */
function buildResolver(
  identifierKey: string,
  index: IdentifierIndex,
  fallback: FindExistingRecord
): FindExistingRecord {
  return async (values): Promise<FindExistingRecordResult> => {
    // `.trim()` mirrors `createFindExistingRecord`, which trims before it does
    // anything else; the index is keyed on trimmed values for the same reason.
    const raw = values[identifierKey]?.trim()
    if (!raw) return { kind: 'none' }

    const indexKey = index.keyByRawValue.get(raw)
    // Never seen. The pre-pass reads the cells itself, so a value `analyzeRow`
    // derives differently would land here — answer it with a real query rather
    // than with a wrong `none`.
    if (indexKey === undefined) return fallback(values)
    if (indexKey === null) return { kind: 'none' }

    const matched = index.matchesByKey.get(indexKey)
    if (!matched || matched.size === 0) return { kind: 'none' }
    if (matched.size > 1) return { kind: 'ambiguous', count: matched.size }
    return { kind: 'one', recordId: [...matched][0]! }
  }
}

/**
 * Every distinct identifier value the file carries, derived the same way
 * `analyzeRow` derives its lookup values: a split resolution contributes each
 * of its elements (match-ANY), anything else contributes the trimmed raw cell.
 *
 * This mirrors `analyzeRow` rather than sharing code with it, so
 * `buildResolver` treats a value it did not index as "ask the database" instead
 * of "no match". Drift costs a query, never a wrong answer.
 */
function collectIdentifierValues(
  identifierKey: string,
  rawData: Map<number, Record<number, string>>,
  mappings: ImportMappingProperty[],
  resolutions: Map<string, ValueResolution>
): Set<string> {
  const values = new Set<string>()
  const columns = mappings.filter(
    (m) => m.targetFieldKey === identifierKey && m.targetType !== 'skip'
  )
  if (columns.length === 0) return values

  for (const rowData of rawData.values()) {
    for (const mapping of columns) {
      const raw = rowData[mapping.sourceColumnIndex] ?? ''
      const resolution = resolutions.get(hashValue(raw))
      const resolved =
        resolution?.isValid && resolution.resolvedValues.length > 0
          ? resolution.resolvedValues[0]
          : undefined
      const value = resolved && 'value' in resolved ? resolved.value : raw

      if (Array.isArray(value)) {
        for (const element of value) {
          if (typeof element !== 'string') continue
          const trimmed = element.trim()
          if (trimmed) values.add(trimmed)
        }
        continue
      }

      const trimmed = raw.trim()
      if (trimmed) values.add(trimmed)
    }
  }

  return values
}

/**
 * `dbColumn === 'id'` lane — the auto-selected default identifier, so this is
 * the hottest of the two.
 *
 * Same three scope predicates as `findInCustomEntity`'s id branch: a cuid is
 * unique across the whole `EntityInstance` table, so org + definition are what
 * stop a `part` import from resolving a `contact` or another tenant's row, and
 * `archivedAt IS NULL` stops it resolving a merged-away record.
 */
async function indexByInstanceId(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  rawValues: Set<string>
): Promise<IdentifierIndex> {
  const keyByRawValue = new Map<string, string | null>()
  const idsToQuery = new Set<string>()

  for (const raw of rawValues) {
    const id = stripRecordIdPrefix(raw)
    if (!id) {
      keyByRawValue.set(raw, null)
      continue
    }
    keyByRawValue.set(raw, id)
    idsToQuery.add(id)
  }

  const matchesByKey = new Map<string, Set<string>>()
  for (const id of idsToQuery) matchesByKey.set(id, new Set<string>())

  let queryCount = 0
  for (const chunk of chunked([...idsToQuery])) {
    queryCount++
    const rows = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
          inArray(schema.EntityInstance.id, chunk),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
    for (const row of rows) matchesByKey.get(row.id)?.add(row.id)
  }

  return { keyByRawValue, matchesByKey, queryCount }
}

/**
 * `FieldValue` lane — the same query the lookup core issues per value, with the
 * single `eq()` widened to an `IN (...)` over every distinct value in the file.
 *
 * Predicate-for-predicate with `lookupEntitiesByFieldValue`'s OR path (fieldId,
 * organizationId on both tables, `archivedAt IS NULL`) plus the definition
 * scope its AND path states explicitly. `DISTINCT ON` is not needed: a
 * multi-value field yielding two rows for one entity collapses into the
 * per-key `Set<entityId>` anyway.
 */
async function indexByFieldValue(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  field: ResourceField,
  rawValues: Set<string>
): Promise<IdentifierIndex | null> {
  if (!field.id) return null

  // The SAME `CustomField` row the lookup core resolves the candidate to. Its
  // `type` is what drives normalization, and reading it from anywhere else
  // (e.g. mapping `ResourceField.type` onto a `FieldType`) is how the batched
  // and per-row answers would come to disagree.
  const fieldMap = await getCachedFieldMap(organizationId, entityDefinitionId)
  const customField = resolveCustomField(fieldMap, field.id)
  if (!customField) return null

  const keyByRawValue = new Map<string, string | null>()
  const bindsByColumn = new Map<BatchableColumn, Map<string, string | number>>()

  for (const raw of rawValues) {
    const prepared = prepareValue(customField, raw)
    if (prepared.kind === 'unbatchable') continue
    if (prepared.kind === 'no-match') {
      keyByRawValue.set(raw, null)
      continue
    }
    keyByRawValue.set(raw, prepared.indexKey)
    const binds = bindsByColumn.get(prepared.column) ?? new Map<string, string | number>()
    binds.set(prepared.indexKey, prepared.bind)
    bindsByColumn.set(prepared.column, binds)
  }

  const matchesByKey = new Map<string, Set<string>>()
  for (const binds of bindsByColumn.values()) {
    for (const key of binds.keys()) matchesByKey.set(key, new Set<string>())
  }

  let queryCount = 0
  for (const [column, binds] of bindsByColumn) {
    for (const chunk of chunked([...binds.values()])) {
      queryCount++
      const rows = await db
        .select({
          entityId: schema.FieldValue.entityId,
          matchValue: schema.FieldValue[column],
        })
        .from(schema.FieldValue)
        .innerJoin(
          schema.EntityInstance,
          and(
            eq(schema.EntityInstance.id, schema.FieldValue.entityId),
            eq(schema.EntityInstance.organizationId, organizationId)
          )
        )
        .where(
          and(
            eq(schema.FieldValue.fieldId, customField.id),
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
            isNull(schema.EntityInstance.archivedAt),
            matchPredicate(column, chunk)
          )
        )

      for (const row of rows) {
        if (row.matchValue === null || row.matchValue === undefined) continue
        matchesByKey.get(indexKeyFor(column, row.matchValue))?.add(row.entityId)
      }
    }
  }

  return { keyByRawValue, matchesByKey, queryCount }
}

/**
 * `IN (...)` over the typed column, case-folded for the TEXT lane.
 *
 * `lower(col) IN (…)`, mirroring the `caseInsensitiveText: true` the per-row
 * path passes to the lookup core — the two must answer the same question the
 * same way or a batched plan and a per-row plan disagree about whether `m400l`
 * is `M400L`.
 *
 * `inArray`, never a raw `= ANY(${array})`: inside Drizzle's `sql` template a JS
 * array is not serialized into a Postgres array literal, so the comparison
 * silently matches ZERO rows and raises no error — indistinguishable from a
 * legitimate empty result, and here an empty result means "create a duplicate".
 */
function matchPredicate(column: BatchableColumn, chunk: Array<string | number>): SQL {
  if (column === 'valueText') {
    return inArray(sql`lower(${schema.FieldValue.valueText})`, chunk)
  }
  return inArray(schema.FieldValue[column], chunk)
}

/** Index key for a value already known to belong to `column`. */
function indexKeyFor(column: BatchableColumn, value: unknown): string {
  if (column === 'valueText') return `valueText:${String(value).toLowerCase()}`
  return `${column}:${String(value)}`
}

/**
 * Prepare one raw cell exactly the way `buildLookupCondition` does, minus the
 * SQL: normalize, coerce, gate the uncoercible, then pick the typed column.
 *
 * Kept in lockstep with `resources/lookup/lookup-entities-by-field-value.ts`'s
 * `buildLookupCondition` — including its two explicit NaN/Invalid-Date gates,
 * which exist because `createTypedValueInput` does `Number(raw)` / `new Date(raw)`
 * without checking the result. A value the core refuses to build a condition for
 * matches nothing, which is `no-match`, not "skip the batch".
 */
function prepareValue(field: CustomFieldEntity, rawValue: string): PreparedValue {
  const normalized = normalizeForLookup(field.type as FieldType, rawValue)
  if (normalized === null || normalized === undefined) return { kind: 'no-match' }

  const typedInput = createTypedValueInput(field.type, normalized)
  if (typedInput === null) return { kind: 'no-match' }
  if (typedInput.type === 'number' && !Number.isFinite(typedInput.value))
    return { kind: 'no-match' }
  if (typedInput.type === 'date' && Number.isNaN(new Date(typedInput.value).getTime())) {
    return { kind: 'no-match' }
  }

  const { column, value } = typedColumnMatch(typedInput)
  if (!BATCHABLE_COLUMNS.has(column)) return { kind: 'unbatchable' }

  const batchable = column as BatchableColumn
  if (batchable === 'valueText') {
    if (typeof value !== 'string') return { kind: 'unbatchable' }
    const bind = value.toLowerCase()
    return { kind: 'indexed', column: batchable, indexKey: `valueText:${bind}`, bind }
  }
  if (typeof value !== 'string' && typeof value !== 'number') return { kind: 'unbatchable' }
  return {
    kind: 'indexed',
    column: batchable,
    indexKey: indexKeyFor(batchable, value),
    bind: value,
  }
}

/**
 * Resolve a `ResourceField.id` against the org's field map, mirroring the
 * `{ fieldId }` arm of the lookup core's own `resolveField`: by `CustomField.id`
 * first, then by `systemAttribute`, so a static system field never silently
 * misses.
 */
function resolveCustomField(
  fieldMap: Map<string, CustomFieldEntity>,
  fieldId: string
): CustomFieldEntity | null {
  const byId = fieldMap.get(fieldId)
  if (byId) return byId
  for (const candidate of fieldMap.values()) {
    if (candidate.systemAttribute === fieldId) return candidate
  }
  return null
}

/** Split a bind list into {@link CHUNK_SIZE} statements. */
function* chunked<T>(values: T[]): Generator<T[]> {
  for (let i = 0; i < values.length; i += CHUNK_SIZE) {
    yield values.slice(i, i + CHUNK_SIZE)
  }
}
