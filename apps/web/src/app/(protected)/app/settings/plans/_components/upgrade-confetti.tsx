// app/(protected)/app/settings/plans/_components/upgrade-confetti.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { showCelebrationConfetti } from '~/components/subscriptions/show-confetti'

/** Triggers celebratory confetti when the settings page is visited with ?upgrade=true. */
export function UpgradeConfetti() {
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams?.get('upgrade') === 'true') {
      showCelebrationConfetti()
      // Use history.replaceState to update URL without triggering Next.js navigation
      // This prevents aborting in-flight requests from other components
      window.history.replaceState(null, '', '/app/settings/plans')
    }
  }, [searchParams])

  return null
}
