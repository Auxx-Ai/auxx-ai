// apps/web/src/components/banner/records-limit-banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { AlertTriangleIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useDehydratedOrganizationId } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

/** App-shell notice for the org-wide records limit: dismissible at soft, fixed at hard. */
export function RecordsLimitBanner() {
  const selfHosted = useIsSelfHosted()
  const organizationId = useDehydratedOrganizationId()
  const { data } = api.usage.getRecords.useQuery(undefined, {
    enabled: !selfHosted,
    staleTime: 5 * 60_000,
  })
  const [dismissed, setDismissed] = useState(true)

  // Stores the soft limit dismissed at, so a new plan's threshold warns again.
  const dismissKey = `records-soft-limit-dismissed:${organizationId}`
  const dismissValue = data?.soft != null ? String(data.soft) : null
  useEffect(() => {
    setDismissed(dismissValue !== null && localStorage.getItem(dismissKey) === dismissValue)
  }, [dismissKey, dismissValue])

  if (!data || data.hard === null) return null
  const { count, hard, softReached, hardReached } = data
  if (!hardReached && (!softReached || dismissed)) return null

  const title = hardReached
    ? 'Records limit reached — upgrade to add more'
    : 'Approaching your records limit'
  const description = `${count.toLocaleString()} of ${hard.toLocaleString()} records used${hardReached ? '. New imports and records are blocked.' : '.'}`

  return (
    <div className='relative z-50 px-3 pt-2 bg-neutral-100 dark:bg-primary-100'>
      <div className='rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 shrink-0 ps-2 pe-2 text-foreground'>
        <div className='flex gap-2 min-h-9 md:items-center'>
          <div className='flex grow gap-3 md:items-center'>
            <div
              className='flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 max-md:mt-0.5'
              aria-hidden='true'>
              <AlertTriangleIcon className='text-amber-600 dark:text-amber-400' size={16} />
            </div>
            <div className='flex grow flex-col justify-between gap-1 md:flex-row md:items-center'>
              <div>
                <span className='text-sm font-medium me-2'>{title}</span>
                <span className='text-sm text-muted-foreground'>{description}</span>
              </div>
              <div className='flex gap-1 max-md:flex-wrap shrink-0 items-center'>
                <Button
                  size='sm'
                  variant='ghost'
                  asChild
                  className='bg-amber-300 hover:bg-amber-200 dark:bg-amber-700 dark:hover:bg-amber-600 dark:text-white mb-2 md:mb-0'>
                  <Link href='/app/settings/plans'>Upgrade</Link>
                </Button>
                {!hardReached && dismissValue !== null && (
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label='Dismiss'
                    onClick={() => {
                      localStorage.setItem(dismissKey, dismissValue)
                      setDismissed(true)
                    }}>
                    <XIcon />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
