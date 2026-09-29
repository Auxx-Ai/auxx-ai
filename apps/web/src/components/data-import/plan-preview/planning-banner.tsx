// apps/web/src/components/data-import/plan-preview/planning-banner.tsx

'use client'

import { Progress } from '@auxx/ui/components/progress'
import { Loader2 } from 'lucide-react'

interface PlanningBannerProps {
  /** Rows analyzed so far, from the planning progress stream */
  processed: number
  /** Rows in the file; 0 until the first progress event */
  total: number
  /** Rows already saved to the plan and listed below */
  shown: number
}

/** Marks the preview as partial while the plan is still being built. */
export function PlanningBanner({ processed, total, shown }: PlanningBannerProps) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0

  return (
    <div className='flex flex-col gap-2 border-b bg-info/5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4'>
      <div className='flex min-w-0 items-center gap-2'>
        <Loader2 className='size-4 shrink-0 animate-spin text-info' />
        <p className='text-sm'>
          <span className='font-medium'>Building preview</span>
          {total > 0 && (
            <span className='text-muted-foreground'>
              {' '}
              · {processed.toLocaleString()} of {total.toLocaleString()} rows analyzed
            </span>
          )}
        </p>
      </div>
      <p className='text-sm text-muted-foreground sm:ml-auto'>
        Showing the {shown.toLocaleString()} rows ready so far. Counts are not final.
      </p>
      {total > 0 && <Progress value={percent} className='h-1 sm:w-40' />}
    </div>
  )
}
