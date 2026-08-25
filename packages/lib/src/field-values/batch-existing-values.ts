// packages/lib/src/field-values/batch-existing-values.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { isArrayReturnFieldType, type TypedFieldValue } from '@auxx/types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { rowsToTypedValues } from './field-value-helpers'
import type { CachedField, FieldValueRow } from './types'

const logger = createScopedLogger('field-value-batch-reads')

/** Raw stored row plus the AI marker column `FieldValueRow` doesn't declare. */
export type ExistingSetRow = FieldValueRow & { aiStatus?: string | null }

/**
 * Raw stored rows per (entityId, fieldId) pair, sortKey-ordered within each
 * pair, keyed by {@link setRowsKey}. Every pair the batch load covered has an
 * entry — an empty array means "covered, no rows", while a missing key means
 * "not covered" (consumers must fall back to an individual load).
 */
export type PreloadedSetRows = Map<string, ExistingSetRow[]>

/** Canonical map key for one (entityId, fieldId) pair. */
export function setRowsKey(entityId: string, fieldId: string): string {
  return `${entityId}:${fieldId}`
}

/**
 * `inArray` id-list bound per statement. Postgres handles far more
 * parameters, but keeping statements bounded keeps plans cacheable and the
 * failure mode (one giant statement) impossible.
 */
const SET_ROWS_CHUNK = 5000

/**
 * Throwing core shared by the raw and typed batch loaders: one
 * `entityId IN (…) AND fieldId IN (…)` SELECT per {@link SET_ROWS_CHUNK} of
 * entityIds, grouped per pair with every covered pair initialised to `[]`.
 */
async function loadSetRowsGrouped(
  ctx: { db: Database | Transaction; organizationId: string },
  entityIds: string[],
  fieldIds: string[]
): Promise<PreloadedSetRows> {
  const result: PreloadedSetRows = new Map()
  for (const entityId of entityIds) {
    for (const fieldId of fieldIds) {
      result.set(setRowsKey(entityId, fieldId), [])
    }
  }
  if (entityIds.length === 0 || fieldIds.length === 0) return result

  for (let offset = 0; offset < entityIds.length; offset += SET_ROWS_CHUNK) {
    const chunk = entityIds.slice(offset, offset + SET_ROWS_CHUNK)
    const rows = (await ctx.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, chunk),
          inArray(schema.FieldValue.fieldId, fieldIds),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as unknown as ExistingSetRow[]

    // Global sortKey order preserves per-pair sortKey order on push.
    for (const row of rows) {
      result.get(setRowsKey(row.entityId, row.fieldId))?.push(row)
    }
  }

  return result
}

/**
 * Batch-load the guard-shaped raw rows for many (entityId, fieldId) pairs in
 * one SELECT per {@link SET_ROWS_CHUNK} of entityIds — the batched twin of
 * {@link loadExistingRowsForSet}, feeding the D-6 idempotency short-circuit
 * and the hooks' oldValue derivation for the orchestrated multi-pair writes
 * (query-reduction plan §3B).
 *
 * The reconcile's diff input is NOT served from here: `setValueWithType`
 * re-reads inside its transaction after the advisory lock
 * (delete-insert-replace §5B RULE) — a preloaded snapshot may only decide
 * "skip this pair entirely", never what a proceeding write does.
 *
 * Returns `null` when the load fails for any reason — same contract as the
 * individual loader: "couldn't look" must degrade to per-pair behavior, never
 * to a false "unchanged".
 */
export async function batchLoadExistingSetRows(
  ctx: { db: Database | Transaction; organizationId: string },
  entityIds: string[],
  fieldIds: string[]
): Promise<PreloadedSetRows | null> {
  try {
    return await loadSetRowsGrouped(ctx, entityIds, fieldIds)
  } catch (error) {
    logger.warn('Batched set pre-read failed; falling back to per-pair loads', {
      entities: entityIds.length,
      fields: fieldIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Load the existing FieldValue rows for one (record, field), ordered by
 * sortKey — the same shape/order `getValue` reads, but raw rows and with NO
 * mail-lens gate (the guard must see what is actually stored, never a
 * viewer-shaped answer). Returns `null` when the load fails for any reason:
 * a false "unchanged" would silently drop a real write, so "couldn't look"
 * always means "assume changed" and the normal write path runs.
 */
export async function loadExistingRowsForSet(
  ctx: { db: Database | Transaction; organizationId: string },
  entityInstanceId: string,
  fieldId: string
): Promise<ExistingSetRow[] | null> {
  try {
    const rows = await ctx.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, entityInstanceId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))
    return rows as unknown as ExistingSetRow[]
  } catch (error) {
    logger.warn('Set idempotency guard: existing-row load failed; writing normally', {
      fieldId,
      entityId: entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Captured pre-write field values, indexed for cheap (entityId, fieldId)
 * lookup by the bulk dispatch path. Inner map values are:
 * - `null` when no row existed pre-write
 * - `TypedFieldValue` for single-value fields
 * - `TypedFieldValue[]` for array-return fields (FILE, TAGS, MULTI_SELECT,
 *   RELATIONSHIP, multi-ACTOR, opt-in `multi`)
 */
export type ExistingFieldValuesMap = Map<
  string,
  Map<string, TypedFieldValue | TypedFieldValue[] | null>
>

/**
 * Convert a raw batch load into the typed old-values map the bulk
 * field-change dispatch consumes. Every entityId gets an outer entry; inner
 * entries exist only for pairs that HAD rows (parity with the pre-batch
 * behavior — an absent inner key has always meant "no pre-write value").
 */
export function typedExistingValuesFromSetRows(
  preloaded: PreloadedSetRows,
  entityIds: string[],
  fieldIds: string[],
  fieldById: Map<string, CachedField>
): ExistingFieldValuesMap {
  const result: ExistingFieldValuesMap = new Map()
  for (const entityId of entityIds) {
    result.set(entityId, new Map())
  }

  for (const entityId of entityIds) {
    const inner = result.get(entityId)!
    for (const fieldId of fieldIds) {
      const rows = preloaded.get(setRowsKey(entityId, fieldId))
      if (!rows || rows.length === 0) continue
      const field = fieldById.get(fieldId)
      if (!field) continue
      const fieldType = field.type as FieldType
      const fieldOptions = field.options as
        | { actor?: { multiple?: boolean }; multi?: boolean }
        | undefined
      const isArrayReturn = isArrayReturnFieldType(fieldType, fieldOptions)
      inner.set(fieldId, rowsToTypedValues(rows, fieldType, isArrayReturn))
    }
  }

  return result
}

/**
 * Batch-fetch the existing typed field values for every (entityId, fieldId)
 * pair the bulk caller is about to write. One query per bulk op, grouped in
 * memory and converted via `rowsToTypedValues` using the already-loaded
 * cached field map.
 *
 * Mirrors `batchGetExistingRelatedIds` for non-relationship fields. Returns
 * an empty inner map for entities that have no rows for any of the fields.
 */
export async function batchGetExistingFieldValues(
  ctx: { db: Database | Transaction; organizationId: string },
  entityIds: string[],
  fieldIds: string[],
  fieldById: Map<string, CachedField>
): Promise<ExistingFieldValuesMap> {
  if (entityIds.length === 0 || fieldIds.length === 0) {
    const empty: ExistingFieldValuesMap = new Map()
    for (const entityId of entityIds) empty.set(entityId, new Map())
    return empty
  }
  const preloaded = await loadSetRowsGrouped(ctx, entityIds, fieldIds)
  return typedExistingValuesFromSetRows(preloaded, entityIds, fieldIds, fieldById)
}
