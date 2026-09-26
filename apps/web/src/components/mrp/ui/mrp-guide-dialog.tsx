// apps/web/src/components/mrp/ui/mrp-guide-dialog.tsx

'use client'

import { MRP_FLAG_LABELS, MRP_FLAGS } from '@auxx/lib/mrp/client'
import {
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideDialog,
  GuideSection,
} from '@auxx/ui/components/guide'
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Flag,
  Hammer,
  ShoppingCart,
  Timer,
} from 'lucide-react'
import { FLAG_EXPLANATIONS } from './flags/flag-groups'

interface MrpGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const glyph = 'size-3.5 text-muted-foreground'

/** The MRP toolbar's help sheet: the action list, its tabs, buffers, suggestions and flags. */
export function MrpGuideDialog({ open, onOpenChange }: MrpGuideDialogProps) {
  return (
    <GuideDialog open={open} onOpenChange={onOpenChange} title='How planning works' heading='Help'>
      <GuideColumns cols={2}>
        <GuideColumn title='The action list'>
          <GuideConcept term='One plan run'>
            Every number comes from the latest plan run. It reads your stock movements, open
            purchase orders and builds, works out how fast each part is used, and dates when you
            need to order. Nothing changes between runs; press Run now after you edit a part's
            planning settings.
          </GuideConcept>
          <GuideConcept term='Order by'>
            The last day to place the order or start the build so it lands before you run out, given
            the lead time. Rows are sorted most urgent first.
          </GuideConcept>
          <GuideConcept term='Days of cover'>
            How long the stock on hand lasts at the current rate of use, counting what is already on
            order.
          </GuideConcept>
        </GuideColumn>
        <GuideColumn title='The tabs'>
          <GuideConcept glyph={<CircleAlert className={glyph} />} term='Overdue'>
            The order-by date has passed. Order now or expect a stockout.
          </GuideConcept>
          <GuideConcept glyph={<Timer className={glyph} />} term='This week'>
            Order within the next seven days.
          </GuideConcept>
          <GuideConcept glyph={<CalendarDays className={glyph} />} term='Later'>
            The run gave the part an order-by date beyond this week.
          </GuideConcept>
          <GuideConcept glyph={<Flag className={glyph} />} term='Flagged'>
            Something in the data makes the answer less certain. Read the flag before trusting the
            date.
          </GuideConcept>
          <GuideConcept glyph={<CheckCircle2 className={glyph} />} term='Fine'>
            No suggestion and no flag.
          </GuideConcept>
        </GuideColumn>
      </GuideColumns>

      <GuideSection title='Buffers and suggestions' cols={3}>
        <GuideConcept term='Buffered'>
          A buffered part keeps a stock cushion sized from its use, lead time and how much both
          vary. It is reordered when the stock plus what is on order drops into the cushion. A part
          that is not buffered is ordered only for known demand.
        </GuideConcept>
        <GuideConcept glyph={<ShoppingCart className={glyph} />} term='Purchase'>
          Order this quantity from the suggested supplier, rounded up to the minimum order and whole
          purchase units. Create draft POs makes one draft per supplier.
        </GuideConcept>
        <GuideConcept glyph={<Hammer className={glyph} />} term='Build'>
          Build this quantity of a made part. Create draft builds makes one draft each. Drafts are
          not counted as on order until they are issued.
        </GuideConcept>
      </GuideSection>

      <GuideSection title='Flags' cols={2}>
        {MRP_FLAGS.map((flag) => (
          <GuideConcept key={flag} glyph={<Flag className={glyph} />} term={MRP_FLAG_LABELS[flag]}>
            {FLAG_HELP[flag]}
          </GuideConcept>
        ))}
      </GuideSection>
    </GuideDialog>
  )
}

const FLAG_HELP: Record<(typeof MRP_FLAGS)[number], string> = {
  relief_gaps: 'Sales reached the channel but never took stock out, so usage reads low.',
  unbuilt_sales: 'More units were sold than were built, so component usage reads low.',
  negative_on_hand: FLAG_EXPLANATIONS.negative_on_hand,
  thin_usage: FLAG_EXPLANATIONS.thin_usage,
  no_lead_time: FLAG_EXPLANATIONS.no_lead_time,
  lead_time_drift: 'Received orders took noticeably longer or shorter than the stated lead time.',
  overdue_receipt: 'A purchase order is past its expected date and still not received.',
  mirror_drift: 'The movement history the planner reads disagrees with the stock ledger.',
  wont_make_next_arrival: 'The part runs out before the supplier’s next scheduled order lands.',
  draft_po_pending: 'A draft PO exists for it; drafts do not count as on order.',
  unclassified: 'The part is neither bought from a supplier nor built, so nothing is suggested.',
  not_buffered_bought: 'A bought part set to not buffered gets no reorder suggestion.',
}
