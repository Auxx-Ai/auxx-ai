// apps/web/src/components/mrp/ui/part/flag-explain.ts

import type { MrpFlag } from '@auxx/lib/mrp/client'
import { formatDays, type MrpPlanItemData } from './key-numbers'

/** One line on what the flag means for this part, from the stored run fields. */
export function explainFlag(
  flag: MrpFlag,
  item: Pick<
    MrpPlanItemData,
    'observedLeadTimeDays' | 'leadTimeDays' | 'observedReceipts' | 'supplyType'
  >
): string {
  switch (flag) {
    case 'lead_time_drift':
      return `Observed ${formatDays(item.observedLeadTimeDays)} vs stated ${formatDays(item.leadTimeDays)} over ${item.observedReceipts ?? 0} receipts`
    case 'no_lead_time':
      return item.supplyType === 'made'
        ? 'No build lead time; set one in Planning settings'
        : 'The vendor part has no lead time; set it on Vendors'
    case 'overdue_receipt':
      return "An issued PO is past its expected date; the projection moves it by the vendor's median lateness"
    case 'draft_po_pending':
      return 'A draft PO is not counted as on order until it is issued'
    case 'relief_gaps':
      return 'Some sales never relieved stock in the ledger, so usage reads low'
    case 'unbuilt_sales':
      return 'More was sold than was built plus opening stock'
    case 'mirror_drift':
      return 'The movement history disagrees with on hand'
    case 'negative_on_hand':
      return 'On hand went below zero, so builds or receipts are missing'
    case 'thin_usage':
      return 'Stocked out most of the window, so average use counts every day'
    case 'wont_make_next_arrival':
      return 'Stock runs out before the next scheduled order can arrive'
    case 'unclassified':
      return 'Neither bought nor made: add a vendor part or a BOM, or set the cost source'
    case 'not_buffered_bought':
      return 'Set to Not buffered, so nothing will suggest ordering it'
    default:
      return ''
  }
}
