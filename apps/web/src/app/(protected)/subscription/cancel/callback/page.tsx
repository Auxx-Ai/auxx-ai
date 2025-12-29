// app/(protected)/subscription/cancel/callback/page.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '~/trpc/react'
import { Loader2 } from 'lucide-react'

/**
 * Cancel callback page after Stripe portal cancellation.
 * Invalidates subscription queries and redirects to billing page.
 */
export default function SubscriptionCancelCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = api.useUtils()

  const callbackURL = searchParams.get('callbackURL')

  useEffect(() => {
    // Invalidate subscription queries to refresh data
    utils.billing.getCurrentSubscription.invalidate()

    // Redirect immediately
    router.push(callbackURL || '/app/settings/plans')
  }, [callbackURL, router, utils])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        <p>Processing cancellation...</p>
      </div>
    </div>
  )
}
