// apps/web/src/components/accounting/ui/banking/payouts/settlement-history.tsx

'use client'

// Accounting > Banking > Payouts (HANDOFF §11.5 item 1; brief 27 §8.2, §9).
//
// ## What this screen is for
//
// A shipment DEBITS the rail's clearing account gross (26: one account per
// rail, `1200 Card Clearing` for anything unrouted). The rail settles days
// later, and THAT is what credits clearing again: a payout record on a `netted`
// rail, or a bank line coded "Settlement of <rail>" on a `billed` one (27 §3).
// Without the settlement side, clearing grew without bound and the processor's
// fee was never expensed. The per-rail strip below the totals is where each
// account's balance is read.
//
// 🛑 "Clearing balance", never "unsettled" (27 §10.3). Until brief 29 moves the
// clearing debit to the payment date the balance is a NET of two queues -
// shipped-not-settled less settled-not-shipped - and a payout routinely exceeds
// it (27 §1.7). Nothing on this page may describe it as what the processor
// holds; the wording changes only in brief 29's own change.
//
// ## 🛑 The Unidentified column is the one somebody has to work
//
// A payout settles every charge the merchant took, INCLUDING charges taken
// outside auxx - a payment link sent from the Stripe dashboard, a subscription
// on the same account, a terminal. Those were never debited to clearing, so
// crediting the payout's full gross would drive clearing permanently negative.
// Instead cash takes the whole deposit, clearing is relieved of exactly what
// auxx put in it, and the remainder is credited to `2450 Unidentified Receipts`.
// That balance is real money whose revenue has never been recognised, and only a
// person can say what it was for.
//
// ⚠️ There is no edit and no delete affordance anywhere on this page, for any
// row, on purpose - and no dialog that types a payout in by hand (27 §2: 250
// forms a year, and the three numbers can only ever agree). A payout is a
// TRANSCRIPTION of what the provider did, and the writers are the SOURCES
// (27 §4): the Stripe Connect sync today, statement imports next ("Import
// statement" on the strip is the door, disabled until unit 3 lands). An
// imported row is as immutable as a synced one; a wrong payout, from either
// writer, is corrected by REVERSAL.
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
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'
import { RailStrip } from './rail-strip'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Payouts' },
]

const PAGE_DESCRIPTION =
  'What each payment rail actually paid into the bank, and what each payout relieved from its clearing account. A clearing balance is what the account holds today: shipments debited, settlements credited. An unidentified balance is money that arrived whose revenue nobody has recognised.'

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

/** Inspect settlements recorded through the existing payout workflow. */
export function SettlementHistory({ onEvidence }: { onEvidence: () => void }) {
  const { can } = useAccess()
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
      title='Settlement history'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      button={
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='outline' size='sm' onClick={onEvidence}>
            Payout evidence
          </Button>
          <Button
            variant={onlyUnidentified ? 'default' : 'outline'}
            size='sm'
            onClick={() => void setOnlyUnidentified(!onlyUnidentified)}>
            <CircleHelp />
            Unidentified only
          </Button>
          {can(PermissionKey.ledgerPost) && (
            <Button
              variant='outline'
              size='sm'
              loading={syncNow.isPending}
              loadingText='Syncing...'
              onClick={() => syncNow.mutate()}>
              <RefreshCw />
              Sync settlements
            </Button>
          )}
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
        {/* Brief 27 §8.2: one row per rail with a clearing account, below the
            totals and above the payout list. The strip is where a billed rail
            - which never gets a payout record - is visible at all. */}
        <RailStrip currencyCode={DISPLAY_CURRENCY} />

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
