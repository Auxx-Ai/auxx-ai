// packages/lib/src/field-hooks/pre/part-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'

/**
 * Pre-delete guard for `parts` (plans/money/tasks/20-part-delete-safety.md).
 * Fires inside `deleteEntity` for EVERY delete path, generic `record.delete`,
 * bulk delete, drawers, Kopilot and the API, because `parts` is
 * `isVisible: true` and therefore carries an ordinary records table with an
 * ordinary delete button that no money code has ever seen.
 *
 * **One refusal: a stock movement in a settled period.** "Settled" is
 * `settledPeriodsFor` (`postings/settled-periods.ts`), which owns the three
 * predicates and the reason each one is needed. The movement ledger is
 * append-only and a mistake is corrected by reversing, never by editing, so
 * hard-deleting the ledger's SUBJECT after it has been posted is an accounting
 * problem rather than a referential one. `part_quantity_on_hand` also lives on
 * the part, so the running total would vanish while the ledger it summarises
 * stays.
 *
 * Archived movements count. `readMovementsByRelation` applies no
 * `archivedAt` predicate on purpose: an archived movement is still in the
 * ledger and still under whatever entry was filed for its month.
 *
 * **What is NOT here, and why.** Everything else deleting a part used to do by
 * hand is now declared on the registry and run by the delete engine:
 *
 *   - `part_stock_movements`, `part_subparts`, `part_used_in_assemblies` and
 *     `part_vendor_parts` carry `onDelete: 'cascade'`. The engine collects the
 *     closure, runs this guard over the movements before writing anything, and
 *     publishes a lifecycle event per cascaded row, so `mfg-subparts-deleted`,
 *     `mfg-vendor-parts-deleted` and `mfg-stock-movements-deleted` still fire
 *     and still recompute their roll-ups on the SURVIVING parent.
 *   - `purchase_order_line`, `vendor_bill_line`, `catalog_item` and `line_item`
 *     carry `onDelete: 'unlink'`. Those are somebody else's document: a vendor
 *     really did bill us for that thing, and a bill's totals are transcribed,
 *     never computed (`docs/inventory-costing-architecture-guide.md`). They
 *     survive with an empty part cell, which is correct and not a defect.
 *
 * **No admin gate**, following the `orders`/`quotes` precedent rather than the
 * `invoices` one: a part carries no payment ledger and no RESTRICT foreign key,
 * so the per-row permission `record.delete` already asserts is the whole
 * authorization story.
 */
export const guardPartDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: partInstanceId } = parseRecordId(recordId)

  const movements = await readMovementsByRelation(organizationId, 'stock_movement_part', [
    partInstanceId,
  ])
  if (movements.length === 0) return

  const settled = await settledPeriodsFor(
    organizationId,
    movements.map((movement) => movement.accountingDate)
  )
  if (settled.size > 0) {
    throw new BadRequestError(describeRefusal(settled), {
      organizationId,
      partInstanceId,
      periods: [...settled.keys()],
    })
  }
}

/**
 * The refusal a user reads. Names the months and the counts, and points at
 * archive, which is what `deleteEntityInstance`'s own docblock recommends over
 * deletion anyway, and which loses nothing.
 */
function describeRefusal(settled: Map<string, number>): string {
  return (
    `This part has ${describeSettledPeriods(settled, 'stock movement')}. ` +
    'A posted period is corrected by reversing an entry, never by deleting its history. ' +
    'Archive the part instead.'
  )
}
