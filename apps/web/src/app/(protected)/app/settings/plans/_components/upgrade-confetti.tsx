// app/(protected)/app/settings/plans/_components/upgrade-confetti.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { showCelebrationConfetti } from '~/components/subscriptions/show-confetti'

/** Triggers celebratory confetti when the settings page is visited with ?upgrade=true. */
export function UpgradeConfetti() {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    if (searchParams?.get('upgrade') === 'true') {
      showCelebrationConfetti()
      router.replace('/app/settings/plans')
    }
  }, [router, searchParams])

  return null
}
