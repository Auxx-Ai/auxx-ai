// packages/lib/src/field-hooks/pre/order-delete-guard.ts

import { toRecordId } from '@auxx/types/resource'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete cleanup for `orders` (plans/products/08-order-build.md §5.4, following
 * plans/dispatch/money/12-delete-safety.md §A). Deletes the order's own line items so a
 * deleted order does not leave them behind.
 *
 * **Why a cascade and not a guard.** An order line has no life of its own: nothing converts
 * an order into another document, nothing copies an order line anywhere, and
 * `resolveLineParentDocument` (`money/totals-hooks.ts`) records the invariant that "an order
 * line is never also a quote or invoice line". Left alone, deleting an order strips only the
 * `line_item_order` mirror row (`sweepEntityFieldValues`) and the lines survive attached to
 * no document at all — invisible in every surface, since each is document-scoped, but still
 * rows that every `line_item` query counts. That is the state `quote-delete-guard.ts`
 * explicitly deferred ("quote line items dangle like today"); an order does not inherit it.
 *
 * **No admin gate**, following the quote precedent rather than the invoice one: an order
 * carries no payments (`PaymentTransaction` has no order FK) and no lifecycle transition with
 * side effects, so the per-row delete permission `record.delete` already asserts is the whole
 * authorization story.
 */
export const cascadeOrderLinesOnDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const handler = new UnifiedCrudHandler(organizationId, userId)

  // `workOrder empty` mirrors the §B.3 invariant the invoice guard enforces. Nothing writes
  // both relations today, but a work-order-sourced line is the one line whose deletion would
  // be destructive and unrecoverable, so the order never claims it.
  const { ids: ownLineIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'order-own-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'order-own-lines-order',
            fieldId: 'line_item:order',
            operator: 'is',
            value: recordId,
          },
          {
            id: 'order-own-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'empty',
            value: null,
          },
        ],
      },
    ],
    limit: 1000,
  })

  for (const lineInstanceId of ownLineIds) {
    // Suppress the line-level billing post-delete hook: it re-projects the line's parent
    // document, which is the order currently being deleted, once per line.
    await handler.delete(toRecordId('line_item', lineInstanceId), {
      suppressPostDeleteHooks: true,
    })
  }
}
