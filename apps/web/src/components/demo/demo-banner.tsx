// apps/web/src/components/demo/demo-banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'

/**
 * Persistent banner shown to demo users at the top of the app.
 * Displays countdown timer and sign-up CTA.
 */
export function DemoBanner() {
  const orgId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(orgId)
  const [dismissed, setDismissed] = useState(false)
  const [remaining, setRemaining] = useState('')

  const demoExpiresAt = org?.demoExpiresAt

  useEffect(() => {
    if (!demoExpiresAt) return

    const expiresAt = new Date(demoExpiresAt).getTime()

    const update = () => {
      const now = Date.now()
      const diff = expiresAt - now

      if (diff <= 0) {
        setRemaining('expired')
        return
      }

      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [demoExpiresAt])

  if (!demoExpiresAt || dismissed) return null

  if (remaining === 'expired') {
    // Redirect will be handled by the protected layout
    return null
  }

  return (
    <div className='relative z-50 flex items-center justify-center gap-3 bg-blue-100 dark:bg-blue-600/10 px-4 py-2 text-sm text-info '>
      <span className='font-medium'>You're exploring a demo</span>
      <span className='text-blue-200'>·</span>
      <span className='tabular-nums'>{remaining} remaining</span>
      <span className='text-blue-200'>·</span>
      <Button asChild variant='secondary' size='sm' className='h-7 text-xs bg-info'>
        <Link href='/signup?from=demo'>Sign Up Free</Link>
      </Button>
      <button
        type='button'
        onClick={() => setDismissed(true)}
        className='absolute right-3 top-1/2 -translate-y-1/2 text-blue-200 hover:opacity-50'
        aria-label='Dismiss demo banner'>
        <X className='h-4 w-4' />
      </button>
    </div>
  )
}
