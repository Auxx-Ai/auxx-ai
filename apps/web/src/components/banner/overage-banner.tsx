// apps/web/src/components/banner/overage-banner.tsx
'use client'

import type { Overage } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { AlertTriangleIcon } from 'lucide-react'
import Link from 'next/link'

export function OverageBanner({ overages }: { overages: Overage[] }) {
  if (overages.length === 0) return null

  const featureSummary = overages.map((o) => `${o.label} (${o.current}/${o.limit})`).join(', ')

  return (
    <div className='bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0 px-4 py-3 text-foreground'>
      <div className='flex gap-2 md:items-center'>
        <div className='flex grow gap-3 md:items-center'>
          <div
            className='flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 max-md:mt-0.5'
            aria-hidden='true'>
            <AlertTriangleIcon className='text-amber-600 dark:text-amber-400' size={16} />
          </div>
          <div className='flex grow flex-col justify-between gap-3 md:flex-row md:items-center'>
            <div className='space-y-0.5'>
              <p className='text-sm font-medium'>Plan limits exceeded</p>
              <p className='text-sm text-muted-foreground'>
                Your current usage exceeds your plan limits for: {featureSummary}. You can&apos;t
                create new items for these features until you&apos;re within limits.
              </p>
            </div>
            <div className='flex gap-2 max-md:flex-wrap shrink-0'>
              <Button size='sm' variant='outline' asChild>
                <Link href='/app/settings/plans'>Manage Plan</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
