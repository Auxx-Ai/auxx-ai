// packages/lib/src/data-connectors/sinks/row-level-writes.ts
// Row-level write semantics for multi-value (`options.multi`) target fields (B1).
//
// A whole-field `set` is DELETE-all-then-INSERT: it wipes every row's
// `managedByConnectorId` marker (other connectors' included) and regenerates all
// sortKeys — so for a multi field the sink NEVER sets. Instead each strategy
// becomes an own-row upsert against the connector's own marked row:
//   • value already present (any row)      → no-op — and if that row is
//     user/foreign-owned it is never re-stamped (match-by-alias stays user-owned);
//   • my marked row exists, value changed  → update that row IN PLACE (sortKey
//     stays → position stays → the primary stays stable);
//   • no matching row, no marked row       → append at the END via the `add`
//     multi-value primitive, then stamp only the appended row;
//   • `fill_blank`                         → write only when the list is EMPTY.
// Other rows are never touched and never deleted.
//
// Manifest capture: the append path routes through the handler's `add` mode, so the
// engine's sync-capture seams record it (plan 07 PR 2). The in-place own-row UPDATE
// below writes `FieldValue` directly and BYPASSES those seams — a named coverage hole
// (plan 07 §4 / plan 03 §3.6, D-16 territory): such a write reaches neither tier-1
// membership nor tier-2 deltas until the path migrates onto the engine.
//
// Field-value helpers are lazy-imported (same rule as the manifest capture in
// entity-sink) so the sink's mocked unit tests never load that graph.

import { schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValueInput } from '@auxx/types'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { UniqueValueConflictError } from '../../errors'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import type { SyncCtx } from './types'

const logger = createScopedLogger('data-connector-row-level-writes')

/** The typed value columns a FieldValue row stores its scalar in. */
const VALUE_COLUMNS = [
  'valueText',
  'valueNumber',
  'valueBoolean',
  'valueDate',
  'valueJson',
  'optionId',
  'relatedEntityId',
  'actorId',
] as const
type ValueColumn = (typeof VALUE_COLUMNS)[number]

type FieldValueInsert = typeof schema.FieldValue.$inferInsert
type FieldValueRow = typeof schema.FieldValue.$inferSelect

/** Minimal cached CustomField shape the row-level path needs. */
export interface RowLevelField {
  id: string
  type: string
  modelType: string
  options?: unknown
  isUnique?: boolean | null
}

/** One diverted multi-field write (built by the sink's `buildWriteSet`). */
export interface RowLevelWrite {
  /** Concrete write-set key (CustomField uuid OR systemAttribute) — what `handler.update` accepts. */
  writeKey: string
  /** The CustomField uuid `FieldValue.fieldId` carries. */
  fieldUuid: string
  /** Cached CustomField row (type / options / isUnique / modelType). */
  field: RowLevelField
  /** Raw scalar source value. Never null/blank/array — the sink guards before diverting. */
  value: unknown
  strategy: 'overwrite' | 'connector_owned_only' | 'fill_blank'
  /**
   * The identity lookup matched THIS value on THIS field (`matchedBy` threaded from
   * `resolveIdentity`) — the matched row IS the incoming value, so the write is a
   * natural no-op without even reading the rows.
   */
  knownPresent?: boolean
}

export type RowLevelAction =
  | {
      kind: 'update'
      write: RowLevelWrite
      rowId: string
      /** The updated row is the field's FIRST row — display columns must follow. */
      isPrimary: boolean
      candidate: FieldValueInsert
      typed: TypedFieldValueInput
    }
  | { kind: 'append'; write: RowLevelWrite; column: ValueColumn; flatValue: unknown }

export interface RowLevelPlan {
  actions: RowLevelAction[]
  /**
   * Projected post-write value per writeKey (the full resulting array). Only fields
   * that will actually write appear. Currently unconsumed: the append path is
   * captured by the engine seams, and the in-place update path is a named coverage
   * hole (see the header) — this projection is what its future capture seam needs.
   */
  captureSet: Record<string, unknown>
}

/** The single populated value column of a candidate insert row. */
function valueColumnOf(candidate: FieldValueInsert): ValueColumn | null {
  for (const col of VALUE_COLUMNS) {
    if (candidate[col] !== null && candidate[col] !== undefined) return col
  }
  return null
}

/** Stored-space equality on one value column. EMAIL compares case-insensitively. */
function valuesEqual(a: unknown, b: unknown, fieldType: string): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b
  if (fieldType === 'EMAIL')
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/**
 * Plan the row-level writes for one record: read the field's current rows, decide
 * per field between no-op / in-place own-row update / append, and run the per-value
 * uniqueness pre-flight. Read-only — call BEFORE the record's write so its reads
 * see the pre-write rows.
 */
export async function planRowLevelWrites(
  ctx: SyncCtx,
  entityDefinitionId: string,
  instanceId: string,
  writes: RowLevelWrite[]
): Promise<RowLevelPlan> {
  const actions: RowLevelAction[] = []
  const captureSet: Record<string, unknown> = {}
  if (writes.length === 0) return { actions, captureSet }

  const { createFieldValueContext, validateAndConvertValue } = await import(
    '../../field-values/field-value-helpers'
  )
  const { buildFieldValueRow } = await import('../../field-values/field-value-mutations')
  const fvCtx = createFieldValueContext(ctx.orgId, undefined, ctx.db)

  for (const w of writes) {
    // Match-by-alias fast path: the identity lookup matched this exact value on
    // this field, so a row with it already exists — natural no-op, never re-stamped.
    if (w.knownPresent) continue

    // Normalize through the write path's own validator so the comparison below is
    // stored-space vs stored-space (email lowercased/trimmed, date → ISO, …).
    let typed: TypedFieldValueInput | null = null
    try {
      const converted = await validateAndConvertValue(
        fvCtx,
        w.value,
        w.field.type as never,
        w.field as never
      )
      typed = Array.isArray(converted) ? (converted[0] ?? null) : converted
    } catch (error) {
      logger.warn('row-level value failed validation — dropped', {
        connectorId: ctx.connector.id,
        fieldId: w.fieldUuid,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!typed) continue

    const candidate = buildFieldValueRow({
      organizationId: ctx.orgId,
      entityId: instanceId,
      entityDefinitionId,
      fieldId: w.fieldUuid,
      fieldType: w.field.type as FieldType,
      value: typed,
      sortKey: 'a0', // placeholder — never inserted; only the value columns are read
    })
    const column = valueColumnOf(candidate)
    if (!column) continue

    const rows = (await ctx.db
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, instanceId),
          eq(schema.FieldValue.fieldId, w.fieldUuid),
          eq(schema.FieldValue.organizationId, ctx.orgId)
        )
      )
      .orderBy(asc(schema.FieldValue.sortKey))) as FieldValueRow[]

    // fill_blank on a multi field: write only when the list is EMPTY.
    if (w.strategy === 'fill_blank' && rows.length > 0) continue

    const flatValue = candidate[column]
    if (rows.some((row) => valuesEqual(row[column], flatValue, w.field.type))) {
      // Value already present — user/foreign-owned rows are never re-stamped;
      // the connector's own unchanged row needs nothing.
      continue
    }

    const myRow = rows.find((row) => row.managedByConnectorId === ctx.connector.id)

    // Per-value uniqueness pre-flight (B1): an org-wide conflict drops THIS value
    // with a log — never the whole record — so the sync stays green.
    if (w.field.isUnique) {
      try {
        const { checkUniqueValueTyped } = await import(
          '../../custom-fields/check-unique-value-typed'
        )
        await checkUniqueValueTyped(
          {
            fieldId: w.fieldUuid,
            value: typed,
            organizationId: ctx.orgId,
            excludeEntityId: instanceId,
          },
          ctx.db
        )
      } catch (error) {
        logger.warn('row-level value conflicts with another record — dropped, sync stays green', {
          connectorId: ctx.connector.id,
          fieldId: w.fieldUuid,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }

    const flatRows = rows.map((row) => row[column])
    if (myRow) {
      const idx = rows.indexOf(myRow)
      const projected = [...flatRows]
      projected[idx] = flatValue
      actions.push({
        kind: 'update',
        write: w,
        rowId: myRow.id,
        isPrimary: idx === 0,
        candidate,
        typed,
      })
      captureSet[w.writeKey] = projected
    } else {
      actions.push({ kind: 'append', write: w, column, flatValue })
      captureSet[w.writeKey] = [...flatRows, flatValue]
    }
  }

  return { actions, captureSet }
}

/**
 * Execute a planned set of row-level writes. In-place updates go straight to the
 * connector's own FieldValue row (sortKey untouched → primary stable) and keep the
 * denormalized display/search columns in step; appends route through the standard
 * handler's `add` mode (dedupe + hooks + cap) and then stamp ONLY the appended row.
 * Failures are per-value: logged and skipped, never failing the record.
 */
export async function executeRowLevelWrites(
  ctx: SyncCtx,
  entityDefinitionId: string,
  handler: UnifiedCrudHandler,
  instanceId: string,
  actions: RowLevelAction[]
): Promise<void> {
  if (actions.length === 0) return
  const recordId = toRecordId(entityDefinitionId, instanceId)

  for (const action of actions) {
    if (action.kind === 'update') {
      const { candidate } = action
      await ctx.db
        .update(schema.FieldValue)
        .set({
          valueText: candidate.valueText,
          valueNumber: candidate.valueNumber,
          valueBoolean: candidate.valueBoolean,
          valueDate: candidate.valueDate,
          valueJson: candidate.valueJson,
          optionId: candidate.optionId,
          relatedEntityId: candidate.relatedEntityId,
          relatedEntityDefinitionId: candidate.relatedEntityDefinitionId,
          actorId: candidate.actorId,
          managedByConnectorId: ctx.connector.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.FieldValue.id, action.rowId),
            eq(schema.FieldValue.organizationId, ctx.orgId)
          )
        )

      // Display/search upkeep. A direct row update bypasses the service layer, so:
      // primary row changed → recompute the denormalized display column (subtitle
      // follows a connector email change); non-primary → refresh search text only
      // (the display columns still reflect the untouched primary).
      try {
        if (action.isPrimary) {
          const { createFieldValueContext, maybeUpdateDisplayValue } = await import(
            '../../field-values/field-value-helpers'
          )
          const { getCachedResource } = await import('../../cache')
          const resource = await getCachedResource(ctx.orgId, entityDefinitionId)
          const entityDefinition = resource
            ? {
                id: resource.entityDefinitionId ?? resource.id,
                primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
                secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
                avatarFieldId: resource.display.avatarField?.id ?? null,
              }
            : null
          await maybeUpdateDisplayValue(
            createFieldValueContext(ctx.orgId, undefined, ctx.db),
            recordId,
            { ...action.write.field, entityDefinition } as never,
            action.typed
          )
        } else {
          const { updateSearchText } = await import('../../field-values/search-text')
          await updateSearchText(ctx.db, instanceId, ctx.orgId)
        }
      } catch (error) {
        logger.warn('row-level display/search refresh failed', {
          connectorId: ctx.connector.id,
          recordId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      continue
    }

    // Append at the end via the multi-value primitive (never a whole-field set):
    // `add` dedupes, runs hooks and honors the value cap.
    try {
      // Event suppression comes from the handler's silent `sync` session
      // (plan 03 §3.4), not a per-call flag.
      await handler.update(
        recordId,
        { [action.write.writeKey]: [action.flatValue] },
        { [action.write.writeKey]: 'add' }
      )
    } catch (error) {
      if (error instanceof UniqueValueConflictError) {
        logger.warn('row-level append hit a unique-value conflict — value dropped', {
          connectorId: ctx.connector.id,
          recordId,
          fieldId: action.write.fieldUuid,
          conflictingValue: error.conflictingValue,
        })
      } else {
        logger.warn('row-level append failed — value skipped', {
          connectorId: ctx.connector.id,
          recordId,
          fieldId: action.write.fieldUuid,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      continue
    }

    // Stamp ONLY the appended row (row-accurate provenance). The value was absent
    // before the append, so the matching unmarked row is exactly the one we wrote.
    await ctx.db
      .update(schema.FieldValue)
      .set({ managedByConnectorId: ctx.connector.id })
      .where(
        and(
          eq(schema.FieldValue.entityId, instanceId),
          eq(schema.FieldValue.fieldId, action.write.fieldUuid),
          eq(schema.FieldValue.organizationId, ctx.orgId),
          eq(schema.FieldValue[action.column], action.flatValue as never),
          isNull(schema.FieldValue.managedByConnectorId)
        )
      )
  }
}
