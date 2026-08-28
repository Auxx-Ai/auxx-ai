// packages/lib/src/builds/standard-cost.ts

/**
 * `rollStandardCost` — the ONLY writer of the five `part_standard_*` fields.
 *
 * plans/products/build/01-build-plan.md sections 2.2 and 2.2a, README B11.
 *
 * A part carries two costs and they answer different questions:
 *
 * | | `part_cost` | `part_standard_cost` |
 * | --- | --- | --- |
 * | written by | `recalculateAffectedParts`, on every vendor-price or BOM change | this function, only when a person runs it |
 * | answers | "what would this cost to build today" | "what we have agreed to value it at" |
 * | stamped onto movements | never | every one |
 *
 * If the standard were recalculated automatically it would just BE `part_cost`,
 * and every movement's frozen `unitCost` would drift with vendor prices — the
 * defect this whole subsystem exists to avoid.
 *
 * 🛑 **This function touches no existing `stock_movement`. Ever.** A mid-period
 * standard change is a one-time revaluation of ON-HAND inventory, never a
 * restatement of history. The revaluation delta is computed and RETURNED; it is
 * not posted, because GL posting is out of scope for this directory (README B9).
 *
 * No permission checks: the router asserts before calling
 * (`docs/lib-module-guide.md` section 6).
 */

import type { Database } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { recalculateAllPartCosts } from '../bom/cost-calculator'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { guard } from './guard'
import { planStandardCostRoll, type StandardCostFields } from './standard-cost-queries'
import type { RollStandardCostInput, StandardCostRollLine, StandardCostRollResult } from './types'

const logger = createScopedLogger('builds:standard-cost')

/** How many parts are written concurrently. Mirrors `persistCosts`. */
const WRITE_BATCH_SIZE = 20

/** One field of one part, already reduced to the value that will be stored. */
type StandardFieldValue = { type: 'number'; value: number } | { type: 'date'; value: string } | null

interface PendingWrite {
  field: CustomFieldEntity
  value: StandardFieldValue
}

/**
 * Freeze a new standard cost onto every part in scope.
 *
 * The order of the steps is the contract:
 *
 * 1. `recalculateAllPartCosts` so `part_cost` is current — the roll's material
 *    input for a purchased component is that number, and a stale one freezes a
 *    price nobody is paying.
 * 2. Plan the roll. **Bottom-up**, because a parent read before its children
 *    have their new standard picks up the old one; and when `partIds` is scoped,
 *    **widened to every ancestor**, because a finished good whose subassembly
 *    just moved is carrying a standard built from the old number.
 * 3. Write only what changed, and stamp `standardCostEffectiveAt` on those parts
 *    only — a standard that did not move took effect earlier, and moving its
 *    date forward would erase the one signal that says how stale it is. The
 *    writes follow the same bottom-up order and stop at the first failure, so a
 *    roll can never freeze a parent and then fail before the children under it.
 * 4. Return the revaluation delta. Never post it.
 *
 * @returns the plan that was executed plus `writtenPartIds`.
 */
export async function rollStandardCost(
  db: Database,
  organizationId: string,
  userId: string,
  input: RollStandardCostInput
): Promise<Result<StandardCostRollResult, Error>> {
  return guard(
    async () => {
      // Step 1. Uses the module-level pool by design — it is a full-org sweep
      // with its own batching, not a participant in any caller's transaction.
      await recalculateAllPartCosts(organizationId)

      // Step 2.
      const { partDefId, fields, plan } = await planStandardCostRoll(db, organizationId, input)

      // Step 3.
      const writtenPartIds = await persistStandardCosts(db, organizationId, userId, {
        partDefId,
        fields,
        effectiveAt: plan.effectiveAt,
        lines: plan.lines,
      })

      logger.info('Rolled standard cost', {
        organizationId,
        scopedPartIds: input.partIds?.length ?? 'all',
        planned: plan.lines.length,
        written: writtenPartIds.length,
        skipped: plan.skipped.length,
        revaluationDelta: plan.revaluationDelta,
        initialValue: plan.initialValue,
        laborRateDeclared: plan.rates.laborCostPerUnit != null,
        overheadRateDeclared: plan.rates.overheadCostPerUnit != null,
      })

      // Step 4. Computed and returned, never posted (README B9).
      return { ...plan, writtenPartIds }
    },
    'Failed to roll standard cost',
    { organizationId, partIds: input.partIds?.length ?? 'all' }
  )
}

/**
 * Write the changed lines through `setValueWithType`, the same writer
 * `persistCosts` uses for the other computed `part` cost fields.
 *
 * The five fields are `updatable: false` + `computed: true`, which makes their
 * inputs read-only and keeps every form, import and connector out — it does not
 * stop this path, because the CRUD layer is where that flag is enforced. Going
 * through `setValueWithType` rather than a raw insert is what keeps the display
 * value, the search text and the realtime store consistent.
 */
async function persistStandardCosts(
  db: Database,
  organizationId: string,
  userId: string,
  args: {
    partDefId: string
    fields: StandardCostFields
    effectiveAt: Date
    lines: StandardCostRollLine[]
  }
): Promise<string[]> {
  const { partDefId, fields, effectiveAt, lines } = args
  const effectiveAtIso = effectiveAt.toISOString()

  const pending = lines
    .filter((line) => line.changed)
    .map((line) => ({
      partId: line.partId,
      writes: [
        { field: fields.material, value: numberValue(line.standardMaterialCost) },
        // A `null` here is the stored form of "no absorption declared" and is
        // written as a CLEAR, not skipped: leaving a previous rate in place
        // would make an undeclared rate indistinguishable from a stale one.
        { field: fields.labor, value: numberValue(line.standardLaborCost) },
        { field: fields.overhead, value: numberValue(line.standardOverheadCost) },
        { field: fields.standard, value: numberValue(line.standardCost) },
        { field: fields.effectiveAt, value: { type: 'date', value: effectiveAtIso } },
      ] satisfies PendingWrite[],
    }))

  if (pending.length === 0) return []

  const ctx = createFieldValueContext(organizationId, userId, db)
  const written = new Set<string>()

  // 🛑 `pending` is in the roll's BOTTOM-UP order and the batches are walked in
  // that order, so whatever gets written is a PREFIX of it. Combined with the
  // abort below, that is the consistency guarantee this loop gives without
  // holding one transaction open across ~1000 field-value writes: a roll never
  // freezes a parent and then fails before the children beneath it.
  //
  // A roll is idempotent — the `changed` diff skips what is already correct — so
  // the recovery from a failure is to run it again, never to unpick it.
  for (let i = 0; i < pending.length; i += WRITE_BATCH_SIZE) {
    const batch = pending.slice(i, i + WRITE_BATCH_SIZE)
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const recordId = toRecordId(partDefId, entry.partId) as RecordId
        // Sequential per part: the five values belong to one record and
        // `setValueWithType` stamps the instance on each write.
        for (const write of entry.writes) {
          await setValueWithType(ctx, {
            recordId,
            fieldId: write.field.id,
            fieldType: toFieldType(write.field.type),
            value: write.value,
          })
        }
        return entry.partId
      })
    )

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') written.add(outcome.value)
    }

    const failure = settled.find((outcome) => outcome.status === 'rejected')
    if (failure) {
      // Publish what DID land before surfacing the failure, so open clients show
      // the parts that moved rather than a stale number no reload explains.
      publishStandardCostUpdates(organizationId, partDefId, pending, written)
      logger.error('Failed to freeze standard cost, aborting the roll', {
        organizationId,
        written: written.size,
        planned: pending.length,
        error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
      })
      throw failure.reason instanceof Error
        ? failure.reason
        : new Error('Failed to freeze standard cost')
    }
  }

  publishStandardCostUpdates(organizationId, partDefId, pending, written)

  return [...written]
}

/**
 * Push the frozen numbers to every open client.
 *
 * A cleared cell publishes as `value: null`, not as an omitted entry — on
 * `FieldValueUpdateEntry` an absent `value` means "don't touch the store", so
 * skipping it would leave the part drawer's Costing card rendering the previous
 * labour absorption until a reload.
 */
function publishStandardCostUpdates(
  organizationId: string,
  partDefId: string,
  pending: { partId: string; writes: PendingWrite[] }[],
  written: ReadonlySet<string>
): void {
  if (written.size === 0) return
  const entries: FieldValueUpdateEntry[] = []
  for (const entry of pending) {
    if (!written.has(entry.partId)) continue
    const recordId = toRecordId(partDefId, entry.partId) as RecordId
    for (const write of entry.writes) {
      entries.push({
        key: buildFieldValueKey(recordId, write.field.id as FieldId),
        value: write.value,
      })
    }
  }
  publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
}

/** `null` is a real answer — it clears the stored value. */
function numberValue(value: number | null): StandardFieldValue {
  return value == null ? null : { type: 'number', value }
}
