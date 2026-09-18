// packages/lib/src/purchasing/bill-intake/load-bill-lines.ts

/**
 * What the matcher is fed from a STORED bill (§3.5): the bill's header and its
 * lines, read through `readSystemRecords` the way `expense-bill/reads.ts` reads
 * a bill for posting. This is the "Match lines" door - the page's action on a
 * bill that was entered by hand or whose intake run has long since expired.
 *
 * Reads only, no actor. The router asserts view access on `vendor_bill` and
 * calls in.
 */

import type { Database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../resources/registry/resources/vendor-bill-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { getInstanceId } from '../../resources/resource-id'
import {
  readSystemRecords,
  requireSystemFields,
  systemFields,
} from '../../resources/system-records'
import type { BillLineFacts } from './client'
import { guard } from './guard'

/** Every `vendor_bill` header attribute this loader reads. */
const BILL_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_FIELDS, [
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
  'vendor_bill_currency',
  'vendor_bill_lines',
] as const)

/**
 * Every `vendor_bill_line` attribute this loader reads.
 *
 * 🛑 `vendor_bill_line_vendor_code` does not exist in every org yet - entity
 * migration 159 (plans/money/tasks/58 §7.1) adds it. `systemFields` answers
 * `null` for a field the org lacks rather than throwing, so a line's vendor
 * code simply reads as `null` on an org that has not migrated yet. Nothing
 * here special-cases it beyond that.
 */
const LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_LINE_FIELDS, [
  'vendor_bill_line_vendor_code',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_sort_order',
] as const)

/** One bill line, as the matcher sees it, plus the identity the write needs. */
export interface StoredBillLineFacts extends BillLineFacts {
  lineRecordId: RecordId
  purchaseOrderLineRecordId: RecordId | null
}

/** One stored bill's header and lines, ready for `assignBillLines`. */
export interface BillLineFactsLoad {
  vendorBillInstanceId: string
  vendorRecordId: RecordId | null
  purchaseOrderRecordId: RecordId | null
  currency: string
  lines: StoredBillLineFacts[]
}

/**
 * Read one bill and its lines.
 *
 * `customerCode` is always `null` here: a stored line carries no "buyer's own
 * part number" field, only the vendor's own printed code (§7.1) - the buyer
 * code exists only on the transcription at read time (§3.5).
 */
export async function loadBillLineFacts(
  db: Database,
  organizationId: string,
  vendorBillRecordId: RecordId
): Promise<Result<BillLineFactsLoad, Error>> {
  return guard(
    async () => {
      const vendorBillInstanceId = parseRecordId(vendorBillRecordId).entityInstanceId

      const billCtx = await requireSystemFields(db, organizationId, 'vendor_bill', BILL_ATTRIBUTES)
      const [bill] = await readSystemRecords(db, organizationId, billCtx, {
        ids: [vendorBillInstanceId],
      })
      if (!bill) throw new NotFoundError('Vendor bill not found', { vendorBillRecordId })

      // A relationship cell carries the whole `RecordId`, so the def ids the
      // matcher needs no longer cost a cache lookup each.
      const vendorRecordId = bill.cell('vendor_bill_vendor')
      const purchaseOrderRecordId = bill.cell('vendor_bill_purchase_order')
      const lineIds = bill
        .cells('vendor_bill_lines')
        .map((value) =>
          value.type === 'relationship' && value.recordId ? getInstanceId(value.recordId) : null
        )
        .filter((id): id is string => !!id)

      const lines = await loadLines(db, organizationId, lineIds)

      return {
        vendorBillInstanceId,
        vendorRecordId: relatedRecordId(vendorRecordId),
        purchaseOrderRecordId: relatedRecordId(purchaseOrderRecordId),
        currency: bill.text('vendor_bill_currency') ?? '',
        lines,
      }
    },
    'Failed to load vendor bill line facts',
    { organizationId, vendorBillRecordId }
  )
}

/** The bill's live lines, in `sortOrder` order. */
async function loadLines(
  db: Database,
  organizationId: string,
  lineIds: string[]
): Promise<StoredBillLineFacts[]> {
  if (lineIds.length === 0) return []
  const ctx = await systemFields(db, organizationId, 'vendor_bill_line', LINE_ATTRIBUTES)
  if (!ctx) return []

  const records = await readSystemRecords(db, organizationId, ctx, { ids: lineIds })
  const byId = new Map(records.map((record) => [record.id, record]))

  const ranked = lineIds
    .map((lineId) => byId.get(lineId))
    .filter((line) => line !== undefined)
    .map((line) => {
      // Per §3.5: `lineId` is the line's RecordId string on the stored door,
      // where it doubles as `lineRecordId` - unlike the transcription door,
      // where `lineId` is only the array index (`propose.ts`).
      const fact: StoredBillLineFacts = {
        lineId: line.recordId,
        lineRecordId: line.recordId,
        purchaseOrderLineRecordId: relatedRecordId(
          line.cell('vendor_bill_line_purchase_order_line')
        ),
        vendorCode: line.text('vendor_bill_line_vendor_code'),
        customerCode: null,
        description: line.text('vendor_bill_line_description'),
        quantity: line.number('vendor_bill_line_quantity_billed'),
        unitPriceCents: line.number('vendor_bill_line_unit_price'),
      }
      return { fact, sortKey: line.number('vendor_bill_line_sort_order') ?? 0 }
    })

  return ranked.sort((a, b) => a.sortKey - b.sortKey).map(({ fact }) => fact)
}

/** A relationship cell as the `RecordId` it points at, or `null` when it is unset. */
function relatedRecordId(value: TypedFieldValue | undefined): RecordId | null {
  return value?.type === 'relationship' && value.recordId ? value.recordId : null
}
