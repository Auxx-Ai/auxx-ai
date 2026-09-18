// packages/lib/src/field-hooks/pre/order-delete-guard.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { listPostingsForSource } from '../../postings/list-postings'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `orders`. Fires inside `deleteEntity` for EVERY delete
 * path, so generic `record.delete`, bulk delete, the drawer, Kopilot and the API
 * all get the same answer.
 *
 * **Two refusals, and they are about different things.**
 *
 * 1. **A ledger entry standing in a SETTLED month.** A shipped order posts
 *    revenue to the general ledger, and deleting the order out of a month the
 *    books are closed to leaves those lines pointing at a record nobody can
 *    open: the revenue stays in the statements forever with nothing that
 *    explains it. "Settled" is `settledPeriodsFor` (`postings/settled-periods.ts`).
 * 2. **A LIVE posting**, whatever the period. Recognised revenue is corrected
 *    by reversing the entry, never by deleting the record it was recognised
 *    from. Reversing first is not a formality: it is what frees the
 *    fulfillment's claim to post again (TARGET §1).
 *
 * One read answers both: `listPostingsForSource(sourceKind: 'order')` finds
 * every posting that names this order, whatever its link role - a fulfillment
 * posting's `parent` row among them (TARGET §1's "one query" promise). There is
 * no second, stamp-based read any more: `GlPostingSource` is the only index.
 *
 * **What is NOT here, and why.** The order's line items, credit memos and tax
 * lines are cascaded by the delete engine from the registry declarations
 * (`onDelete: 'cascade'` on `order_line_items`, `order_credit_memos` and
 * `order_tax_lines`), which is also what runs their lifecycle events and the
 * system record rules hanging off them. This hook used to delete the lines by
 * hand; it no longer touches a child row of any kind.
 *
 * **No admin gate**, following the `quotes` and `parts` precedent rather than
 * the `invoices` one: an order carries no payment ledger and no lifecycle
 * transition with side effects, so the per-row delete permission `record.delete`
 * already asserts is the whole authorization story. The accounting rules below
 * are about the record's state, not the caller's rank.
 */
export const guardOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: orderInstanceId } = parseRecordId(recordId)

  const result = await listPostingsForSource(database, {
    organizationId,
    sourceKind: 'order',
    sourceId: orderInstanceId,
  })
  // Fail closed. A guard that lets a delete through because it could not read
  // the ledger is no guard at all.
  if (result.isErr()) throw result.error
  const postings = result.value
  if (postings.length === 0) return

  const dates = postings.map((posting) => noonUtc(posting.txnDate))
  const settled = await settledPeriodsFor(organizationId, dates)
  if (settled.size > 0) {
    throw new BadRequestError(
      `This order has ${describeSettledPeriods(settled, 'ledger posting')}. ` +
        'A posted period is corrected by reversing an entry, never by deleting its history. ' +
        'Archive the order instead.',
      { organizationId, orderInstanceId, periods: [...settled.keys()] }
    )
  }

  // Checked SECOND, on purpose. A settled period is the terminal answer -
  // archive, and stop - while a live posting in an open month has a remedy the
  // person can actually carry out. Naming the reversible one first would send
  // them to reverse an entry the ledger will not let them reverse.
  const live = postings.filter((posting) => posting.status !== 'reversed')
  if (live.length > 0) {
    const names = live.map((posting) => posting.docNumber || posting.id).join(', ')
    throw new BadRequestError(
      `This order names ${live.length} ledger ` +
        `${live.length === 1 ? 'entry' : 'entries'} that ${live.length === 1 ? 'is' : 'are'} ` +
        `still standing: ${names}. Recognised revenue is corrected by reversing the entry, never ` +
        'by deleting the order it was recognised from - the entry would stay in the statements ' +
        'with nothing left to explain it. Reverse the entry first, or archive the order instead.',
      {
        organizationId,
        orderInstanceId,
        docNumbers: live.map((posting) => posting.docNumber || posting.id),
      }
    )
  }
}

/** A calendar `date` column, placed at noon UTC so every book zone reads the same day. */
function noonUtc(txnDate: string): Date {
  return new Date(`${txnDate}T12:00:00Z`)
}
