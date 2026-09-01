// packages/lib/src/bom/apply-tariff-schedule.ts

/**
 * The explicit "apply rate changes" action
 * (plans/money/tasks/29-tariff-schedule.md §8, §12 a).
 *
 * A `tariff_rate` row with a future `effectiveFrom` changes what every offer
 * under its code resolves to from midnight on that day, and nothing is written
 * at midnight - so `part_cost` stays at the old rate until some unrelated
 * vendor-price edit happens to sweep the part. `recalculateAllPartCosts` has no
 * scheduled caller anywhere (29 §8), and the decision was NOT to give it one:
 * nothing in this subsystem revalues without a person, so the schedule screen
 * carries a button that does it on demand.
 *
 * The walk is the same one `recalculatePartCostForTariffRates` makes when a
 * rate row is written, minus the first join - every classified offer instead
 * of the offers under one code:
 *
 *     every vendor_part with a tariff_code -> its part -> recalculateAffectedParts
 *
 * ⚠️ Only the CLASSIFIED offers are walked, not every part in the org. An
 * offer with no code resolves to its override or to no duty, and neither of
 * those reads the schedule, so a rate row cannot have moved its part. The
 * calculator re-reads the whole offer anyway; an override on a classified
 * offer wins under 29 §3.1 and comes out unchanged.
 *
 * ⚠️ No first-standard write here, unlike the trigger path. A rate cannot give
 * an unpriced part a cost - `part_cost` needs a unit price first - so there is
 * no part this can cost for the first time, and the sweep that priced it has
 * already stamped its first standard. Reaching `ensureFirstStandardCosts` from
 * here would also put a static `bom -> builds` edge under the `builds -> bom`
 * one that already exists.
 *
 * No permission checks: the router asserts `part` edit, because `part` rows are
 * what this writes (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { recalculateAffectedParts } from './cost-calculator'

const logger = createScopedLogger('bom:apply-tariff-schedule')

export interface ApplyTariffScheduleResult {
  /** Live supplier offers that name a `tariff_code`. */
  classifiedOffers: number
  /** Distinct parts those offers price - the recalculation's scope. */
  affectedParts: number
  /** Parts whose stored cost actually moved, ancestors included. */
  changedPartIds: string[]
}

/**
 * Reprice every part with a classified supplier offer at today's schedule.
 *
 * Returns the empty result, not an error, when the org has no `vendor_part`
 * definition or the two fields are not materialised yet - an org
 * mid-migration reaches that, and there is nothing to apply.
 */
export async function applyTariffSchedule(
  db: Database,
  organizationId: string
): Promise<Result<ApplyTariffScheduleResult, Error>> {
  const empty: ApplyTariffScheduleResult = {
    classifiedOffers: 0,
    affectedParts: 0,
    changedPartIds: [],
  }

  const offerDefId = await getCachedEntityDefId(organizationId, 'vendor_part')
  if (!offerDefId) return ok(empty)

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['vendor_part_tariff_code', 'vendor_part_part'] as const)
  const codeField = fields.vendor_part_tariff_code
  const partField = fields.vendor_part_part
  if (!codeField || !partField) return ok(empty)

  const codeValue = alias(schema.FieldValue, 'offer_code')
  const partValue = alias(schema.FieldValue, 'offer_part')

  // Live offers only. An archived offer is skipped by the calculator, so
  // walking it would only widen the scope to parts whose cost then comes out
  // unchanged - the opposite call from the delete guards, which must count it.
  const rows = await db
    .select({ offerId: schema.EntityInstance.id, partId: partValue.relatedEntityId })
    .from(schema.EntityInstance)
    .innerJoin(
      codeValue,
      and(
        eq(codeValue.entityId, schema.EntityInstance.id),
        eq(codeValue.organizationId, schema.EntityInstance.organizationId),
        eq(codeValue.fieldId, codeField.id),
        isNotNull(codeValue.relatedEntityId)
      )
    )
    .innerJoin(
      partValue,
      and(
        eq(partValue.entityId, schema.EntityInstance.id),
        eq(partValue.organizationId, schema.EntityInstance.organizationId),
        eq(partValue.fieldId, partField.id)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, offerDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const offerIds = new Set<string>()
  const partIds = new Set<string>()
  for (const row of rows) {
    offerIds.add(row.offerId)
    if (row.partId) partIds.add(row.partId)
  }
  if (partIds.size === 0) {
    return ok({ ...empty, classifiedOffers: offerIds.size })
  }

  const changedPartIds = await recalculateAffectedParts(organizationId, [...partIds])

  logger.info('Applied the tariff schedule', {
    organizationId,
    classifiedOffers: offerIds.size,
    affectedParts: partIds.size,
    changedParts: changedPartIds.length,
  })

  return ok({
    classifiedOffers: offerIds.size,
    affectedParts: partIds.size,
    changedPartIds,
  })
}
