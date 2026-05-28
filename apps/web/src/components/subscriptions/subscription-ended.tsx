// apps/web/src/components/subscriptions/subscription-ended.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { Clock } from 'lucide-react'
import Link from 'next/link'
import { api } from '~/trpc/react'

/** Props for SubscriptionEnded component */
interface SubscriptionEndedProps {
  /** Whether the trial has ended (vs subscription expired) */
  isTrialEnded: boolean
  /** Optional organization name for personalization */
  organizationName?: string | null
  /** Number of other organizations user has access to */
  otherOrganizationsCount?: number
  /** Current plan name for contextual messaging */
  planName?: string | null
}

/** Component shown when a user's subscription or trial has expired */
export function SubscriptionEnded({
  isTrialEnded,
  organizationName,
  otherOrganizationsCount = 0,
  planName,
}: SubscriptionEndedProps) {
  const { data: subscription } = api.billing.getCurrentSubscription.useQuery()
  const billingProvider = subscription?.billingProvider
  const billingCycle = subscription?.billingCycle
  const subPlan = subscription?.plan
  const resolvedPlanName = (typeof subPlan === 'string' ? subPlan : subPlan?.name) ?? planName
  const normalizedPlanName = resolvedPlanName?.trim() ? resolvedPlanName.trim() : 'Pro'
  const displayPlanName = normalizedPlanName.charAt(0).toUpperCase() + normalizedPlanName.slice(1)

  const title = isTrialEnded
    ? `Your ${displayPlanName} trial has ended`
    : `${displayPlanName} subscription has ended`

  const description = 'Upgrade to maintain access to your organization and premium features'

  const upgradeSubscription = api.billing.upgradeSubscription.useMutation({
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url)
    },
    onError: (error) => {
      toastError({ title: 'Error starting upgrade', description: error.message })
    },
  })

  const isShopify = billingProvider === 'shopify'

  const handleApproveInShopify = () => {
    upgradeSubscription.mutate({
      planName: normalizedPlanName,
      billingCycle: billingCycle ?? 'MONTHLY',
      successUrl: `${window.location.origin}/billing/subscription/activated`,
      cancelUrl: window.location.href,
    })
  }

  return (
    <div className='flex items-center justify-center flex-1 min-h-0 h-full'>
      <div className='flex w-full max-w-sm flex-col items-center space-y-5 px-6 mx-auto'>
        <Card
          variant='translucent'
          className='w-full max-w-md shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted text-bad-500 '>
              <Clock className='size-8' />
            </div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isShopify ? (
              <Button
                className='w-full'
                onClick={handleApproveInShopify}
                loading={upgradeSubscription.isPending}
                loadingText='Redirecting to Shopify...'>
                Approve in Shopify
              </Button>
            ) : (
              <>
                <Button asChild className='w-full'>
                  <Link href='/subscription/convert/addons'>Continue with {displayPlanName}</Link>
                </Button>
                <Button asChild variant='translucent' className='w-full'>
                  <Link href='/subscription/convert/explore'>Explore plans</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <div className='w-full'>
          <Card className=' w-full max-w-md shadow-none shadow-black/20 bg-white/10 backdrop-blur-sm border border-white/20'>
            <CardTitle className='text-center py-3 font-normal text-sm text-white/90'>
              Need any help from us?
            </CardTitle>

            <CardContent className='space-y-3'>
              <Button asChild variant='translucent' className='w-full'>
                <a href='mailto:sales@auxx.ai' target='_blank' rel='noopener noreferrer'>
                  Talk to sales
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
