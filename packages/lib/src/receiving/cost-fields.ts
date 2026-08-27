// packages/lib/src/receiving/cost-fields.ts

/**
 * The one pre-flight every COSTED movement writer shares: are the cost fields
 * entity migration 108 introduced actually materialised for this org?
 *
 * Extracted from `receive-stock.ts` when `adjust-stock.ts` needed the identical
 * check (plans/purchasing/05-receiving-cost-and-corrections.md section 1.5).
 * Copying it would have given the invariant two homes, and the whole point of
 * that section is that a rule enforced on some writers and not others reads as
 * enforced while it is not.
 */

import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'

/** The two attributes without which a cost cannot be expressed at all. */
const REQUIRED_COST_ATTRIBUTES = ['stock_movement_unit_cost', 'stock_movement_cost_basis'] as const

/**
 * Fail early when entity migration 108 has not run for this org.
 *
 * Without `stock_movement_unit_cost` the write would still succeed and would
 * produce exactly the thing the zero-cost rule forbids: a movement that claims
 * to carry a cost and carries none. Refusing here means the org sees "this is
 * not set up" instead of silently accumulating unpostable rows.
 *
 * The message is a parameter because the two callers are different doors and a
 * person told "receiving is not available" while adjusting stock would look for
 * the wrong thing. The default is `receiveStock`'s original wording, unchanged.
 */
export async function assertCostFieldsMaterialized(
  organizationId: string,
  message = 'Receiving is not available until the stock movement cost fields are provisioned'
): Promise<void> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...REQUIRED_COST_ATTRIBUTES])
  if (!fields.stock_movement_unit_cost || !fields.stock_movement_cost_basis) {
    throw new UnprocessableEntityError(message)
  }
}
