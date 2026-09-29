// apps/web/src/components/manufacturing/stock-setup/count-step.tsx
'use client'

import { CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { OpeningStockTab } from '~/components/manufacturing/ui/settings/opening-stock-tab'
import {
  OPENING_INVENTORY_DIFFERENCE_HREF,
  useAccountingSetupState,
} from './accounting-status-line'
import type { StockSetupStatus } from './use-stock-setup'

interface CountStepProps {
  status: StockSetupStatus | undefined
}

/** Step 3 (plans/mrp/17 §5.3): the Set counts list and run; "Done counting" lives in the run pane. */
export function CountStep({ status }: CountStepProps) {
  const accounting = useAccountingSetupState()
  const uncosted = status?.uncostedPartCount ?? 0

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {status?.countingDone && (
        <div className='flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm'>
          <span className='flex items-center gap-2'>
            <CheckCircle2 className='size-4 text-good-500' />
            {uncosted === 0
              ? 'Counting is done.'
              : `Counting is done. ${uncosted} ${uncosted === 1 ? 'part' : 'parts'} with stock movements ${uncosted === 1 ? 'has' : 'have'} no cost.`}
          </span>
          {accounting.enabled && accounting.canManage && (
            <Link
              href={OPENING_INVENTORY_DIFFERENCE_HREF}
              className='text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'>
              Compare with your books →
            </Link>
          )}
        </div>
      )}
      <OpeningStockTab />
    </div>
  )
}
