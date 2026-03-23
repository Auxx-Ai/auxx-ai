// apps/web/src/components/demo/demo-banner.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useDemo } from '~/hooks/use-demo'

/**
 * Persistent banner shown to demo users at the top of the app.
 * Displays countdown timer and sign-up CTA.
 * When dismissed, a compact version appears in the sidebar footer.
 */
export function DemoBanner() {
  const { isDemo, expiresAt, isBannerDismissed, dismissBanner } = useDemo()
  const [remaining, setRemaining] = useState('00:00')
  const router = useRouter()

  useEffect(() => {
    if (!expiresAt) return

    const expiresAtMs = expiresAt.getTime()

    const update = () => {
      const now = Date.now()
      const diff = expiresAtMs - now

      if (diff <= 0) {
        setRemaining('expired')
        router.push('/demo-expired')
        return
      }

      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [expiresAt, router])

  if (!isDemo || isBannerDismissed) return null

  if (remaining === 'expired') return null

  return (
    <div className='relative z-10 '>
      <div className='h-10 relative flex items-center justify-center gap-3 bg-blue-100 dark:bg-blue-600/10 px-4 py-2 text-sm text-info '>
        <span className='font-medium'>You're exploring a demo</span>
        <span className='text-blue-200'>·</span>
        <span className='tabular-nums'>{remaining} remaining</span>
        <span className='text-blue-200'>·</span>
        <Button
          asChild
          variant='secondary'
          size='sm'
          className='h-7 text-xs bg-info hover:bg-info/80 text-white'>
          <Link href='/signup?from=demo'>Sign Up Free</Link>
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          onClick={dismissBanner}
          className='absolute right-1 top-1/2 -translate-y-1/2 text-blue-200 hover:opacity-50 hover:bg-info/10'
          aria-label='Dismiss demo banner'>
          <X />
        </Button>
      </div>
      <div className='pointer-events-none absolute bottom-0 inset-x-0 z-20 h-2 shrink-0 border-b border-black/20 bg-gradient-to-t from-black/10 to-transparent transition-opacity duration-300' />
    </div>
  )
}
