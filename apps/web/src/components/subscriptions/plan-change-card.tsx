// app/(protected)/app/settings/plans/_components/plan-change-card.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { CreditCard, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState } from 'react'
import { useDemo } from '~/hooks/use-demo'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'

const PlanChangeSummary = dynamic(
  () =>
    import('./plan-change-summary').then((module) => ({
      default: module.PlanChangeSummary,
    })),
  {
    ssr: false,
  }
)

/**
 * Card component showing current plan with option to change it
 * Opens a dialog to view and select different plans
 */
export function PlanChangeCard() {
  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  const { isDemo } = useDemo()
  const [dialogOpen, setDialogOpen] = useState(false)
  const utils = api.useUtils()

  const { data: subscription, isLoading: subscriptionLoading } =
    api.billing.getCurrentSubscription.useQuery()

  const cancelScheduledChange = api.billing.cancelScheduledChange.useMutation({
    onSuccess: () => {
      utils.billing.getCurrentSubscription.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Error canceling scheduled change',
        description: error.message,
      })
    },
  })

  const restoreSubscription = api.billing.restoreSubscription.useMutation({
    onSuccess: () => {
      utils.billing.getCurrentSubscription.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Error restoring subscription',
        description: error.message,
      })
    },
  })

  /** Get icon for plan based on hierarchy level */
  const getPlanIcon = (hierarchyLevel: number) => {
    const baseClasses = 'size-4 shrink-0'
    // You can customize icons based on plan level if needed
    return <CreditCard className={baseClasses} />
  }

  /** Format billing cycle for displayf */
  const formatBillingCycle = (cycle: string | null | undefined) => {
    if (!cycle) return 'N/A'
    return cycle === 'MONTHLY' ? 'Monthly' : 'Annual'
  }

  /** Get plan description based on status */
  const getPlanDescription = () => {
    if (!subscription) return 'No active plan'
    if (subscription.status === 'trialing') return 'Trial Plan'
    if (subscription.status === 'canceled') return 'Canceled (Active until end of period)'
    return 'Active Subscription'
  }

  return (
    <>
      <div className='space-y-3'>
        <div className='flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground'>
          <CreditCard className='size-4' /> Your Plan
        </div>

        {subscriptionLoading ? (
          <div className='rounded-2xl border py-2 px-3'>
            <div className='flex items-center justify-between'>
              <div className='flex flex-row items-center gap-2'>
                <Skeleton className='size-8 rounded-lg' />
                <div className='flex flex-col gap-2'>
                  <Skeleton className='h-4 w-32' />
                  <Skeleton className='h-3 w-24' />
                </div>
              </div>
              <Skeleton className='h-9 w-28' />
            </div>
          </div>
        ) : (
          <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
            <div className='flex flex-row items-center gap-2'>
              <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                {getPlanIcon(subscription?.plan?.hierarchyLevel ?? 0)}
              </div>
              <div className='flex flex-col'>
                <div className='flex items-center gap-2'>
                  <span className='text-sm'>{subscription?.plan?.name || 'No Plan Selected'}</span>
                  {subscription?.billingCycle && (
                    <Badge size='xs' variant='user'>
                      {formatBillingCycle(subscription.billingCycle)}
                    </Badge>
                  )}
                  {subscription?.status === 'trialing' && (
                    <Badge size='xs' variant='secondary'>
                      Trial
                    </Badge>
                  )}
                </div>
                <span className='text-xs text-muted-foreground'>{getPlanDescription()}</span>
              </div>
            </div>
            <div className='flex items-center gap-2'>
              {isDemo ? (
                <Button variant='outline' size='sm' asChild>
                  <Link href='/signup?from=demo'>Sign up</Link>
                </Button>
              ) : (
                <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
                  Change Plan
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Alerts - Priority: Cancellation > Scheduled Downgrade */}
        {subscription?.cancelAtPeriodEnd && subscription.periodEnd ? (
          // Cancellation Alert (highest priority)
          <Alert variant='destructive'>
            <AlertDescription className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <span className='text-sm'>
                  Your subscription has been canceled and will end on{' '}
                  <strong>{format(new Date(subscription.periodEnd), 'MMMM d, yyyy')}</strong>.
                  You'll retain access until then.
                </span>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => restoreSubscription.mutate()}
                loading={restoreSubscription.isPending}
                loadingText='Restoring...'>
                Restore Subscription
              </Button>
            </AlertDescription>
          </Alert>
        ) : subscription?.scheduledPlanId && subscription.scheduledChangeAt ? (
          // Scheduled Downgrade Alert (only show if not canceled)
          <Alert>
            <AlertDescription className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <span className='text-sm'>
                  Scheduled to downgrade to <strong>{subscription.scheduledPlan}</strong> on{' '}
                  {format(new Date(subscription.scheduledChangeAt), 'MMMM d, yyyy')}
                </span>
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => cancelScheduledChange.mutate()}
                loading={cancelScheduledChange.isPending}
                loadingText='Canceling...'>
                <X />
                Cancel Change
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {dialogOpen ? <PlanChangeSummary open={dialogOpen} onOpenChange={setDialogOpen} /> : null}
    </>
  )
}
