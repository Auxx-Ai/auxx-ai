// apps/web/src/components/mrp/ui/flags/flag-groups.ts

import { MRP_FLAGS, type MrpFlag } from '@auxx/lib/mrp/client'

/** Data-quality flags lead (07 §4.4); `channel_drift` joins after `unbuilt_sales` once it exists. */
const DATA_QUALITY_FLAGS: readonly MrpFlag[] = ['relief_gaps', 'unbuilt_sales', 'mirror_drift']

/** Every flag in the order the Flags page lists its groups. */
export const FLAG_GROUP_ORDER: readonly MrpFlag[] = [
  ...DATA_QUALITY_FLAGS,
  ...MRP_FLAGS.filter((flag) => !DATA_QUALITY_FLAGS.includes(flag)),
]

/** The one-line explanation beside each flag group's header. */
export const FLAG_EXPLANATIONS: Record<MrpFlag, string> = {
  relief_gaps: 'Some sales never relieved stock in the ledger, so usage reads low.',
  unbuilt_sales: 'More was sold than was built plus opening stock, so usage or on hand is off.',
  mirror_drift: 'The movement history disagrees with on hand.',
  no_lead_time: 'No supplier lead time or build lead time is set, so no order-by date.',
  lead_time_drift: 'Receipts arrive on a different lead time from the stated one.',
  overdue_receipt: 'An issued purchase order is past its expected date.',
  wont_make_next_arrival: 'Stock runs out before the next scheduled order can arrive.',
  draft_po_pending: 'A draft purchase order is not counted as on order until it is issued.',
  unclassified: 'Neither bought nor made: add a vendor part or a BOM, or set the cost source.',
  not_buffered_bought: 'A bought part set to Not buffered, so nothing will suggest ordering it.',
}
