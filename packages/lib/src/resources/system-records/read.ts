// packages/lib/src/resources/system-records/read.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { RecordId, TypedFieldValue } from '@auxx/types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { rowsToTypedValues } from '../../field-values/field-value-helpers'
import type { FieldValueRow } from '../../field-values/types'
import { getInstanceId, toRecordId } from '../resource-id'
import type { SystemFieldContext } from './fields'
import { findSystemRecordIdsByValue } from './find-by-value'
import { chunked, type SystemInstanceRow, systemInstanceColumns, systemRecordScope } from './scope'

export type { SystemInstanceRow } from './scope'
export { systemInstanceColumns, systemRecordScope } from './scope'

/** One system record: its instance columns, plus its stored cells typed by attribute. */
export interface SystemRecord<A extends string> {
  id: string
  recordId: RecordId
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  /** The denormalised `EntityInstance.displayName`, as the write path last composed it. */
  displayName: string | null
  /** The first stored value of `attribute`, or `undefined` when the field is missing or unset. */
  cell(attribute: A): TypedFieldValue | undefined
  /** Every stored value of `attribute`, in `sortKey` order. */
  cells(attribute: A): TypedFieldValue[]
  /**
   * The stored rows, for the few values the typed shape cannot express — an open TAGS field keeps a free-text tag in `optionId` with `valueText` as the fallback.
   *
   * Also the only way to read a JSON field whose payload is an ARRAY: `cell()`
   * runs it through `readEnvelope`, which answers `{}` for one.
   */
  rows(attribute: A): FieldValueRow[]
  text(attribute: A): string | null
  number(attribute: A): number | null
  boolean(attribute: A): boolean | null
  option(attribute: A): string | null
  /** The actor's own id — `User.id`, `Agent.id`, or the group / worker instance id. */
  actor(attribute: A): string | null
  /** The related record's INSTANCE id, falling back to the stored `relatedEntityId` when the row carries no def id (`cell()`/`cells()` cannot: a `RecordId` needs both halves). */
  related(attribute: A): string | null
  date(attribute: A): string | null
}

export interface ReadSystemRecordsOptions<A extends string> {
  ids?: readonly string[]
  /**
   * The rows a paginated `EntityInstance` query already selected through
   * {@link systemInstanceColumns}, in the order it returned them — skips the
   * instance query, so `ids`, `by` and `orderBy` no longer apply. Every row is
   * checked against `organizationId`, `ctx.defId` and `includeArchived`; a page
   * built without {@link systemRecordScope} throws rather than leaking.
   */
  instances?: readonly SystemInstanceRow[]
  includeArchived?: boolean
  orderBy?: 'createdAt' | 'updatedAt'
  /** Children of these parents: instances whose relationship field `attribute` points at one of `in`. */
  by?: { attribute: A; in: readonly string[] }
  /** `false` skips the values query for a caller that only wants live ids; every accessor then reads as unset. */
  cells?: boolean
}

/**
 * Instances of `ctx.defId` with their cells, in two chunked queries (three with
 * `by`, one with `cells: false`, one with `instances`). No permission checks —
 * the router asserts and hands down its scope.
 *
 * There is no `limit`/`offset`: a paginated list pages the instance query itself
 * with `systemValueJoin` and hands the rows back through `instances`.
 */
export async function readSystemRecords<A extends string>(
  db: Database | Transaction,
  organizationId: string,
  ctx: SystemFieldContext<A>,
  // `NoInfer`: the attributes come from `ctx`, never from an `by.attribute` that
  // would otherwise narrow every later `cell()` to that one attribute.
  options: ReadSystemRecordsOptions<NoInfer<A>> = {}
): Promise<SystemRecord<A>[]> {
  const { includeArchived = false, orderBy = 'createdAt', cells = true } = options
  const instances = options.instances
    ? ownPage(options.instances, organizationId, ctx.defId, includeArchived)
    : await readOwnInstances(db, organizationId, ctx, options, includeArchived, orderBy)
  if (instances.length === 0) return []

  const values = cells
    ? await readValues(db, organizationId, instances, fieldIdsOf(ctx))
    : new Map<string, Map<string, FieldValueRow[]>>()
  return instances.map((instance) => buildRecord(ctx, instance, values.get(instance.id)))
}

/** The `ids`/`by` path: resolve the wanted ids, read their instance rows, sort them. */
async function readOwnInstances<A extends string>(
  db: Database | Transaction,
  organizationId: string,
  ctx: SystemFieldContext<A>,
  options: ReadSystemRecordsOptions<NoInfer<A>>,
  includeArchived: boolean,
  orderBy: 'createdAt' | 'updatedAt'
): Promise<SystemInstanceRow[]> {
  let ids = options.ids ? [...new Set(options.ids)] : undefined
  if (options.by) {
    const children = [
      ...new Set(
        [
          ...(
            await findSystemRecordIdsByValue(
              db,
              organizationId,
              ctx,
              { attribute: options.by.attribute, related: options.by.in },
              { includeArchived }
            )
          ).values(),
        ].flat()
      ),
    ]
    const wanted = ids ? new Set(ids) : null
    ids = wanted ? children.filter((id) => wanted.has(id)) : children
  }
  if (ids && ids.length === 0) return []

  const instances = await readInstances(db, organizationId, ctx.defId, ids, includeArchived)
  // A copy: the un-chunked arm hands back the driver's own array, and sorting it
  // in place would reorder whatever else still holds a reference to it.
  // `?.`: both columns are NOT NULL, but a row handed in short must not crash the sort.
  return [...instances].sort(
    (a, b) =>
      (a[orderBy]?.getTime() ?? 0) - (b[orderBy]?.getTime() ?? 0) || a.id.localeCompare(b.id)
  )
}

/**
 * A handed-in page, checked against the scope the reader would have applied itself.
 *
 * Throws rather than filtering: a mismatch is a paging query missing a
 * {@link systemRecordScope} predicate, and silently dropping the rows would hand
 * back a short page with nothing to say why.
 */
function ownPage(
  instances: readonly SystemInstanceRow[],
  organizationId: string,
  defId: string,
  includeArchived: boolean
): SystemInstanceRow[] {
  for (const row of instances) {
    if (row.organizationId !== organizationId || row.entityDefinitionId !== defId) {
      throw new Error(
        `readSystemRecords: instance ${row.id} is not in ${organizationId}/${defId} — the paging query is missing systemRecordScope()`
      )
    }
    if (!includeArchived && row.archivedAt) {
      throw new Error(
        `readSystemRecords: instance ${row.id} is archived — page it with systemRecordScope(…, { includeArchived: true }) and read it the same way`
      )
    }
  }
  return [...instances]
}

async function readInstances(
  db: Database | Transaction,
  organizationId: string,
  defId: string,
  ids: string[] | undefined,
  includeArchived: boolean
): Promise<SystemInstanceRow[]> {
  const scope = (extra?: ReturnType<typeof inArray>) =>
    and(systemRecordScope(organizationId, defId, { includeArchived }), ...(extra ? [extra] : []))
  if (!ids)
    return db.select(systemInstanceColumns).from(schema.EntityInstance).where(scope()) as Promise<
      SystemInstanceRow[]
    >

  const out: SystemInstanceRow[] = []
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select(systemInstanceColumns)
      .from(schema.EntityInstance)
      .where(scope(inArray(schema.EntityInstance.id, chunk)))
    out.push(...(rows as SystemInstanceRow[]))
  }
  return out
}

/** `entityId -> fieldId -> rows`, `sortKey`-ordered within each pair. */
async function readValues(
  db: Database | Transaction,
  organizationId: string,
  instances: SystemInstanceRow[],
  fieldIds: string[]
): Promise<Map<string, Map<string, FieldValueRow[]>>> {
  const out = new Map<string, Map<string, FieldValueRow[]>>()
  if (fieldIds.length === 0) return out
  for (const chunk of chunked(instances.map((instance) => instance.id))) {
    // Whole rows: `rowsToTypedValues` reads every value column plus the row's
    // own id/sortKey, and the caller does not know which column its field uses.
    const rows = (await db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, chunk),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as unknown as FieldValueRow[]
    for (const row of rows) {
      let byField = out.get(row.entityId)
      if (!byField) {
        byField = new Map()
        out.set(row.entityId, byField)
      }
      const list = byField.get(row.fieldId)
      if (list) list.push(row)
      else byField.set(row.fieldId, [row])
    }
  }
  return out
}

function buildRecord<A extends string>(
  ctx: SystemFieldContext<A>,
  instance: SystemInstanceRow,
  bucket: Map<string, FieldValueRow[]> | undefined
): SystemRecord<A> {
  const typed = new Map<A, TypedFieldValue[]>()
  const rows = (attribute: A): FieldValueRow[] => {
    const field = ctx.fields[attribute]
    return field ? (bucket?.get(field.id) ?? []) : []
  }
  const cells = (attribute: A): TypedFieldValue[] => {
    const cached = typed.get(attribute)
    if (cached) return cached
    const field = ctx.fields[attribute]
    // Always the array arm, so a single-value read of an array-return type
    // (SINGLE_SELECT is one) still goes through the one conversion.
    const values = field
      ? ((rowsToTypedValues(rows(attribute), field.type as FieldType, true) ??
          []) as TypedFieldValue[])
      : []
    typed.set(attribute, values)
    return values
  }
  const cell = (attribute: A) => cells(attribute)[0]
  return {
    id: instance.id,
    recordId: toRecordId(ctx.defId, instance.id),
    displayName: instance.displayName,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    archivedAt: instance.archivedAt,
    cell,
    cells,
    rows,
    text: (attribute) => {
      const value = cell(attribute)
      return value?.type === 'text' ? value.value || null : null
    },
    // A stored row whose column is NULL reads `null`, not `rowToTypedValue`'s
    // `0` / `false` default: the hand-written reads this replaces distinguished
    // "unset" from "zero", and `readBuildMovements` refuses a reversal on a NULL
    // unit cost rather than reversing at nothing.
    number: (attribute) => {
      const value = cell(attribute)
      if (value?.type !== 'number') return null
      return rows(attribute)[0]?.valueNumber ?? null
    },
    boolean: (attribute) => {
      const value = cell(attribute)
      if (value?.type !== 'boolean') return null
      return rows(attribute)[0]?.valueBoolean ?? null
    },
    option: (attribute) => {
      const value = cell(attribute)
      return value?.type === 'option' ? value.optionId || null : null
    },
    actor: (attribute) => {
      const value = cell(attribute)
      return value?.type === 'actor' ? value.id || null : null
    },
    related: (attribute) => {
      const value = cell(attribute)
      if (value?.type !== 'relationship') return null
      if (value.recordId) return getInstanceId(value.recordId)
      return rows(attribute)[0]?.relatedEntityId ?? null
    },
    date: (attribute) => {
      const value = cell(attribute)
      return value?.type === 'date' ? value.value || null : null
    },
  }
}

/** The ids of the fields the context resolved, dropping the attributes the org lacks. */
function fieldIdsOf<A extends string>(ctx: SystemFieldContext<A>): string[] {
  const ids = new Set<string>()
  for (const field of Object.values<{ id: string } | null>(ctx.fields)) {
    if (field) ids.add(field.id)
  }
  return [...ids]
}
