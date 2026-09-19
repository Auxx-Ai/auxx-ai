// packages/lib/src/accounting/purchasing/bill-intake/propose.ts

/**
 * `proposeBillLineLinks` (§3.5): the matcher run against a STORED bill's own
 * lines - the "Match lines" action on the page and the drawer's link card
 * (§6.5), and the only door a manually entered bill or an expired intake run
 * ever gets to the matcher through.
 *
 * Reads only. The router asserts view access on `vendor_bill` and calls in.
 */

import type { Database } from '@auxx/database'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId } from '../../../cache'
import { VENDOR_BILL_FIELDS } from '../../../resources/registry/resources/vendor-bill-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../../resources/system-records'
import { assignBillLines } from './assign'
import type { AssignOptions, LineProposal } from './client'
import { foldInvoiceNumber } from './duplicate'
import { guard } from './guard'
import { loadBillLineFacts } from './load-bill-lines'
import { loadOrderLineFacts } from './load-order-lines'

const BILL_NUMBER_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_FIELDS, [
  'vendor_bill_number',
] as const)

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

/**
 * The goods bill each printed reference names, index-aligned with the input
 * (73 §7.2: "intake proposes the goods bill from the invoice numbers it reads").
 *
 * A carrier's or broker's invoice cites the commercial invoice numbers of the
 * shipments it covers, and those are the vendor invoice numbers on our goods
 * bills — so the match is a fold-equal lookup on `vendor_bill_number`, org-wide
 * rather than vendor-scoped: the goods vendor is a different party from the one
 * sending this document.
 *
 * `null` for a blank reference, for no hit, and for MORE than one hit. Two
 * vendors may legitimately print the same invoice string (`duplicate.ts` §0.4),
 * and proposing one of them at random would link a duty line to the wrong
 * shipment — a wrong per-part landed cost that nothing downstream would flag.
 */
export async function proposeLandedBills(
  db: Database,
  organizationId: string,
  references: readonly (string | null | undefined)[]
): Promise<Result<(RecordId | null)[], Error>> {
  return guard(
    async () => {
      const wanted = new Set(
        references
          .map((reference) => (reference ? foldInvoiceNumber(reference) : ''))
          .filter((folded) => folded.length > 0)
      )
      if (wanted.size === 0) return references.map(() => null)

      const defId = await getCachedEntityDefId(organizationId, 'vendor_bill')
      if (!defId) return references.map(() => null)

      const ctx = await systemFields(db, organizationId, 'vendor_bill', BILL_NUMBER_ATTRIBUTES)
      if (!ctx?.fields.vendor_bill_number) return references.map(() => null)

      const bills = await readSystemRecords(db, organizationId, ctx)
      const byNumber = new Map<string, RecordId | 'ambiguous'>()
      for (const bill of bills) {
        const number = bill.text('vendor_bill_number')
        if (!number) continue
        const folded = foldInvoiceNumber(number)
        if (!wanted.has(folded)) continue
        byNumber.set(folded, byNumber.has(folded) ? 'ambiguous' : toRecordId(defId, bill.id))
      }

      return references.map((reference) => {
        const folded = reference ? foldInvoiceNumber(reference) : ''
        const hit = folded ? byNumber.get(folded) : undefined
        return hit && hit !== 'ambiguous' ? hit : null
      })
    },
    'Failed to propose the goods bill for a landed-cost line',
    { organizationId }
  )
}
