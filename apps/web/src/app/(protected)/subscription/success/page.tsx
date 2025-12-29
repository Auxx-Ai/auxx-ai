// app/(protected)/subscription/success/page.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '~/trpc/react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'

/**
 * Success callback page after Stripe checkout completion.
 * Invalidates subscription queries and redirects to billing page.
 */
export default function SubscriptionSuccessPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = api.useUtils()

  const callbackURL = searchParams.get('callbackURL')
  const subscriptionId = searchParams.get('subscriptionId')

  useEffect(() => {
    // Invalidate subscription queries to refresh data
    utils.billing.getCurrentSubscription.invalidate()
    utils.billing.checkTrialStatus.invalidate()

    // Redirect after 2 seconds
    const timeout = setTimeout(() => {
      router.push(callbackURL || '/app/settings/plans')
    }, 2000)

    return () => clearTimeout(timeout)
  }, [callbackURL, router, utils])

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-center text-center">
            <CheckCircle2 className="mr-2 h-6 w-6 text-green-500" />
            Subscription Activated!
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="mb-4 text-muted-foreground">
            Your subscription has been successfully activated.
          </p>
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redirecting you back...
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
