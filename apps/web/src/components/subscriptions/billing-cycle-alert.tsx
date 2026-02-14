// app/(protected)/app/settings/plans/_components/billing-cycle-alert.tsx
'use client'

import { Alert, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { format } from 'date-fns'
import { Calendar } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { PlanChangeSummary } from './plan-change-summary'

/** Alert component showing trial countdown or next billing cycle */
export function BillingCycleAlert() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: subscription, isLoading } = api.billing.getCurrentSubscription.useQuery()
  const { data: paymentMethods, isLoading: isLoadingPaymentMethods } =
    api.billing.getPaymentMethods.useQuery()

  if (isLoading || isLoadingPaymentMethods) {
    return <BillingCycleAlertSkeleton />
  }

  if (!subscription) {
    return null
  }

  const isTrial = subscription.status === 'trialing'
  const now = new Date()
  const hasPaymentMethod = Boolean(paymentMethods && paymentMethods.length > 0)

  /** Calculate days remaining in trial */
  const getDaysRemaining = () => {
    if (!subscription.trialEnd) return 0
    const trialEnd = new Date(subscription.trialEnd)
    const diffTime = trialEnd.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return Math.max(0, diffDays)
  }

  /** Format next billing date */
  const getNextBillingDate = () => {
    if (!subscription.periodEnd) return 'Unknown'
    return format(new Date(subscription.periodEnd), 'MMMM d, yyyy')
  }

  const daysRemaining = getDaysRemaining()
  const nextBillingDate = getNextBillingDate()

  return (
    <>
      <Alert variant='outline' className=''>
        <div className='flex items-center justify-between w-full gap-4'>
          <AlertTitle className='mb-0'>
            <Calendar />

            {isTrial
              ? `There ${daysRemaining === 1 ? 'is' : 'are'} ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left on your trial`
              : `Next billing cycle on ${nextBillingDate}`}
          </AlertTitle>
          {!hasPaymentMethod ? (
            <Button size='sm' onClick={() => setDialogOpen(true)}>
              Add billing details
            </Button>
          ) : (
            <Button size='sm' variant='ghost'>
              {' '}
            </Button>
          )}
        </div>
      </Alert>

      <PlanChangeSummary open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

/** Skeleton loader for billing cycle alert */
export function BillingCycleAlertSkeleton() {
  return (
    <div className='rounded-lg border p-4'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='size-4 rounded' />
          <Skeleton className='h-5 w-64' />
        </div>
        <Skeleton className='h-9 w-32' />
      </div>
    </div>
  )
}
