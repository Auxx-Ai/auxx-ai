// packages/lib/src/inventory/costing/provisional-standard.ts

/**
 * `replaceProvisionalStandard` — the first receipt of a part whose standard was
 * a guess (73 §6.4).
 *
 * `ensureStandardCost` gives a part its first standard from four doors, three
 * of which are somebody typing a number before any purchase existed, and stamps
 * `part_standard_cost_source = provisional` on those. Under §6.2 rule 1 the
 * first real receipt of such a part would post `ppv = (agreed - guess) x qty` —
 * a variance that says "our guess was wrong", not "the price moved", polluting
 * 5090 with bootstrap noise forever.
 *
 * So the first receipt **replaces** the standard instead of varying against it:
 * the agreed price becomes the standard, the source becomes `confirmed`, and
 * whatever is already on the shelf at the guess is restated through the same
 * `revalue` movement the roll uses. From then on the part varies normally.
 *
 * 🛑 **`provisional` is the ONLY state this fires in.** A `confirmed` standard
 * is a price somebody paid and a NULL one predates the field; replacing either
 * would be a receipt silently moving an agreed standard, which is the moving
 * average the whole subsystem exists to avoid.
 *
 * U5 extends the replacement value from the agreed price to the landed estimate
 * (§7.2) and is what will read {@link ReplaceProvisionalStandardResult.replaced}
 * to skip the receipt's `ppv` leg. Nothing today emits one.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { guard } from './guard'
import { writeRevaluation } from './revalue'
import {
  loadStandardCostWriteContext,
  type StandardCostFields,
  type StandardCostWriteContext,
} from './standard-cost-queries'

const logger = createScopedLogger('costing:provisional-standard')

export interface ReplaceProvisionalStandardResult {
  /**
   * The standard moved. `false` is the ordinary answer — the part was already
   * confirmed, has no standard at all, or the agreed price already matches.
   *
   * 🛑 A receipt must post NO `ppv` when this is `true`: there was never a
   * price to vary from.
   */
  replaced: boolean
  previousStandard: number | null
  newStandard: number | null
  /** Signed, minor units. What the on-hand restatement put through the ledger. */
  revaluationPostedMinor: number
}

const UNCHANGED: ReplaceProvisionalStandardResult = {
  replaced: false,
  previousStandard: null,
  newStandard: null,
  revaluationPostedMinor: 0,
}

/**
 * Replace a provisional standard with what was actually agreed, and revalue
 * whatever is on hand at the guess.
 *
 * `agreedUnitCost` is minor units at rate precision: the purchase order line's
 * agreed price today, the landed estimate once U5 lands.
 *
 * The order of the steps is the contract:
 *
 * 1. The part carries a stored `provisional` standard, or this is a no-op.
 * 2. The agreed price rounds to something positive and different, or a no-op —
 *    a receipt at the guess confirms the standard and revalues nothing.
 * 3. Write the four components, the effective date and `confirmed`.
 * 4. Post one `revalue` movement for `qty on hand x (agreed - guess)`.
 *
 * 🛑 **Step 3 before step 4.** The entry values the shelf at the new standard,
 * so the record has to carry it before the entry lands, or the close's
 * `qty x standard` check reads the two against each other and disagrees.
 */
export async function replaceProvisionalStandard(
  db: Database,
  organizationId: string,
  userId: string,
  partId: string,
  agreedUnitCost: number,
  options?: { occurredAt?: Date }
): Promise<Result<ReplaceProvisionalStandardResult, Error>> {
  return guard(
    async () => {
      const context = await loadStandardCostWriteContext(db, organizationId)
      if (!context.allPartIds.has(partId)) return UNCHANGED
      if (context.partKinds.get(partId) === 'service') return UNCHANGED
      if (context.standardCostSources.get(partId) !== 'provisional') return UNCHANGED

      const previousStandard = context.standardCosts.get(partId) ?? null
      if (previousStandard == null) return UNCHANGED

      if (!Number.isFinite(agreedUnitCost) || agreedUnitCost <= 0) return UNCHANGED
      const newStandard = roundMinorUnits(agreedUnitCost)
      if (newStandard <= 0) return UNCHANGED

      const effectiveAt = options?.occurredAt ?? new Date()
      await writeConfirmedStandard(db, organizationId, context, {
        partId,
        newStandard,
        // A receipt confirms a standard even when the price it confirms is the
        // one already stored; only the revaluation is skipped.
        effectiveAt,
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
          reason: 'First receipt confirmed a provisional standard',
        })
        if (posted.isErr()) throw posted.error
        revaluationPostedMinor = posted.value.postedMinor
      }

      logger.info('Replaced a provisional standard from a receipt', {
        organizationId,
        partId,
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
    'Failed to replace a provisional standard cost',
    { organizationId, partId }
  )
}

/**
 * The six field writes, through `setValueWithType` — the same hook-free writer
 * the roll and `ensureStandardCost` use.
 *
 * Labour and overhead go to zero for the same reason `ensureStandardCost`'s
 * explicit-cost branch zeroes them: the part is being STOCKED at a price a
 * vendor charged, not assembled, so the whole cost is material.
 */
async function writeConfirmedStandard(
  db: Database,
  organizationId: string,
  context: StandardCostWriteContext,
  args: { partId: string; newStandard: number; effectiveAt: Date }
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
      ? [{ field: fields.source, value: { type: 'option' as const, optionId: 'confirmed' } }]
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
