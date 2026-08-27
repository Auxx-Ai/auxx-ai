// apps/web/src/components/subscriptions/shopify-plan-card.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { format } from 'date-fns'
import { CreditCard, ExternalLink } from 'lucide-react'
import { api, type RouterOutputs } from '~/trpc/react'

type Subscription = NonNullable<RouterOutputs['billing']['getCurrentSubscription']>

interface ShopifyPlanCardProps {
  subscription: Subscription
}

/**
 * Read-only plan row for Shopify-billed orgs, in place of the in-app plan grid.
 *
 * Shopify App Pricing owns plan selection, pricing, proration, trials and cancellation, so
 * mirroring any of that here can only drift from it — and every round of App Store rejection
 * 1.2.2 has been a drift bug: a stale plan (round 2), a plan choice we collected and then
 * discarded, and totals that disagreed with Shopify's own approval screen (round 3, assessment
 * 2404984). See `plans/billing/v3/06-approval-loops-back-to-plan-selection.md` §6.
 *
 * So this shows only what we read back from the Admin API contract and hands off with one
 * link. Requirement 1.2.3 (self-serve upgrade *and* downgrade, no support contact, no
 * reinstall) is satisfied by that link — Shopify's picker offers both directions.
 */
export function ShopifyPlanCard({ subscription }: ShopifyPlanCardProps) {
  // Where a plan change can actually go depends on whether the shop still has the app
  // installed — the hosted pricing page 404s once it doesn't, and App Store rule 2.1.1
  // counts a web error reached from our UI against us. Probes the Admin API.
  const { data: planAction, isPending: planActionPending } =
    api.billing.getShopifyPlanAction.useQuery()

  const isCanceled = subscription.status === 'canceled' || subscription.cancelAtPeriodEnd
  const isUninstalled = planAction?.kind === 'uninstalled'

  return (
    <>
      <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
        <div className='flex flex-row items-center gap-2'>
          <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
            <CreditCard className='size-4 shrink-0' />
          </div>
          <div className='flex flex-col'>
            <div className='flex items-center gap-2'>
              <span className='text-sm'>{subscription.plan?.name || 'No plan selected'}</span>
              {subscription.billingCycle && (
                <Badge size='xs' variant='user'>
                  {subscription.billingCycle === 'MONTHLY' ? 'Monthly' : 'Annual'}
                </Badge>
              )}
              {subscription.status === 'trialing' && (
                <Badge size='xs' variant='secondary'>
                  Trial
                </Badge>
              )}
            </div>
            <span className='text-xs text-muted-foreground'>{planSummary(subscription)}</span>
          </div>
        </div>
        {/* Only offer the link when we know it leads somewhere. Reinstalling happens in the
            Shopify admin, which has no deep link, so `uninstalled` (and a failed probe) falls
            through to the alert below instead of rendering a dead link. */}
        {planActionPending ? (
          <Button variant='outline' size='sm' loading loadingText='Checking...'>
            Manage plan in Shopify
          </Button>
        ) : planAction?.kind === 'plans' ? (
          <Button variant='outline' size='sm' asChild>
            <a href={planAction.url} target='_blank' rel='noopener noreferrer'>
              Manage plan in Shopify
              <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>

      {isUninstalled ? (
        <Alert variant='destructive'>
          <AlertDescription>
            <span className='text-sm'>
              Auxx was removed from <strong>{planAction.shopDomain}</strong>. Reinstall it from your
              Shopify admin — Settings → Apps → Uninstalled apps — to pick a plan again.
            </span>
          </AlertDescription>
        </Alert>
      ) : isCanceled && subscription.periodEnd ? (
        <Alert variant='destructive'>
          <AlertDescription>
            <span className='text-sm'>
              Your Shopify subscription has been canceled and access ends on{' '}
              <strong>{format(new Date(subscription.periodEnd), 'MMMM d, yyyy')}</strong>. Choose a
              plan in Shopify to keep using Auxx.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

/** One line of contract state, all of it read back from Shopify — never computed here. */
function planSummary(subscription: Subscription): string {
  if (subscription.status === 'trialing' && subscription.trialEnd) {
    return `Trial ends ${format(new Date(subscription.trialEnd), 'MMMM d, yyyy')}`
  }
  if (subscription.status === 'past_due') return 'Payment overdue — resolve it in Shopify Admin'
  if (subscription.status === 'incomplete') return 'Waiting for plan approval in Shopify'
  if (subscription.status === 'canceled') return 'Canceled'
  if (subscription.periodEnd) {
    return `Renews ${format(new Date(subscription.periodEnd), 'MMMM d, yyyy')}`
  }
  return 'Billed through Shopify'
}
