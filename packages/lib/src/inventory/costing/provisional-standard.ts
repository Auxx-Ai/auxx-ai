// packages/lib/src/inventory/costing/provisional-standard.ts

// A receipt confirming a provisional standard (73 §6.4), and a typed cost restating a moved part
// (09 D-SC2a): both price pending rows at the old standard, write, then revalue QoH x delta.
// No permission checks: the router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import type { StandardCostOriginValue, StandardCostSourceValue } from './client'
import { guard } from './guard'
import { pricePendingMovements } from './price-pending-movements'
import { writeRevaluation } from './revalue'
import {
  loadStandardCostWriteContext,
  type StandardCostFields,
  type StandardCostWriteContext,
} from './standard-cost-queries'

const logger = createScopedLogger('costing:provisional-standard')

export interface ReplaceProvisionalStandardResult {
  /** The standard moved. A receipt posts NO `ppv` when this is `true`: there was no price to vary from. */
  replaced: boolean
  previousStandard: number | null
  newStandard: number | null
  /** Signed, minor units. What the on-hand restatement put through the ledger; 0 when nothing posted. */
  revaluationPostedMinor: number
}

/** `receipt` (default): a provisional standard only, confirmed. `typed`: any standard, stays provisional `manual`. */
export type ReplaceStandardDoor = 'receipt' | 'typed'

export interface ReplaceProvisionalStandardOptions {
  occurredAt?: Date
  door?: ReplaceStandardDoor
}

interface DoorRules {
  source: StandardCostSourceValue
  origin: StandardCostOriginValue
  replacesConfirmed: boolean
  reason: string
}

const DOORS: Record<ReplaceStandardDoor, DoorRules> = {
  receipt: {
    source: 'confirmed',
    origin: 'receipt',
    replacesConfirmed: false,
    reason: 'First receipt confirmed a provisional standard',
  },
  // A typed cost stays provisional (73 §6.4): the first receipt still confirms it.
  typed: {
    source: 'provisional',
    origin: 'manual',
    replacesConfirmed: true,
    reason: 'A typed standard cost restated the stock on hand',
  },
}

const UNCHANGED: ReplaceProvisionalStandardResult = {
  replaced: false,
  previousStandard: null,
  newStandard: null,
  revaluationPostedMinor: 0,
}

/**
 * Replace a part's standard and revalue what is on hand at the old one. `unitCost` is minor
 * units at rate precision. A no-op on a part with no standard, a service, or (receipt door) a
 * standard that is not `provisional`.
 *
 * Order is the contract: price pending rows at the OLD standard (111 §1.2), write the new one,
 * then post `qty on hand x delta`, so the record carries the standard the entry values at.
 */
export async function replaceProvisionalStandard(
  db: Database,
  organizationId: string,
  userId: string,
  partId: string,
  unitCost: number,
  options?: ReplaceProvisionalStandardOptions
): Promise<Result<ReplaceProvisionalStandardResult, Error>> {
  const door = options?.door ?? 'receipt'
  const rules = DOORS[door]
  return guard(
    async () => {
      const context = await loadStandardCostWriteContext(db, organizationId)
      if (!context.allPartIds.has(partId)) return UNCHANGED
      if (context.partKinds.get(partId) === 'service') return UNCHANGED
      const source = context.standardCostSources.get(partId)
      if (source !== 'provisional' && !rules.replacesConfirmed) return UNCHANGED

      const previousStandard = context.standardCosts.get(partId) ?? null
      if (previousStandard == null) return UNCHANGED

      // A typed $0 is a value (103 §5a); a receipt at $0 is no price.
      const valid = Number.isFinite(unitCost) && (door === 'typed' ? unitCost >= 0 : unitCost > 0)
      if (!valid) {
        if (door === 'typed') throw new BadRequestError('A unit cost must be zero or more')
        return UNCHANGED
      }
      const newStandard = roundMinorUnits(unitCost)
      if (door === 'receipt' && newStandard <= 0) return UNCHANGED
      // A typed cost equal to the standard changes nothing, and must not downgrade a confirmed one.
      if (door === 'typed' && newStandard === previousStandard) {
        return { replaced: false, previousStandard, newStandard, revaluationPostedMinor: 0 }
      }

      // Not quiet: a replace over units never valued is the double count §1.2 names.
      const priced = await pricePendingMovements(db, organizationId, [partId])
      if (priced.isErr()) throw priced.error

      const effectiveAt = options?.occurredAt ?? new Date()
      // A receipt confirms even at the stored price; only the revaluation is skipped then.
      await writeReplacedStandard(db, organizationId, context, {
        partId,
        newStandard,
        effectiveAt,
        source: rules.source,
        origin: rules.origin,
      })

      const quantityOnHand = context.quantitiesOnHand.get(partId) ?? 0
      const extendedDeltaMinor = roundMinorUnits((newStandard - previousStandard) * quantityOnHand)

      let revaluationPostedMinor = 0
      if (extendedDeltaMinor !== 0) {
        const posted = await writeRevaluation(db, organizationId, userId, {
          lines: [
            {
              partInstanceId: partId,
              unitDeltaMinor: newStandard - previousStandard,
              extendedDeltaMinor,
              glAccountRole: resolveInventoryRoleForPartKind(context.partKinds.get(partId) ?? null),
            },
          ],
          occurredAt: effectiveAt,
          reason: rules.reason,
        })
        if (posted.isErr()) throw posted.error
        revaluationPostedMinor = posted.value.postedMinor
      }

      logger.info('Replaced a standard cost', {
        organizationId,
        partId,
        door,
        previousStandard,
        newStandard,
        quantityOnHand,
        revaluationPostedMinor,
      })

      return {
        replaced: newStandard !== previousStandard,
        previousStandard,
        newStandard,
        revaluationPostedMinor,
      }
    },
    'Failed to replace a standard cost',
    { organizationId, partId, door }
  )
}

/** The field writes, through the hook-free `setValueWithType`. Stocked, not assembled: all material. */
async function writeReplacedStandard(
  db: Database,
  organizationId: string,
  context: StandardCostWriteContext,
  args: {
    partId: string
    newStandard: number
    effectiveAt: Date
    source: StandardCostSourceValue
    origin: StandardCostOriginValue
  }
): Promise<void> {
  const fields: StandardCostFields = context.fields
  const recordId = toRecordId(context.partDefId, args.partId) as RecordId
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const ctx = createFieldValueContext(organizationId, userId, db)

  const writes = [
    { field: fields.material, value: { type: 'number' as const, value: args.newStandard } },
    { field: fields.labor, value: { type: 'number' as const, value: 0 } },
    { field: fields.overhead, value: { type: 'number' as const, value: 0 } },
    { field: fields.standard, value: { type: 'number' as const, value: args.newStandard } },
    {
      field: fields.effectiveAt,
      value: { type: 'date' as const, value: args.effectiveAt.toISOString() },
    },
    ...(fields.source
      ? [{ field: fields.source, value: { type: 'option' as const, optionId: args.source } }]
      : []),
    ...(fields.origin
      ? [{ field: fields.origin, value: { type: 'option' as const, optionId: args.origin } }]
      : []),
  ]

  for (const write of writes) {
    await setValueWithType(ctx, {
      recordId,
      fieldId: write.field.id,
      fieldType: toFieldType(write.field.type),
      value: write.value,
    })
  }

  const entries: FieldValueUpdateEntry[] = writes.map((write) => ({
    key: buildFieldValueKey(recordId, write.field.id as FieldId),
    value: write.value as FieldValueUpdateEntry['value'],
  }))
  publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
}
