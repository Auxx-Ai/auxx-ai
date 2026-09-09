// packages/lib/src/field-hooks/pre/order-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { listOrderFulfillmentPostings } from '../../money/fulfillment-posting/reads'
import type { OrderFulfillmentPostingRef } from '../../money/fulfillment-posting/types'
import { FULFILLMENT_SOURCE_TYPE } from '../../postings/build-fulfillment-entry'
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
 *    explains it. "Settled" is `settledPeriodsFor`
 *    (`postings/settled-periods.ts`), which owns the three predicates and is the
 *    same threshold `parts`, `builds` and `purchase-orders` refuse on.
 * 2. **A LIVE posting stamped on the shipment log**, whatever the period
 *    (`plans/money/tasks/49-bulk-fulfillment-posting.md` §6 and decision 8).
 *    Recognised revenue is corrected by reversing the entry, never by deleting
 *    the record it was recognised from. Reversing first is not a formality: it
 *    is what puts the shipments back into the next bulk preview.
 *
 * 🛑 **Both halves have to read the STAMP, not only the source lines.** A bulk
 * fulfillment entry summarises: only the A/R leg of a terms order carries
 * `sourceType: 'order'` / `sourceId: <this order>`, while clearing, revenue, tax
 * and shipping post under `sourceType: 'fulfillment_batch'` keyed on the period
 * (§2.5, §8.2). So `listPostingsForSource` finds NOTHING for a paid Shopify
 * order that is perfectly well posted, and a guard built on it alone would let
 * a posted order be deleted out of a closed month - the exact hole it exists to
 * close. The stamped posting ids are therefore read too, and their `txnDate`s
 * join the settled-period test.
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
 * authorization story. The accounting rules below are about the record's state,
 * not the caller's rank.
 */
export const guardOrderDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: orderInstanceId } = parseRecordId(recordId)

  const [sourceDates, stamps] = await Promise.all([
    readSourcePostingDates(organizationId, orderInstanceId),
    readStampedPostings(organizationId, orderInstanceId),
  ])

  const dates = [...sourceDates, ...stamps.map((stamp) => stamp.txnDate)]
  if (dates.length > 0) {
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

  // Checked SECOND, on purpose. A settled period is the terminal answer -
  // archive, and stop - while a live posting in an open month has a remedy the
  // person can actually carry out. Naming the reversible one first would send
  // them to reverse an entry the ledger will not let them reverse.
  const live = stamps.filter((stamp) => stamp.status !== 'reversed')
  if (live.length > 0) {
    const names = live.map((stamp) => stamp.docNumber ?? stamp.glPostingId).join(', ')
    throw new BadRequestError(
      `This order's shipment log names ${live.length} ledger ` +
        `${live.length === 1 ? 'entry' : 'entries'} that ${live.length === 1 ? 'is' : 'are'} ` +
        `still standing: ${names}. Recognised revenue is corrected by reversing the entry, never ` +
        'by deleting the order it was recognised from - the entry would stay in the statements ' +
        'with nothing left to explain it. Reverse the entry first, or archive the order instead.',
      {
        organizationId,
        orderInstanceId,
        docNumbers: live.map((stamp) => stamp.docNumber ?? stamp.glPostingId),
      }
    )
  }
}

/**
 * The accounting date of every entry whose LINES name this order.
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
async function readSourcePostingDates(
  organizationId: string,
  orderInstanceId: string
): Promise<Date[]> {
  const result = await listPostingsForSource(database, {
    organizationId,
    sourceType: FULFILLMENT_SOURCE_TYPE,
    sourceId: orderInstanceId,
  })
  // Fail closed. A guard that lets a delete through because it could not read
  // the ledger is no guard at all.
  if (result.isErr()) throw result.error

  return result.value.map((posting) => noonUtc(posting.txnDate))
}

/** One posting the order's own shipment log names, with the date it is dated to. */
interface StampedPosting extends OrderFulfillmentPostingRef {
  txnDate: Date
}

/**
 * The postings the order's shipment log STAMPS, with each one's current status
 * and accounting date.
 *
 * A batch entry's `txnDate` is the latest ship date in its group, which for a
 * week or month grouping is NOT this order's own ship date and can fall in a
 * different month. So the date is read off the posting rather than derived from
 * the log, or a shipment on July 31 inside a `2026-W31` posting dated August 2
 * would be tested against the wrong month.
 */
async function readStampedPostings(
  organizationId: string,
  orderInstanceId: string
): Promise<StampedPosting[]> {
  const result = await listOrderFulfillmentPostings(database, {
    organizationId,
    orderId: orderInstanceId,
  })
  // Fail closed, for the reason above.
  if (result.isErr()) throw result.error
  const refs = result.value
  if (refs.length === 0) return []

  const rows = await database
    .select({ id: schema.GlPosting.id, txnDate: schema.GlPosting.txnDate })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(
          schema.GlPosting.id,
          refs.map((ref) => ref.glPostingId)
        )
      )
    )
  const dateById = new Map(rows.map((row) => [row.id, row.txnDate]))

  return refs.flatMap((ref) => {
    const txnDate = dateById.get(ref.glPostingId)
    // `listOrderFulfillmentPostings` already dropped stamps whose posting is
    // gone, so this is unreachable; dropping rather than defaulting keeps it
    // from inventing a date if it ever stops being.
    return txnDate ? [{ ...ref, txnDate: noonUtc(txnDate) }] : []
  })
}

/** A calendar `date` column, placed at noon UTC so every book zone reads the same day. */
function noonUtc(txnDate: string): Date {
  return new Date(`${txnDate}T12:00:00Z`)
}
