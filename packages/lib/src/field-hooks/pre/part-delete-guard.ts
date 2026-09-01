// packages/lib/src/field-hooks/pre/part-delete-guard.ts

import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'
import { type GuardedMovement, readMovementsByRelation } from './guarded-movements'
import { findRelatedInstanceIds } from './related-rows'

/**
 * Pre-delete guard for `parts` (plans/money/tasks/20-part-delete-safety.md).
 * Fires inside `deleteEntity` for EVERY delete path — generic `record.delete`,
 * bulk delete, drawers, Kopilot and the API — because `parts` is
 * `isVisible: true` and therefore carries an ordinary records table with an
 * ordinary delete button that no money code has ever seen.
 *
 * Three dispositions, one per class of child (§2 of the brief):
 *
 *   1. **`stock_movement` — REFUSE when the period is settled, else cascade.**
 *      "Settled" is `settledPeriodsFor` (`postings/settled-periods.ts`), which
 *      owns the three predicates and the reason each one is needed.
 *      The movement ledger is append-only and a mistake is corrected by
 *      reversing, never by editing, so hard-deleting the ledger's SUBJECT after
 *      it has been posted is an accounting problem rather than a referential
 *      one. `part_quantity_on_hand` also lives on the part, so the running total
 *      vanishes while the ledger it summarises stays.
 *   2. **`subpart` + `vendor_part` — CASCADE.** A BOM row is `(parent, child,
 *      qty)` with no meaning once an end is gone — `subparts` even projects its
 *      `displayName` FROM the child part, so a survivor renders as nothing at
 *      all — and a supplier price for a part that does not exist prices nothing.
 *   3. **`purchase_order_line`, `vendor_bill_line`, `catalog_item`, `line_item`
 *      — LEAVE.** These are somebody else's document. A vendor really did bill
 *      us for that thing, and a bill's totals are transcribed, never computed
 *      (`docs/inventory-costing-architecture-guide.md`). They survive with an
 *      empty part cell, which is correct and not a defect.
 *
 * **Why the cascade goes through `UnifiedCrudHandler.delete` and not raw SQL.**
 * `mfg-subparts-deleted`, `mfg-vendor-parts-deleted` and
 * `mfg-stock-movements-deleted` already exist as system record rules, and each
 * recomputes a roll-up on a SURVIVING parent. Deleting through the handler is
 * what makes them fire, and it is the whole integration — this task adds no rule
 * of its own.
 *
 * ⚠️ **Nothing is suppressed here**, which is where this guard differs from the
 * invoice and order ones. Those pass `suppressPostDeleteHooks` because their
 * hook re-projects the very document being deleted; here the recompute lands on
 * a DIFFERENT, surviving part, and suppressing it is precisely the bug this
 * guard exists to fix (see {@link cascadeBomRows}).
 *
 * **No admin gate**, following the `orders`/`quotes` precedent rather than the
 * `invoices` one: a part carries no payment ledger and no RESTRICT foreign key,
 * so the per-row permission `record.delete` already asserts is the whole
 * authorization story.
 */
export const guardPartDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const { entityInstanceId: partInstanceId } = parseRecordId(recordId)

  // Refuse BEFORE any cascade, so a rejected delete mutates nothing.
  const movements = await readMovementsByRelation(organizationId, 'stock_movement_part', [
    partInstanceId,
  ])
  if (movements.length > 0) {
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

  const handler = new UnifiedCrudHandler(organizationId, userId)
  await cascadeBomRows(handler, organizationId, recordId)
  await cascadeSupplierPricing(handler, organizationId, recordId)
  await cascadeMovements(handler, movements)
}

/**
 * The refusal a user reads. Names the months and the counts, and points at
 * archive — which is what `deleteEntityInstance`'s own docblock recommends over
 * deletion anyway, and which loses nothing.
 */
function describeRefusal(settled: Map<string, number>): string {
  return (
    `This part has ${describeSettledPeriods(settled, 'stock movement')}. ` +
    `A posted period is corrected by reversing an entry, never by deleting its history — ` +
    `archive the part instead.`
  )
}

// =============================================================================
// CASCADES
// =============================================================================

/**
 * The BOM rows on both ends.
 *
 * ✅ **This fixes a live bug rather than merely tidying up.** Deleting a
 * component part today leaves its `subpart` rows alive, so
 * `mfg-subparts-deleted` never fires and **every parent assembly's rolled cost
 * goes stale permanently**. Cascading is what makes the existing rule do its
 * job, which is also why nothing here is suppressed.
 *
 * Two queries rather than one OR group: `parentPart` and `childPart` are
 * different relations answering different questions, and a part is routinely
 * both. Ids are de-duplicated before deletion so a part that is its own
 * assembly's component is not deleted twice.
 */
async function cascadeBomRows(
  handler: UnifiedCrudHandler,
  organizationId: string,
  partRecordId: RecordId
): Promise<void> {
  const { entityInstanceId } = parseRecordId(partRecordId)
  // Archived rows are collected too — see `related-rows.ts`. A subpart left
  // behind by its part is nameless (the display cascade nulls it) and keeps its
  // parent's rolled cost stale forever, archived or not.
  const ids = new Set<string>()
  for (const attribute of ['subpart_parent_part', 'subpart_child_part'] as const) {
    for (const id of await findRelatedInstanceIds(organizationId, 'subpart', attribute, [
      entityInstanceId,
    ])) {
      ids.add(id)
    }
  }

  for (const id of ids) {
    await handler.delete(toRecordId('subpart', id))
  }
}

/** Supplier prices. A price for a part that does not exist prices nothing. */
async function cascadeSupplierPricing(
  handler: UnifiedCrudHandler,
  organizationId: string,
  partRecordId: RecordId
): Promise<void> {
  const ids = await findRelatedInstanceIds(organizationId, 'vendor_part', 'vendor_part_part', [
    parseRecordId(partRecordId).entityInstanceId,
  ])

  for (const id of ids) {
    await handler.delete(toRecordId('vendor_part', id))
  }
}

/**
 * The movements, once every one of them is known to sit in an open period.
 *
 * Deleted one at a time through the handler so `mfg-stock-movements-deleted`
 * fires per row: `recalculatePartQoH` (a no-op for the dying part, but correct
 * for a BOM explosion child pointing at a surviving one) and
 * `recalculatePurchaseOrderLineReceived`, which is what keeps a SURVIVING
 * purchase order line's received quantity honest after its receipts go.
 *
 * ⚠️ Each of those handlers re-SUMs whole, so this is deliberately O(movements)
 * round trips rather than one bulk statement. A part with a long history is
 * exactly the part this guard refuses to delete, so the loop stays short in
 * practice — and a bulk delete that skipped the roll-ups would leave the
 * purchase order lines this guard just decided to KEEP holding a phantom
 * received quantity, which is worse than the round trips.
 */
async function cascadeMovements(
  handler: UnifiedCrudHandler,
  movements: readonly GuardedMovement[]
): Promise<void> {
  for (const movement of movements) {
    await handler.delete(toRecordId('stock_movement', movement.id))
  }
}
