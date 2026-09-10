// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.tsx

'use client'

// Accounting > Banking > Payouts (HANDOFF §11.5 item 1).
//
// ## What this screen is for
//
// A card sale DEBITS `1200 Card Clearing` gross the moment it is taken. The
// gateway pays out days later, net of its fee, and THAT is what credits clearing
// again. Without the payout side, `1200` grew without bound and the processor's
// fee was never expensed - which is what this screen exists to show is no longer
// happening: a clearing balance here is a list of sales the gateway has not paid
// out yet, and a settled batch should leave it at zero.
//
// ## 🛑 The Unidentified column is the one somebody has to work
//
// A payout settles every charge the merchant took, INCLUDING charges taken
// outside auxx - a payment link sent from the Stripe dashboard, a subscription
// on the same account, a terminal. Those were never debited to clearing, so
// crediting the payout's full gross would drive `1200` permanently negative.
// Instead cash takes the whole deposit, clearing is relieved of exactly what
// auxx put in it, and the remainder is credited to `2450 Unidentified Receipts`.
// That balance is real money whose revenue has never been recognised, and only a
// person can say what it was for.
//
// ⚠️ There is no create, edit or delete affordance anywhere on this page, on
// purpose. A payout is a TRANSCRIPTION of what the gateway did; the only writer
// is the sync, and a failed payout is corrected by REVERSAL.
//
// 🛑 Refusals are `EntryBlockers` cards, never toasts (HANDOFF ground rule 9). A
// payout the builder refused names which payout and why, and that sentence has
// to stay on the screen.

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { StatCards } from '@auxx/ui/components/stat-card'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CircleHelp, Landmark, RefreshCw, TrendingDown, Wallet } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Payouts' },
]

const PAGE_DESCRIPTION =
  'What the card processor actually paid into the bank, and what each payout relieved from card clearing. A clearing balance is sales the gateway has not settled yet; an unidentified balance is money that arrived whose revenue nobody has recognised.'

/** The ledger is pinned to USD for the cutover (`LEDGER_CURRENCY`). */
const DISPLAY_CURRENCY = 'USD'

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  paid: 'default',
  in_transit: 'secondary',
  failed: 'destructive',
  reversed: 'outline',
}

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  in_transit: 'In transit',
  failed: 'Failed',
  reversed: 'Reversed',
}

export function PayoutsPage() {
  useRequireCapability(PermissionKey.ledgerView)

  const [onlyUnidentified, setOnlyUnidentified] = useQueryState('unidentified', {
    parse: (value) => value === '1',
    serialize: (value) => (value ? '1' : ''),
    defaultValue: false,
  })

  const payoutsQuery = api.money.payout.list.useQuery({
    ...(onlyUnidentified ? { onlyUnidentified: true } : {}),
    limit: 200,
  })
  // The gateway named on the row's `secondary` (brief 18 §1.1 b). Payout
  // ingestion is Stripe Connect only today (HANDOFF §0.3), so the settlement
  // source is what picks the row rather than a field on the payout itself;
  // 'Stripe' is the fallback for an org with no gateway record yet.
  const gatewaysQuery = api.paymentGateway.list.useQuery()
  const stripeGatewayName = useMemo(() => {
    const stripeGateway = (gatewaysQuery.data ?? []).find(
      (gateway) => gateway.settlementSource === 'stripe'
    )
    return stripeGateway?.name ?? 'Stripe'
  }, [gatewaysQuery.data])
  const utils = api.useUtils()
  const syncNow = api.money.payout.syncNow.useMutation({
    onSuccess: () => {
      void utils.money.payout.list.invalidate()
    },
  })

  const payouts = payoutsQuery.data ?? []

  // The three numbers this page is read for. Summed over the loaded page rather
  // than queried: the page is capped at 200 and a running total that disagreed
  // with the rows under it would be worse than no total at all.
  const totals = useMemo(() => {
    let deposited = 0
    let fees = 0
    let unidentified = 0
    for (const payout of payouts) {
      if (payout.status !== 'paid') continue
      deposited += payout.depositedMinor
      fees += payout.feesMinor
      unidentified += payout.unrecognisedNetMinor
    }
    return { deposited, fees, unidentified }
  }, [payouts])

  // 🛑 A refusal from the sync is a CARD, not a toast. `syncNow` returns its
  // run summary including the payouts it could not post, because one refused
  // payout must not present as "the sync failed" when eleven others posted.
  const blockers: LedgerBlocker[] = []
  if (syncNow.error) {
    blockers.push({ status: 'error', error: syncNow.error.message })
  }
  for (const refusal of syncNow.data?.refused ?? []) {
    blockers.push({
      status: 'error',
      error: `Payout ${refusal.payoutId} could not be posted: ${refusal.reason}`,
    })
  }

  return (
    <SettingsPage
      title='Payouts'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      button={
        <div className='flex items-center gap-2'>
          <Button
            variant={onlyUnidentified ? 'default' : 'outline'}
            size='sm'
            onClick={() => void setOnlyUnidentified(!onlyUnidentified)}>
            <CircleHelp />
            Unidentified only
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={syncNow.isPending}
            loadingText='Syncing...'
            onClick={() => syncNow.mutate()}>
            <RefreshCw />
            Sync now
          </Button>
        </div>
      }>
      <StatCards
        loading={payoutsQuery.isPending}
        columns={{ default: 'grid-cols-1', md: 'md:grid-cols-3' }}
        cards={[
          {
            title: 'Deposited',
            icon: <Wallet className='size-4' />,
            color: 'text-good-500',
            body: (
              <span className='font-mono tabular-nums'>
                {formatMinor(totals.deposited, DISPLAY_CURRENCY)}
              </span>
            ),
            description: 'What the processor actually paid into the bank',
          },
          {
            title: 'Processor fees',
            icon: <TrendingDown className='size-4' />,
            color: 'text-bad-500',
            body: (
              <span className='font-mono tabular-nums'>
                {formatMinor(totals.fees, DISPLAY_CURRENCY)}
              </span>
            ),
            description: 'Withheld on the charges auxx recognised',
          },
          {
            title: 'Unidentified',
            icon: <CircleHelp className='size-4' />,
            color: 'text-comparison-500',
            body: (
              <span className='font-mono tabular-nums'>
                {formatMinor(totals.unidentified, DISPLAY_CURRENCY)}
              </span>
            ),
            description: 'Settled charges auxx has no payment for. Someone has to code these',
          },
        ]}
      />

      {/* `flex-1` so the list area fills the room under the header: it is a flex
          item of the ScrollArea's `min-h-full flex flex-col` content wrapper, which
          is what lets the empty state center itself. No `min-h-0` - a long list
          keeps its content height and the page scrolls as it always did. */}
      <div className='flex flex-1 flex-col gap-3 p-4'>
        {blockers.length > 0 && <EntryBlockers blockers={blockers} />}

        {payoutsQuery.isPending ? (
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title={onlyUnidentified ? 'Nothing unidentified' : 'No payouts yet'}
            description={
              onlyUnidentified
                ? 'Every payout auxx has ingested is fully accounted for against a payment.'
                : 'Payouts appear once the card processor settles a batch into the bank. Connect a Stripe account under Settings, or use Sync now to pull the last month.'
            }
          />
        ) : (
          <TreeRowList
            items={payouts}
            getKey={(payout) => payout.payoutId}
            renderRow={(payout) => (
              <div className='flex flex-col gap-1.5'>
                <TreeRow
                  title={payout.number ?? EMPTY_CELL}
                  secondary={`${stripeGatewayName} · ${payout.paidAt ?? 'Not settled yet'}`}
                  icon={<Landmark />}
                  trailing={
                    <div className='flex items-center gap-3'>
                      {payout.unrecognisedNetMinor > 0 && (
                        <Badge variant='outline' size='sm'>
                          {formatMinor(payout.unrecognisedNetMinor, DISPLAY_CURRENCY)} unidentified
                          {payout.unrecognisedCount > 0 ? ` (${payout.unrecognisedCount})` : ''}
                        </Badge>
                      )}
                      <span className='font-mono text-sm tabular-nums'>
                        {formatMinor(payout.depositedMinor, DISPLAY_CURRENCY)}
                      </span>
                      <Badge variant={STATUS_TONE[payout.status] ?? 'secondary'} size='sm'>
                        {STATUS_LABEL[payout.status] ?? payout.status}
                      </Badge>
                      {/* 🛑 Brief 18 §1: a `paid` payout with no bank line is a
                          real signal - either the deposit has not landed or
                          somebody coded it by hand instead of matching it. */}
                      {payout.bankTransactionId ? (
                        <Badge variant='green' size='sm'>
                          matched
                        </Badge>
                      ) : (
                        payout.status === 'paid' && (
                          <Badge variant='outline' size='sm'>
                            unmatched
                          </Badge>
                        )
                      )}
                    </div>
                  }
                />
                {/* 🛑 Brief 13 §2.3: a payout debits a bank account, not a role, and
                    refuses to post until its Stripe destination is confirmed on
                    one. `bank_account_unmapped` is the same shape the deposit's
                    own unmapped-account refusal uses (`deposits-page.tsx`). */}
                {payout.blockedReason && (
                  <EntryBlockers
                    blockers={[{ status: 'bank_account_unmapped', error: payout.blockedReason }]}
                  />
                )}
              </div>
            )}
          />
        )}
      </div>
    </SettingsPage>
  )
}
