// packages/lib/src/purchasing/bill-intake/propose.ts

/**
 * `proposeBillLineLinks` (§3.5): the matcher run against a STORED bill's own
 * lines - the "Match lines" action on the page and the drawer's link card
 * (§6.5), and the only door a manually entered bill or an expired intake run
 * ever gets to the matcher through.
 *
 * Reads only. The router asserts view access on `vendor_bill` and calls in.
 */

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { assignBillLines } from './assign'
import type { AssignOptions, LineProposal } from './client'
import { loadBillLineFacts } from './load-bill-lines'
import { loadOrderLineFacts } from './load-order-lines'

/** The matcher's answer for every line of one stored bill. */
export interface BillLineProposals {
  purchaseOrderRecordId: RecordId | null
  proposals: LineProposal[]
}

/**
 * Load a bill's own lines, load its order's lines (if any), and run the
 * matcher.
 *
 * A bill with no `purchaseOrder` gets every line proposed `none`: there is no
 * pool to match against, which is a legal, common state (a freight invoice, a
 * one-off, a utility bill), not a failure. Lines that already carry a
 * `purchaseOrderLine` are still returned - the card decides what to show for
 * an already-linked line, this function only proposes.
 */
export async function proposeBillLineLinks(
  db: Database,
  organizationId: string,
  vendorBillRecordId: RecordId,
  options?: AssignOptions
): Promise<Result<BillLineProposals, Error>> {
  const billResult = await loadBillLineFacts(db, organizationId, vendorBillRecordId)
  if (billResult.isErr()) return err(billResult.error)
  const bill = billResult.value

  if (!bill.purchaseOrderRecordId) {
    return ok({
      purchaseOrderRecordId: null,
      proposals: assignBillLines(bill.lines, [], options),
    })
  }

  const orderLinesResult = await loadOrderLineFacts(db, organizationId, bill.purchaseOrderRecordId)
  if (orderLinesResult.isErr()) return err(orderLinesResult.error)

  return ok({
    purchaseOrderRecordId: bill.purchaseOrderRecordId,
    proposals: assignBillLines(bill.lines, orderLinesResult.value, options),
  })
}
