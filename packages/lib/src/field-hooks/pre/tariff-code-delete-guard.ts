// packages/lib/src/field-hooks/pre/tariff-code-delete-guard.ts

import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'
import { findRelatedInstanceIds } from './related-rows'

/**
 * Pre-delete guard for `tariff-codes` (plans/money/tasks/30-tariff-offer-surfaces.md §9.1).
 *
 * `tariff_code` is `isVisible: true`, so it carries an ordinary records table
 * with an ordinary row delete and bulk delete - the same combination that
 * shipped `parts` unguarded (task 20). Deleting a code leaves every
 * `vendor_part.tariffCode` pointing at nothing, which `resolveOfferTariff`
 * reads as `none`: **duty silently drops to zero on every offer that used it**,
 * and `part_cost` follows on the next recalculation with nothing thrown.
 *
 * Two dispositions:
 *
 *   1. **Supplier offers - REFUSE.** A classification is a deliberate act and
 *      undoing it should be too. Cascading the pointer to null would be the
 *      silent zero above with one extra step. The refusal names the count and
 *      points at the Classification tab, which is where reclassifying happens.
 *   2. **Rate rows - CASCADE.** A `tariff_rate` with no code is meaningless -
 *      its display name is projected FROM the code - so they go with it. Deleted
 *      through `UnifiedCrudHandler.delete` so `mfg-tariff-rates-deleted` fires;
 *      with no offers left on the code it finds nothing to reprice, which is
 *      correct.
 *
 * Archived offers count (see `related-rows.ts`): archiving is the sanctioned
 * way to retire an offer, so an archived offer cannot also mean "nothing depends
 * on this code any more".
 *
 * No admin gate, following `parts`: a code carries no ledger and no RESTRICT
 * foreign key, so the per-row `record.delete` the mutation already asserts is
 * the whole authorization story.
 */
export const guardTariffCodeDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const { entityInstanceId: codeInstanceId } = parseRecordId(recordId)

  const offerIds = await findRelatedInstanceIds(
    organizationId,
    'vendor_part',
    'vendor_part_tariff_code',
    [codeInstanceId]
  )
  if (offerIds.length > 0) {
    const noun = offerIds.length === 1 ? 'supplier price is' : 'supplier prices are'
    throw new BadRequestError(
      `${offerIds.length} ${noun} classified under this tariff code. Reclassify them first ` +
        '(Parts > Settings > Tariffs > Classification), or archive the code instead of deleting it.',
      { organizationId, codeInstanceId, offerCount: String(offerIds.length) }
    )
  }

  const rateIds = await findRelatedInstanceIds(
    organizationId,
    'tariff_rate',
    'tariff_rate_tariff_code',
    [codeInstanceId]
  )
  if (rateIds.length === 0) return

  const handler = new UnifiedCrudHandler(organizationId, userId)
  for (const id of rateIds) {
    await handler.delete(toRecordId('tariff_rate', id))
  }
}
