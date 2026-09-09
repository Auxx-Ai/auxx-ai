// packages/lib/src/field-hooks/pre/order-delete-guard.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { FULFILLMENT_SOURCE_TYPE } from '../../postings/build-fulfillment-entry'
import { listPostingsForSource } from '../../postings/list-postings'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `orders`. Fires inside `deleteEntity` for EVERY delete
 * path, so generic `record.delete`, bulk delete, the drawer, Kopilot and the API
 * all get the same answer.
 *
 * **One refusal: a fulfillment entry standing in a settled month.** A shipped
 * order posts revenue and COGS to the general ledger
 * (`postings/build-fulfillment-entry.ts`), and every line of that entry carries
 * `sourceType: 'order'` / `sourceId: <this order>`. Deleting the order out of a
 * month the books are closed to leaves those lines pointing at a record nobody
 * can open: the revenue stays in the statements forever with nothing that
 * explains it. "Settled" is `settledPeriodsFor` (`postings/settled-periods.ts`),
 * which owns the three predicates and the reason each one is needed, and is the
 * same threshold `parts`, `builds` and `purchase-orders` refuse on.
 *
 * **What is NOT here, and why.** The order's line items, credit memos and tax
 * lines are cascaded by the delete engine from the registry declarations
 * (`onDelete: 'cascade'` on `order_line_items`, `order_credit_memos` and
 * `order_tax_lines`), which is also what runs their lifecycle events and the
 * system record rules hanging off them. This hook used to delete the lines by
 * hand; it no longer touches a child row of any kind.
 *
 * **No admin gate**, following the `quotes` and `parts` precedent rather than
 * the `invoices` one: an order carries no payment ledger (`PaymentTransaction`
 * has no order FK) and no lifecycle transition with side effects, so the
 * per-row delete permission `record.delete` already asserts is the whole
 * authorization story. The accounting rule below is about the record's state,
 * not the caller's rank.
 */
export const guardOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: orderInstanceId } = parseRecordId(recordId)

  const dates = await readPostingDates(organizationId, orderInstanceId)
  if (dates.length === 0) return

  const settled = await settledPeriodsFor(organizationId, dates)
  if (settled.size > 0) {
    throw new BadRequestError(
      `This order has ${describeSettledPeriods(settled, 'ledger posting')}. ` +
        'A posted period is corrected by reversing an entry, never by deleting its history. ' +
        'Archive the order instead.',
      { organizationId, orderInstanceId, periods: [...settled.keys()] }
    )
  }
}

/**
 * The accounting date of every entry this order produced.
 *
 * Every row counts, `reversed` included, which is where this read differs from
 * `hasLiveInvoicePostings`. That read asks "is anything still owed against this
 * document?", where a reversal is the answer "no". This read asks "does a
 * closed month hold history that names this record?", and a reversed original
 * plus its reversal are two such entries, both explained only by the order they
 * name. (A `GlPosting` row only exists once the claim and its lines have
 * committed, so there is no "never reached the books" status to skip; see
 * `POSTING_STATUSES`.)
 *
 * `txnDate` is a Postgres `date`, a calendar day in the book's zone with no
 * time on it. It is placed at noon UTC before `settledPeriodsFor` derives the
 * month in that zone, so any book zone between UTC-11 and UTC+12 reads back
 * the same day. Midnight UTC would read `2026-08-01` as July in Los Angeles.
 */
async function readPostingDates(organizationId: string, orderInstanceId: string): Promise<Date[]> {
  const result = await listPostingsForSource(database, {
    organizationId,
    sourceType: FULFILLMENT_SOURCE_TYPE,
    sourceId: orderInstanceId,
  })
  // Fail closed. A guard that lets a delete through because it could not read
  // the ledger is no guard at all.
  if (result.isErr()) throw result.error

  return result.value.map((posting) => new Date(`${posting.txnDate}T12:00:00Z`))
}
