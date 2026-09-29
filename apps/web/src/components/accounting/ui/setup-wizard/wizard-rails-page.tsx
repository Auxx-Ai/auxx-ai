// apps/web/src/components/accounting/ui/setup-wizard/wizard-rails-page.tsx
'use client'

import { ACCOUNT_ROLES } from '@auxx/lib/accounting/ledger/client'
import { processorByHandle } from '@auxx/lib/accounting/processors/client'
import {
  buildRailGroups,
  isStaleRail,
  type RailGroup,
  type RailGroupState,
  sharedClearingAccounts,
  warnsAboutFeeFallback,
} from '@auxx/lib/accounting/rails/rail-groups'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { PaymentGatewayAddDialog } from '../settings/payment-gateway-add-dialog'
import { RailFeedNote } from '../settings/rail-feed-note'

const GATEWAYS_HREF = '/app/accounting/settings/payment-gateways'

const STATE_BADGE: Record<
  RailGroupState,
  { label: string; variant: 'green' | 'amber' | 'destructive' }
> = {
  routed: { label: 'Routed', variant: 'green' },
  split: { label: 'Partly routed', variant: 'amber' },
  unrouted: { label: 'Not routed', variant: 'destructive' },
}

/**
 * `AccountingSetupWizard`'s rails page - the payment rails on this org's own
 * orders, and an account for each (brief 26 §8).
 *
 * 🛑 **Placement is load-bearing, and both ends of it.** It sits AFTER
 * `accounts`, because an account cannot be picked or minted before a chart
 * exists, and BEFORE `accountMap`, because the QuickBooks mapping page has to
 * see the accounts this page created.
 *
 * 🛑 **Skippable, like every other page.** `P1` makes "nothing configured" a
 * supported state; nothing here may refuse Continue. Both warnings below are
 * warnings - the fee-fallback one especially, which §13 decision 1 settles as a
 * warning precisely because the alternative is a refusal at close a month later
 * and far from its cause.
 *
 * What it adds over the settings list, which deliberately has none of it:
 *
 * 1. **Order counts and a last-seen date.** A handle with 5,000 orders and none
 *    in the last year is a retired rail that wants an account and a `closed`
 *    status; a handle with orders last week and no record is the actual alarm.
 *    Nothing else separates those two.
 * 2. **Spelling variants grouped**, with a merge - `authorize_net` and
 *    `authorize.net` are one rail, and routing them separately is how a rail's
 *    money ends up in two accounts.
 * 3. **A shared-account warning at the moment of choosing.**
 * 4. **The set-up button**, which is the point of the step: it opens the gateway
 *    dialog, where each account is picked from the chart or created new.
 */
export function WizardRailsPage() {
  const census = api.paymentGateway.handleCensus.useQuery()
  const gateways = api.paymentGateway.list.useQuery({ includeArchived: true, withFeed: true })
  const roleMap = api.ledger.roleMap.useQuery()
  const utils = api.useUtils()
  const { can } = useAccess()
  const canControl = can(PermissionKey.ledgerControl)

  const [setUpGroup, setSetUpGroup] = useState<RailGroup | null>(null)

  const groups = useMemo(() => buildRailGroups(census.data ?? []), [census.data])
  const gatewayRows = useMemo(() => gateways.data ?? [], [gateways.data])
  const gatewaysById = useMemo(
    () => new Map(gatewayRows.map((row) => [row.id, row] as const)),
    [gatewayRows]
  )
  const shared = useMemo(() => sharedClearingAccounts(gatewayRows), [gatewayRows])

  // An unclaimed group has no gateway to carry a feed state, so ask for it by handles, in one call.
  const unclaimedFeedGroups = useMemo(
    () =>
      groups
        .filter((group) => group.claimedBy.length === 0)
        .map((group) => ({ key: group.key, handles: group.handles.map((row) => row.handle) }))
        .filter((group) => group.handles.some((handle) => processorByHandle(handle) !== null)),
    [groups]
  )
  const unclaimedFeeds = api.paymentGateway.feedStateForHandles.useQuery(
    { groups: unclaimedFeedGroups.map((group) => group.handles) },
    { enabled: unclaimedFeedGroups.length > 0 }
  )
  const feedByGroupKey = useMemo(
    () =>
      new Map(unclaimedFeedGroups.map((group, index) => [group.key, unclaimedFeeds.data?.[index]])),
    [unclaimedFeedGroups, unclaimedFeeds.data]
  )

  // 🛑 Gate the fee warning on the role map having ANSWERED. "No account holds
  // this role" is a claim about the organization, and making it while the query
  // is still in flight is a false one on the page whose whole job is telling
  // somebody what is left to do.
  const feeRole = roleMap.data?.roles.find(
    (row) => row.role === ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES
  )
  const warnsFeeFallback =
    roleMap.data !== undefined &&
    warnsAboutFeeFallback({
      fallbackMapped: Boolean(feeRole?.accountId),
      gateways: gatewayRows,
      groups,
    })

  const refresh = async () => {
    await Promise.all([
      utils.paymentGateway.list.invalidate(),
      utils.paymentGateway.handleCensus.invalidate(),
      utils.paymentGateway.observedHandles.invalidate(),
      utils.paymentGateway.feedStateForHandles.invalidate(),
      utils.ledger.chartAccounts.invalidate(),
      utils.ledger.roleMap.invalidate(),
    ])
  }

  const mergeRail = api.paymentGateway.update.useMutation({
    onSuccess: refresh,
    onError: (error) => {
      toastError({ title: 'Error merging the handles', description: error.message })
    },
  })

  function mergeGroup(group: RailGroup) {
    const target = group.mergeInto ? gatewaysById.get(group.mergeInto) : undefined
    if (!target) return
    mergeRail.mutate({ id: target.id, handles: [...target.handles, ...group.mergeHandles] })
  }

  const routed = groups.filter((group) => group.state === 'routed').length
  const isLoading = census.isPending || gateways.isPending

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Every rail that has ever taken money for one of your orders, and which account in your chart
        it clears into. A rail with its own account can be reconciled to zero against its own
        deposits; rails sharing one account cannot be told apart again.
      </p>

      {isLoading ? (
        <EmptySection loading />
      ) : census.isError ? (
        <Alert variant='destructive'>
          <AlertTitle>Could not read the rails on your orders</AlertTitle>
          <AlertDescription>{census.error.message}</AlertDescription>
        </Alert>
      ) : groups.length === 0 ? (
        <EmptySection
          title='No payment rails on your orders yet'
          description='Once orders sync, every gateway they arrived through shows up here with an account to point it at.'
        />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-foreground text-sm'>
              {routed} of {groups.length} rails routed
            </span>
            {routed < groups.length && (
              <span className='text-muted-foreground text-sm'>
                An unrouted rail still posts - it just lands in the shared card clearing account
                with everything else.
              </span>
            )}
          </div>

          {warnsFeeFallback && (
            <Alert variant='warning'>
              <AlertTitle>No account holds your processor fees</AlertTitle>
              <AlertDescription>
                A rail whose processor withholds its cut books that fee to the
                {' payment processing fees '}
                role, and no account is mapped to it yet. Nothing here is blocked, but the first
                payout entry will refuse until you map it on the account map.
              </AlertDescription>
            </Alert>
          )}

          {shared.size > 0 && (
            <Alert variant='warning'>
              <AlertTitle>Two rails share one clearing account</AlertTitle>
              <AlertDescription>
                {[...shared.values()]
                  .map((bucket) => bucket.map((row) => row.name || 'Untitled').join(' and '))
                  .join('; ')}
                {
                  ' clear into the same account. That is legal, and it is also why that account can no longer be squared against one deposit.'
                }
              </AlertDescription>
            </Alert>
          )}

          <div className='overflow-hidden rounded-xl border'>
            <ul className='flex flex-col'>
              {groups.map((group) => {
                const claiming = group.claimedBy[0] ? gatewaysById.get(group.claimedBy[0]) : null
                const badge = STATE_BADGE[group.state]
                return (
                  <li key={group.key} className='flex flex-col border-b last:border-b-0'>
                    <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='flex items-center gap-2 truncate font-medium text-sm'>
                          {group.name}
                          <Badge variant={badge.variant} size='sm' className='shrink-0'>
                            {badge.label}
                          </Badge>
                        </span>
                        <span className='truncate text-muted-foreground text-xs'>
                          {group.orderCount.toLocaleString()}{' '}
                          {group.orderCount === 1 ? 'order' : 'orders'}
                          {group.lastSeenAt ? `, last ${group.lastSeenAt}` : ''}
                          {group.handles.length > 1
                            ? ` · ${group.handles.map((handle) => handle.handle).join(', ')}`
                            : ''}
                        </span>
                        {claiming ? (
                          <RailFeedNote
                            feed={claiming.feed}
                            gatewayId={claiming.id}
                            canControl={canControl}
                            className='pt-1'
                          />
                        ) : (
                          <RailFeedNote
                            feed={feedByGroupKey.get(group.key)}
                            canControl={canControl}
                            className='pt-1'
                          />
                        )}
                      </div>

                      <div className='flex shrink-0 items-center gap-2'>
                        {claiming ? (
                          <AccountLabel
                            glAccountId={claiming.clearingGlAccountId}
                            density='compact'
                            fallback='-'
                            className='text-muted-foreground text-xs'
                          />
                        ) : null}
                        {group.mergeInto && (
                          <Button
                            variant='outline'
                            size='sm'
                            loading={mergeRail.isPending}
                            loadingText='Merging...'
                            onClick={() => mergeGroup(group)}>
                            Merge {group.mergeHandles.join(', ')}
                          </Button>
                        )}
                        {group.state === 'unrouted' && (
                          <Button variant='outline' size='sm' onClick={() => setSetUpGroup(group)}>
                            Set up
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      <p className='text-muted-foreground text-xs'>
        Orders paid by hand debit receivables instead and are not a rail, so they never appear here.
        Everything on this page can be changed later on{' '}
        <Link href={GATEWAYS_HREF} className='underline'>
          payment gateways
        </Link>
        .
      </p>

      <PaymentGatewayAddDialog
        open={setUpGroup !== null}
        onOpenChange={(open) => {
          if (!open) setSetUpGroup(null)
        }}
        onCreated={() => void refresh()}
        initialHandles={setUpGroup?.handles.map((handle) => handle.handle)}
        status={setUpGroup && isStaleRail(setUpGroup.lastSeenAt) ? 'closed' : 'active'}
      />

      <div>
        <Button variant='outline' size='sm' asChild>
          <Link href={GATEWAYS_HREF}>
            Open payment gateways
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
