// apps/web/src/components/accounting/ui/banking/payouts/payout-evidence-drawer.tsx

'use client'

import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Landmark } from 'lucide-react'
import { PayoutEvidenceDetail } from './payout-evidence-detail'

interface PayoutEvidenceDrawerProps {
  payoutId: string | null
  onOpenChange: (open: boolean) => void
  /** Docked into the Banking layout's `MainPageContent`, or a floating overlay. */
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
}

/**
 * One payout, deep-linked on `?payout=<id>` (task 49 §5).
 *
 * Docked on desktop, exactly as `review/review-drawer.tsx` is. The Banking
 * layout owns the `MainPageContent`, so the page reaches its `dockedPanels`
 * slot through `docked-panels-outlet.tsx` rather than by rendering a second
 * one. Wraps the UNCHANGED `PayoutEvidenceDetail` - the list stays on screen
 * and the page title stops changing once a payout is selected.
 */
export function PayoutEvidenceDrawer({
  payoutId,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
}: PayoutEvidenceDrawerProps) {
  return (
    <DockableDrawer
      open={!!payoutId}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={800}
      title='Payout'>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<Landmark className='size-5 text-muted-foreground' />}
          title='Payout'
          onClose={() => onOpenChange(false)}
        />
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col gap-8 p-4'>
            {payoutId && <PayoutEvidenceDetail key={payoutId} payoutId={payoutId} />}
          </div>
        </ScrollArea>
      </div>
    </DockableDrawer>
  )
}
