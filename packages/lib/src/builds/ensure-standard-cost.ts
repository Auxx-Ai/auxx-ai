// packages/lib/src/builds/ensure-standard-cost.ts

/**
 * `ensureStandardCost` — the ONLY writer that sets a FIRST standard cost.
 *
 * plans/money/tasks/15-costing-usability.md §1.
 *
 * 🛑 **It writes only parts where `part_standard_cost IS NULL`. It never overwrites.**
 *
 * That single rule is the whole safety argument. Overwriting would turn a
 * vendor-price change into an automatic revaluation of on-hand inventory, which
 * is exactly what `standard-cost.ts`'s header forbids: *"If the standard were
 * recalculated automatically it would just BE `part_cost`, and every movement's
 * frozen `unitCost` would drift with vendor prices."* Re-valuing is
 * {@link rollStandardCost}'s job and nothing else's.
 *
 * Four callers, one function (§2):
 *
 * | source        | fires when                          | cost from                 |
 * | ------------- | ----------------------------------- | ------------------------- |
 * | `supplier-price` | a `vendor_part` price is written | the refreshed `part_cost` |
 * | `opening-stock`  | a part is created with stock     | `unitCost`, typed         |
 * | `receipt`        | a part's first receipt           | `unitCost`, landed        |
 * | `manual`         | a caller asks explicitly         | the refreshed `part_cost` |
 *
 * ✅ **A first standard always finds `QoH = 0`,** because every door that can
 * give a part stock either goes through here first or refuses without a
 * standard. So this can never revalue anything and there is no initial
 * valuation to post under any posting regime.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { roundMinorUnits } from './client'
import { guard } from './guard'
import {
  loadStandardCostWriteContext,
  planStandardCostRoll,
  type StandardCostFields,
  type StandardCostWriteContext,
} from './standard-cost-queries'
import type { StandardCostComponents } from './types'

const logger = createScopedLogger('builds:ensure-standard-cost')

/** How many parts are written concurrently. Mirrors `persistStandardCosts`. */
const WRITE_BATCH_SIZE = 20

/** Which door called, and the cost it can supply. */
export interface EnsureStandardCostSource {
  kind: 'supplier-price' | 'opening-stock' | 'receipt' | 'manual'
  /**
   * The cost to freeze, in whole minor units.
   *
   * Supplied by `opening-stock` and `receipt`, which know an exact number.
   * Omitted by `supplier-price` and `manual`, which fall back to the part's
   * refreshed `part_cost` through the normal roll.
   */
  unitCost?: number
}

export interface EnsureStandardCostResult {
  /** Parts that had no standard and now have one. */
  writtenPartIds: string[]
}

/** One part's first standard, already reduced to the four numbers to store. */
interface FirstStandard {
  partId: string
  components: StandardCostComponents
}

/**
 * Give every named part a standard cost, if and only if it has none.
 *
 * Widens to ancestors first, then applies the NULL filter to the wider set:
 * pricing a component makes its parent rollable, and without the widening the
 * parent stays unvalued one level up.
 *
 * 🛑 **Never throws on an unvaluable part.** A part with no cost at all is
 * skipped and reported, not an error — these callers are post-commit hooks and
 * create forms, and one that throws on a vendor-price save is worse than one
 * that writes nothing.
 *
 * ⚠️ Deliberately does NOT run `recalculateAllPartCosts`. `rollStandardCost`
 * opens with that full-org sweep; every caller here has either just recalculated
 * the affected parts or supplies `unitCost` outright.
 *
 * Authored as the org's system user: nobody pressed a button, and attributing
 * the write to whoever edited a price is a lie.
 */
export async function ensureStandardCost(
  db: Database,
  organizationId: string,
  partIds: string[],
  source: EnsureStandardCostSource
): Promise<Result<EnsureStandardCostResult, Error>> {
  return guard(
    async () => {
      const requested = [...new Set(partIds.filter(Boolean))]
      if (requested.length === 0) return { writtenPartIds: [] }

      const explicitCost = resolveExplicitCost(source.unitCost)
      const effectiveAt = new Date()

      // The plan is where the widening happens: up to every ancestor, and (since
      // task 15 §3) down to the descendants that have no standard either. Every
      // line it returns is a candidate; the NULL filter below is what turns the
      // candidates into writes.
      let context: StandardCostWriteContext
      let candidates: FirstStandard[] = []
      let skipped = 0

      try {
        const planned = await planStandardCostRoll(db, organizationId, {
          partIds: requested,
          effectiveAt,
        })
        context = {
          partDefId: planned.partDefId,
          fields: planned.fields,
          allPartIds: planned.allPartIds,
          standardCosts: planned.stored.standardCosts,
        }
        skipped = planned.plan.skipped.length
        // 🛑 THE ONE RULE. `previousStandardCost` is the stored
        // `part_standard_cost`, so `== null` is literally `IS NULL`. It is
        // applied here rather than to the input because the widened set is what
        // gets written, and a widened ancestor that already has a standard must
        // survive this untouched.
        candidates = planned.plan.lines
          .filter((line) => line.previousStandardCost == null)
          .map((line) => ({
            partId: line.partId,
            components: {
              standardMaterialCost: line.standardMaterialCost,
              standardLaborCost: line.standardLaborCost,
              standardOverheadCost: line.standardOverheadCost,
              standardCost: line.standardCost,
            },
          }))
      } catch (error) {
        // With no cost of our own there is nothing left to do, so the failure is
        // the answer. With one, the plan was only ever the widening half: an
        // unpriced sibling under a shared parent aborts it, and refusing to
        // freeze a cost somebody typed because of an unrelated part is worse
        // than writing exactly what they typed.
        if (explicitCost == null) throw error
        logger.warn('Could not plan the roll around an explicit cost, writing it alone', {
          organizationId,
          source: source.kind,
          error: error instanceof Error ? error.message : String(error),
        })
        context = await loadStandardCostWriteContext(db, organizationId)
      }

      const writes = orderWrites(requested, candidates, explicitCost, context)
      if (writes.length === 0) {
        logger.info('No first standard cost to write', {
          organizationId,
          source: source.kind,
          considered: requested.length,
          written: 0,
          skipped,
        })
        return { writtenPartIds: [] }
      }

      // Nobody pressed a button. Attributing the write to whoever edited a price
      // would put a person's name on a decision the system made.
      const userId = await getOrgCache().get(organizationId, 'systemUser')

      const writtenPartIds = await persistFirstStandards(db, organizationId, userId, {
        partDefId: context.partDefId,
        fields: context.fields,
        effectiveAt,
        writes,
      })

      logger.info('Ensured first standard cost', {
        organizationId,
        source: source.kind,
        considered: requested.length,
        planned: writes.length,
        written: writtenPartIds.length,
        skipped,
        explicitCost,
      })

      return { writtenPartIds }
    },
    'Failed to ensure standard cost',
    { organizationId, source: source.kind, partIds: partIds.length }
  )
}

/**
 * Validate the caller's cost, in whole minor units.
 *
 * A zero or negative standard is refused rather than stored: `completeBuild`,
 * `adjustStock` and `receiveStock` all treat a zero standard as "not rolled",
 * so freezing one would give the part a standard that every consumer reads as
 * an absence.
 */
function resolveExplicitCost(unitCost: number | undefined): number | null {
  if (unitCost == null) return null
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    throw new BadRequestError('A standard cost must be a positive amount in whole minor units')
  }
  return roundMinorUnits(unitCost)
}

/**
 * Merge the planned first standards with the caller's explicit cost, in the
 * order they must be written.
 *
 * The explicit cost wins on the parts the caller NAMED, and only there: it is
 * the cost of the stock being taken in, so material is that number and
 * conversion is zero (the part is being stocked, not built). A widened ancestor
 * is never overridden: it has a bill of materials and rolls normally.
 *
 * Overrides go first so the write order stays bottom-up: a part being stocked
 * is a leaf of whatever the plan widened to above it.
 */
function orderWrites(
  requested: string[],
  candidates: FirstStandard[],
  explicitCost: number | null,
  context: StandardCostWriteContext
): FirstStandard[] {
  const ordered: FirstStandard[] = []
  const claimed = new Set<string>()

  if (explicitCost != null) {
    for (const partId of requested) {
      // A stale id from a caller must never invent a write target, and a part
      // that already has a standard is never touched.
      if (!context.allPartIds.has(partId)) continue
      if (context.standardCosts.get(partId) != null) continue
      if (claimed.has(partId)) continue
      claimed.add(partId)
      ordered.push({
        partId,
        components: {
          standardMaterialCost: explicitCost,
          standardLaborCost: 0,
          standardOverheadCost: 0,
          standardCost: explicitCost,
        },
      })
    }
  }

  // `candidates` is already the plan's bottom-up order.
  for (const candidate of candidates) {
    if (claimed.has(candidate.partId)) continue
    claimed.add(candidate.partId)
    ordered.push(candidate)
  }

  return ordered
}

/**
 * Write the five `part_standard_*` fields through `setValueWithType`, the same
 * writer `persistStandardCosts` uses.
 *
 * Two deliberate differences from the roll's persist step:
 *
 *  1. **It never throws.** These callers are post-commit hooks and create forms.
 *     A failed batch stops the loop (so what landed is still a bottom-up PREFIX
 *     of the plan, the same consistency guarantee the roll gives) and is logged,
 *     but the caller gets the parts that were written rather than an error that
 *     would roll back a vendor price somebody just saved.
 *  2. **Every part here is a FIRST standard,** so there is no `changed` diff to
 *     apply: a part with nothing stored has, by definition, changed.
 */
async function persistFirstStandards(
  db: Database,
  organizationId: string,
  userId: string,
  args: {
    partDefId: string
    fields: StandardCostFields
    effectiveAt: Date
    writes: readonly FirstStandard[]
  }
): Promise<string[]> {
  const { partDefId, fields, effectiveAt, writes } = args
  const effectiveAtIso = effectiveAt.toISOString()

  const pending = writes.map((write) => ({
    partId: write.partId,
    values: [
      { field: fields.material, value: numberValue(write.components.standardMaterialCost) },
      { field: fields.labor, value: numberValue(write.components.standardLaborCost) },
      { field: fields.overhead, value: numberValue(write.components.standardOverheadCost) },
      { field: fields.standard, value: numberValue(write.components.standardCost) },
      { field: fields.effectiveAt, value: { type: 'date' as const, value: effectiveAtIso } },
    ],
  }))

  const ctx = createFieldValueContext(organizationId, userId, db)
  const written = new Set<string>()

  for (let i = 0; i < pending.length; i += WRITE_BATCH_SIZE) {
    const batch = pending.slice(i, i + WRITE_BATCH_SIZE)
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const recordId = toRecordId(partDefId, entry.partId) as RecordId
        // Sequential per part: the five values belong to one record and
        // `setValueWithType` stamps the instance on each write.
        for (const write of entry.values) {
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
      logger.error('Failed to freeze a first standard cost, stopping', {
        organizationId,
        written: written.size,
        planned: pending.length,
        error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
      })
      break
    }
  }

  publishFirstStandards(organizationId, partDefId, pending, written)

  return [...written]
}

/** The same realtime frame `persistStandardCosts` publishes, for the parts that landed. */
function publishFirstStandards(
  organizationId: string,
  partDefId: string,
  pending: { partId: string; values: { field: { id: string }; value: unknown }[] }[],
  written: ReadonlySet<string>
): void {
  if (written.size === 0) return
  const entries: FieldValueUpdateEntry[] = []
  for (const entry of pending) {
    if (!written.has(entry.partId)) continue
    const recordId = toRecordId(partDefId, entry.partId) as RecordId
    for (const write of entry.values) {
      entries.push({
        key: buildFieldValueKey(recordId, write.field.id as FieldId),
        value: write.value as FieldValueUpdateEntry['value'],
      })
    }
  }
  publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
}

/** `null` is a real answer: it clears the stored value. */
function numberValue(value: number | null): { type: 'number'; value: number } | null {
  return value == null ? null : { type: 'number', value }
}
