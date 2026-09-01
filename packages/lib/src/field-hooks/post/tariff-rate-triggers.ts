// packages/lib/src/field-hooks/post/tariff-rate-triggers.ts

import { createScopedLogger } from '@auxx/logger'
import { unwrapRelationId } from '../../resources/events/captured-values'
import { findRelatedInstanceIds } from '../pre/related-rows'
import { batchResolvePartIds, recalculatePartCostsForParts } from './bom-cost-triggers'

const logger = createScopedLogger('field-hooks:tariff-rate')

/**
 * Recalculate every part whose replacement cost a `tariff_rate` write moved
 * (29 §7, 30 §10 phase A).
 *
 * The widening is two joins deeper than `recalculatePartCost`'s, which is why
 * this is its own function rather than a third prefix branch there:
 *
 *     tariff_rate -> tariff_code -> every vendor_part pointing at that code
 *                 -> each offer's part -> recalculateAffectedParts
 *
 * Only offers with NO override are actually repriced by the calculator (a set
 * `vendor_part_tariff_rate` wins under 29 §3.1), but the walk does not filter
 * on that: the calculator re-reads the whole offer anyway, and a recalc that
 * changes nothing is cheaper than a second query to avoid it.
 *
 * `values` is the create/delete-time capture when the dispatching door had one
 * (a lifecycle firing); a field-change firing has none and the code is read
 * from the row, which soft-archive keeps, so a deleted rate still resolves.
 */
export async function recalculatePartCostForTariffRates(params: {
  organizationId: string
  rateInstanceIds: readonly string[]
  values?: Record<string, Record<string, unknown> | undefined>
}): Promise<void> {
  const { organizationId, rateInstanceIds, values } = params
  if (rateInstanceIds.length === 0) return

  const codeIds = new Set<string>()
  const missing: string[] = []
  for (const rateId of rateInstanceIds) {
    const threaded = unwrapRelationId(values?.[rateId]?.tariff_rate_tariff_code)
    if (threaded) codeIds.add(threaded)
    else missing.push(rateId)
  }
  if (missing.length > 0) {
    for (const id of await batchResolvePartIds(
      missing,
      organizationId,
      'tariff_rate_tariff_code'
    )) {
      codeIds.add(id)
    }
  }
  if (codeIds.size === 0) {
    logger.warn('Could not resolve a tariff code for any changed rate', {
      organizationId,
      rateCount: rateInstanceIds.length,
    })
    return
  }

  // Archived offers come back too (see `related-rows.ts`). Harmless here: the
  // calculator skips archived instances, so the extra ids only widen the recalc
  // to parts whose cost then comes out unchanged.
  const offerIds = await findRelatedInstanceIds(
    organizationId,
    'vendor_part',
    'vendor_part_tariff_code',
    [...codeIds]
  )
  if (offerIds.length === 0) return

  const partIds = await batchResolvePartIds(offerIds, organizationId, 'vendor_part_part')
  if (partIds.length === 0) return

  logger.info('Recalculating part costs from a tariff schedule change', {
    organizationId,
    codes: codeIds.size,
    offers: offerIds.length,
    affectedParts: partIds.length,
  })
  await recalculatePartCostsForParts(organizationId, partIds)
}
