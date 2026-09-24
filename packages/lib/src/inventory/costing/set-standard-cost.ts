// packages/lib/src/inventory/costing/set-standard-cost.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { requestAccountingRecovery } from '../../accounting/work-items/recovery'
import { wakeReasonCode } from '../../accounting/work-items/wake'
import { getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { ensureStandardCost } from './ensure-standard-cost'
import { guard } from './guard'
import {
  loadStandardCostWriteContext,
  type StandardCostWriteContext,
} from './standard-cost-queries'

const logger = createScopedLogger('costing:set-standard-cost')

/** One typed unit cost, in minor units at rate precision. Zero is a value (103 §5a). */
export interface StandardCostEntry {
  partId: string
  unitCost: number
}

/** What happened to one entry: `set` a first standard, or `restated` a provisional one. */
export type StandardCostEntryOutcome =
  | { partId: string; ok: true; action: 'set' | 'restated'; standardCost: number }
  | { partId: string; ok: false; error: Error }

/**
 * A typed unit cost for one part (106 §5): a first standard when there is none, a restate
 * when the standard is provisional and the part has never moved, refused otherwise.
 */
export async function setStandardCost(
  db: Database,
  organizationId: string,
  entry: StandardCostEntry
): Promise<Result<{ action: 'set' | 'restated'; standardCost: number }, Error>> {
  const result = await setStandardCosts(db, organizationId, [entry])
  if (result.isErr()) return err(result.error)
  const outcome = result.value[0]
  if (!outcome) return err(new NotFoundError('No such part'))
  if (!outcome.ok) return err(outcome.error)
  return ok({ action: outcome.action, standardCost: outcome.standardCost })
}

/**
 * {@link setStandardCost} for many parts, one outcome per entry in input order. One bad entry
 * fails only itself. Wakes `STANDARD_COST_MISSING` and requests a recovery run once.
 */
export async function setStandardCosts(
  db: Database,
  organizationId: string,
  entries: readonly StandardCostEntry[]
): Promise<Result<StandardCostEntryOutcome[], Error>> {
  return guard(
    async () => {
      const outcomes = new Map<string, StandardCostEntryOutcome>()
      const valid = new Map<string, number>()
      for (const entry of entries) {
        if (outcomes.has(entry.partId) || valid.has(entry.partId)) continue
        if (!Number.isFinite(entry.unitCost) || entry.unitCost < 0) {
          outcomes.set(entry.partId, refuse(entry.partId, 'A unit cost must be zero or more'))
          continue
        }
        valid.set(entry.partId, roundMinorUnits(entry.unitCost))
      }
      if (valid.size === 0) return inOrder(entries, outcomes)

      const context = await loadStandardCostWriteContext(db, organizationId)
      const moved = await readMovedPartIds(db, organizationId, [...valid.keys()])

      const toSet = new Map<string, number>()
      const toRestate = new Map<string, number>()
      for (const [partId, unitCost] of valid) {
        const door = classify(context, moved, partId)
        if (door === 'set') toSet.set(partId, unitCost)
        else if (door === 'restate') toRestate.set(partId, unitCost)
        else outcomes.set(partId, { partId, ok: false, error: door })
      }

      if (toSet.size > 0) {
        const ensured = await ensureStandardCost(db, organizationId, [...toSet.keys()], {
          kind: 'manual',
          unitCosts: toSet,
        })
        if (ensured.isErr()) throw ensured.error
        const written = new Set(ensured.value.writtenPartIds)
        for (const [partId, unitCost] of toSet) {
          outcomes.set(
            partId,
            written.has(partId)
              ? { partId, ok: true, action: 'set', standardCost: unitCost }
              : { partId, ok: false, error: new Error('The standard cost could not be written') }
          )
        }
      }

      if (toRestate.size > 0) {
        const restated = await restateUnmovedProvisionalStandards(
          db,
          organizationId,
          context,
          toRestate
        )
        for (const [partId, unitCost] of toRestate) {
          outcomes.set(
            partId,
            restated.has(partId)
              ? { partId, ok: true, action: 'restated', standardCost: unitCost }
              : { partId, ok: false, error: new Error('The standard cost could not be written') }
          )
        }
        if (restated.size > 0) await wakeReasonCode(db, organizationId, 'STANDARD_COST_MISSING')
      }

      if ([...outcomes.values()].some((outcome) => outcome.ok)) {
        await requestAccountingRecovery(organizationId)
      }
      return inOrder(entries, outcomes)
    },
    'Failed to set standard costs',
    { organizationId, entries: entries.length }
  )
}

/** Which door a typed cost goes through, or why it is refused. */
function classify(
  context: StandardCostWriteContext,
  moved: ReadonlySet<string>,
  partId: string
): 'set' | 'restate' | Error {
  if (!context.allPartIds.has(partId)) return new NotFoundError('No such part')
  if (context.partKinds.get(partId) === 'service') {
    return new BadRequestError('A service is never stocked, so it has no standard cost')
  }
  if (context.standardCosts.get(partId) == null) return 'set'
  if (context.standardCostSources.get(partId) !== 'provisional') {
    return new BadRequestError(
      'This standard cost is confirmed. Roll the standard cost to change it.'
    )
  }
  if (moved.has(partId)) {
    return new BadRequestError(
      'This part already has stock movements. Roll the standard cost to change it.'
    )
  }
  return 'restate'
}

/**
 * Overwrite a provisional standard on parts that have never moved (103 §7). With no movement
 * there is nothing on hand and nothing relieved at the old number, so no revaluation is due.
 * Returns the parts written; a failed write is logged and left out.
 */
async function restateUnmovedProvisionalStandards(
  db: Database,
  organizationId: string,
  context: StandardCostWriteContext,
  costs: ReadonlyMap<string, number>
): Promise<Set<string>> {
  const { fields, partDefId } = context
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const ctx = createFieldValueContext(organizationId, userId, db)
  const effectiveAt = new Date().toISOString()
  const written = new Set<string>()
  const entries: FieldValueUpdateEntry[] = []

  for (const [partId, unitCost] of costs) {
    const recordId = toRecordId(partDefId, partId) as RecordId
    const writes = [
      { field: fields.material, value: { type: 'number' as const, value: unitCost } },
      { field: fields.labor, value: { type: 'number' as const, value: 0 } },
      { field: fields.overhead, value: { type: 'number' as const, value: 0 } },
      { field: fields.standard, value: { type: 'number' as const, value: unitCost } },
      { field: fields.effectiveAt, value: { type: 'date' as const, value: effectiveAt } },
      ...(fields.origin
        ? [{ field: fields.origin, value: { type: 'option' as const, optionId: 'manual' } }]
        : []),
    ]
    try {
      for (const write of writes) {
        await setValueWithType(ctx, {
          recordId,
          fieldId: write.field.id,
          fieldType: toFieldType(write.field.type),
          value: write.value,
        })
      }
      written.add(partId)
      for (const write of writes) {
        entries.push({
          key: buildFieldValueKey(recordId, write.field.id as FieldId),
          value: write.value as FieldValueUpdateEntry['value'],
        })
      }
    } catch (error) {
      logger.error('Failed to restate a provisional standard', {
        organizationId,
        partId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (entries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
  }
  return written
}

/** Which of `partIds` have ANY `stock_movement`, archived ones included. */
export async function readMovedPartIds(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Set<string>> {
  const moved = new Set<string>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return moved

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_part'] as const)
  const partField = fields.stock_movement_part
  if (!partField) return moved

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, partField.id),
        inArray(schema.FieldValue.relatedEntityId, unique)
      )
    )
  for (const row of rows) if (row.partId) moved.add(row.partId)
  return moved
}

function refuse(partId: string, message: string): StandardCostEntryOutcome {
  return { partId, ok: false, error: new BadRequestError(message) }
}

function inOrder(
  entries: readonly StandardCostEntry[],
  outcomes: ReadonlyMap<string, StandardCostEntryOutcome>
): StandardCostEntryOutcome[] {
  const seen = new Set<string>()
  const ordered: StandardCostEntryOutcome[] = []
  for (const entry of entries) {
    if (seen.has(entry.partId)) continue
    seen.add(entry.partId)
    const outcome = outcomes.get(entry.partId)
    if (outcome) ordered.push(outcome)
  }
  return ordered
}
