// apps/web/src/components/accounting/ui/banking/settlements/settlements-page.tsx

'use client'

// Accounting > Banking > Settlements (brief 49 §1, §7; brief 27 §8.2, §9).
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
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CircleHelp, Landmark, PanelRight, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo, useState } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { EMPTY_CELL, ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useBulkMode,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useMedia } from '~/hooks/use-media'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { EntryBlockers, type LedgerBlocker } from '../../ledger/entry-blockers'
import { formatMinor } from '../../ledger/format'
import { PayoutEvidenceDrawer } from '../payouts/payout-evidence-drawer'
import { RailStrip } from './rail-strip'
import { settlementDay, settlementDisplay } from './settlement-display'
import {
  EMPTY_SETTLEMENT_FILTERS,
  type SettlementFilters,
  SettlementsToolbar,
} from './settlements-toolbar'

/** The ledger is pinned to USD for the cutover (`LEDGER_CURRENCY`). */
const DISPLAY_CURRENCY = 'USD'

/** The status hue, the same dot vocabulary `payouts-page.tsx` colours. */
const STATUS_DOT: Record<string, string> = {
  paid: 'bg-green-500',
  in_transit: 'bg-blue-500',
  failed: 'bg-destructive',
  canceled: 'bg-muted-foreground',
  reversed: 'bg-amber-500',
}

/** Inspect settlements recorded through the existing payout workflow. */
export function SettlementsPage() {
  return (
    <ListSelectionProvider>
      <SettlementsBody />
    </ListSelectionProvider>
  )
}

function SettlementsBody() {
  const { can } = useAccess()
  useRequireCapability(PermissionKey.ledgerView)

  const [onlyUnidentified, setOnlyUnidentified] = useQueryState('unidentified', {
    parse: (value) => value === '1',
    serialize: (value) => (value ? '1' : ''),
    defaultValue: false,
  })

  // Search and the date range stay LOCAL, the split `payouts-page.tsx` makes:
  // a text box in the URL is a history entry per keystroke, and the tab above
  // it is the only part of this view worth linking to.
  const [filters, setFilters] = useState<SettlementFilters>(EMPTY_SETTLEMENT_FILTERS)

  /**
   * `?payout=` holds the PROVIDER's payout id, which is what a settlement row
   * carries; the drawer is keyed on the `MoneyTransfer` the sync imported, so
   * the id is resolved rather than guessed. Null means nothing was imported
   * for this payout and there is no evidence to open.
   */
  const [openPayoutId, setOpenPayoutId] = useQueryState('payout')
  const evidenceId = api.payoutEvidence.idForExternalId.useQuery(
    { externalId: openPayoutId ?? '' },
    { enabled: !!openPayoutId }
  )
  // A payout nothing was imported for has no evidence to show, so the link closes.
  useEffect(() => {
    if (openPayoutId && evidenceId.isSuccess && evidenceId.data === null) void setOpenPayoutId(null)
  }, [openPayoutId, evidenceId.isSuccess, evidenceId.data, setOpenPayoutId])

  // Selection works as the review queue's does: available on every row, pinned
  // once something is picked, and a row click extends the pick until it clears.
  // There is no bulk action on a payout yet, so the bar only counts and clears.
  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const toggle = useListSelection((state) => state.toggle)
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view tab is the trigger
  useEffect(() => {
    exitSelection()
  }, [onlyUnidentified])

  /** ⚠️ 1280px, the breakpoint `payouts-page.tsx` docks at behind the same layout. */
  const isDesktop = useMedia('(min-width: 1280px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  /**
   * ⚠️ Memoised: this is the query KEY, so a fresh object every render would be
   * a new key every render. `undefined` for anything unset, never `''` - a
   * blank string is a filter the server would honour by matching nothing.
   */
  const listInput = useMemo(
    () => ({
      limit: 50,
      ...(onlyUnidentified ? { onlyUnidentified: true } : {}),
      search: filters.search.trim() || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [onlyUnidentified, filters]
  )

  const payoutsQuery = api.money.payout.list.useInfiniteQuery(listInput, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

  // The gateway named on the row's `secondary` (brief 18 §1.1 b), attributed
  // per row through the payout's own `paymentGatewayId` (brief 27 unit 1;
  // brief 49 §7.1) rather than a single org-wide rail. An org running two
  // rails - or Shopify Payments instead of Stripe - reads its own name per
  // row, not one name repeated down the column.
  const gatewaysQuery = api.paymentGateway.list.useQuery()
  const gatewayById = useMemo(
    () => new Map((gatewaysQuery.data ?? []).map((gateway) => [gateway.id, gateway])),
    [gatewaysQuery.data]
  )
  const utils = api.useUtils()
  const syncNow = api.money.payout.syncNow.useMutation({
    onSuccess: () => {
      void utils.money.payout.list.invalidate()
    },
  })

  const payouts = useMemo(
    () => payoutsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [payoutsQuery.data?.pages]
  )
  const payoutIds = useMemo(() => payouts.map((payout) => payout.payoutId), [payouts])
  useEffect(() => {
    setItemIds(payoutIds)
  }, [payoutIds, setItemIds])

  /** Whether an empty list is "these filters exclude everything" or "nothing exists". */
  const narrowed = !!filters.search.trim() || !!filters.from || !!filters.to

  // ⚠️ Built ONCE and memoised - the panel array below is published to the
  // accounting layout's docked slot through an effect.
  const drawer = useMemo(
    () => (
      <PayoutEvidenceDrawer
        payoutId={evidenceId.data ?? null}
        /* Open on the URL, not on the resolved id: switching rows re-resolves,
           and gating on the result unmounted and remounted the panel each time. */
        open={!!openPayoutId}
        onOpenChange={(open) => {
          if (!open) void setOpenPayoutId(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
      />
    ),
    [evidenceId.data, openPayoutId, setOpenPayoutId, isDesktop, dockedWidth, setDockedWidth]
  )

  const dockedPanels = useMemo(
    () =>
      isDesktop && openPayoutId
        ? [
            {
              key: 'payout',
              content: drawer,
              width: dockedWidth,
              onWidthChange: setDockedWidth,
              minWidth: 380,
              maxWidth: 800,
            },
          ]
        : [],
    [isDesktop, openPayoutId, drawer, dockedWidth, setDockedWidth]
  )
  useRegisterDockedPanels(dockedPanels)

  // 🛑 A refusal from the sync is a CARD, not a toast. `syncNow` returns its
  // run summary including the payouts it could not post, because one refused
  // payout must not present as "the sync failed" when eleven others posted.
  const blockers: LedgerBlocker[] = []
  if (payoutsQuery.error) blockers.push({ status: 'error', error: payoutsQuery.error.message })
  if (syncNow.error) {
    blockers.push({ status: 'error', error: syncNow.error.message })
  }
  for (const refusal of syncNow.data?.refused ?? []) {
    blockers.push({
      status: 'error',
      error: `Payout ${refusal.payoutId} could not be posted: ${refusal.reason}`,
    })
  }

  useRegisterModuleToolbar(
    useMemo(
      () => ({
        left: <ToolbarTitle>Settlements</ToolbarTitle>,
        // 🛑 The view tabs and the select-all stay in the page's own
        // `ListToolbar` (81 §3): the `RadioTab` is what makes the bar 48px
        // tall, and `SelectAllCheckbox`'s offset is derived from that height.
        right: can(PermissionKey.ledgerPost) ? (
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            loading={syncNow.isPending}
            loadingText='Syncing...'
            onClick={() => syncNow.mutate()}>
            <RefreshCw />
            Sync settlements
          </Button>
        ) : null,
      }),
      [can, syncNow.isPending, syncNow.mutate]
    )
  )

  return (
    <>
      <div className='flex min-h-0 flex-1 flex-col'>
        {/* Brief 27 §8.2: one row per rail with a clearing account, below the
            totals and above the payout list. The strip is where a billed rail
            - which never gets a payout record - is visible at all. */}
        <div className='flex shrink-0 flex-col gap-3 p-4'>
          <RailStrip currencyCode={DISPLAY_CURRENCY} />

          {blockers.length > 0 && <EntryBlockers blockers={blockers} />}
        </div>

        {/* Full-bleed, so its rule runs to both edges of the page rather than
            stopping inside a padded column - the Payouts toolbar's placement. */}
        <SettlementsToolbar
          onlyUnidentified={onlyUnidentified}
          onOnlyUnidentifiedChange={(next) => void setOnlyUnidentified(next)}
          filters={filters}
          onChange={setFilters}
          selectAll={<SelectAllCheckbox listPadding={16} />}
        />

        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-1 flex-col gap-1 p-4 pb-24'>
            {payoutsQuery.isPending ? (
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
                <Skeleton className='h-10 w-full' />
              </div>
            ) : payouts.length === 0 ? (
              <EmptyState
                icon={Landmark}
                title={
                  narrowed
                    ? 'Nothing in this view'
                    : onlyUnidentified
                      ? 'Nothing unidentified'
                      : 'No payouts yet'
                }
                description={
                  narrowed
                    ? 'No settlements match these filters. Widen the date range, or clear them, to see everything recorded.'
                    : onlyUnidentified
                      ? 'No posted settlements have unidentified amounts. Imported payouts may still be awaiting accounting.'
                      : 'Payouts appear when your connected payment provider imports them.'
                }
              />
            ) : (
              <TreeRowList
                items={payouts}
                className='gap-px'
                getKey={(payout) => payout.payoutId}
                renderRow={(payout) => {
                  const display = settlementDisplay(payout)
                  /* 🛑 The SOURCE's external id first: a synced payout carries the
                   provider's id there, and only a posted one also has
                   `payout_gateway_id`. Keying on the latter alone left the
                   drawer unreachable on 264 of 269 rows here. */
                  const externalId = payout.sourceSummary?.externalId ?? payout.gatewayId
                  const rail = payout.paymentGatewayId
                    ? gatewayById.get(payout.paymentGatewayId)
                    : undefined
                  const source = payout.sourceSummary
                  const railName = source
                    ? (source.gatewayName ??
                      `${source.provider === 'shopify_payments' ? 'Shopify Payments' : (source.provider ?? 'Unknown provider')} · Setup required`)
                    : (rail?.name ?? 'Unrouted')
                  return (
                    <div className='flex flex-col gap-1.5'>
                      <TreeRow
                        className={TREE_SECONDARY_NOTRUNCATE}
                        icon={<Landmark className='size-4 text-muted-foreground' />}
                        selectable
                        selecting={selecting}
                        selected={selectedIds.includes(payout.payoutId)}
                        onSelectChange={(_next, event) =>
                          toggle(payout.payoutId, { shiftKey: event.shiftKey })
                        }
                        selectLabel={`Select ${payout.number ?? payout.payoutId}`}
                        /* Date then number in one fixed-width mono column, the way
                       the Payouts list leads its rows. */
                        title={
                          <span className='flex min-w-0 items-center gap-1.5'>
                            <span className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                              {settlementDay(payout) ?? EMPTY_CELL}
                            </span>
                            {/* The number is eight characters and fixed-format, so
                            it keeps its width rather than truncating under a
                            long badge in `secondary`. */}
                            <span className='shrink-0 text-sm'>{payout.number ?? EMPTY_CELL}</span>
                          </span>
                        }
                        secondary={
                          <span className='flex flex-wrap items-center gap-1.5'>
                            <Badge variant='outline' size='xs'>
                              {railName}
                            </Badge>
                            {/* Brief 49 §7.2: an `imported` payout has no itemisation,
                            so its structural zero in `unrecognisedNetMinor` means
                            "nothing to split", never "everything recognised" -
                            27-a §4 rule 2's own wording. */}
                            {source && !payout.glPostingId && (
                              <Badge variant='outline' size='xs'>
                                Pending accounting
                              </Badge>
                            )}
                            {!source && payout.source === 'imported' && (
                              <Badge variant='outline' size='xs'>
                                No itemisation
                              </Badge>
                            )}
                            {payout.unrecognisedNetMinor > 0 && (
                              <Badge variant='amber' size='xs'>
                                <CircleHelp />
                                {formatMinor(payout.unrecognisedNetMinor, DISPLAY_CURRENCY)}{' '}
                                unidentified
                                {payout.unrecognisedCount > 0
                                  ? ` (${payout.unrecognisedCount})`
                                  : ''}
                              </Badge>
                            )}
                          </span>
                        }
                        /* Where the row ends, at the same x on every line: the
                       money, the status as a dot plus its word, then whether a
                       bank line was ever matched to it. */
                        actions={
                          <div className='flex items-center gap-2'>
                            <span className='font-mono text-xs tabular-nums'>
                              {display.amountMinor !== null &&
                              display.currency &&
                              display.currencyExponent !== null
                                ? formatMinor(Number(display.amountMinor), display.currency)
                                : 'Amount unavailable'}
                            </span>
                            <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                              <span
                                className={cn(
                                  'size-1.5 rounded-full',
                                  STATUS_DOT[display.status] ?? 'bg-muted-foreground'
                                )}
                                aria-hidden
                              />
                              {display.status.replaceAll('_', ' ')}
                            </span>
                            {/* 🛑 Brief 18 §1: a `paid` payout with no bank line is a
                            real signal - either the deposit has not landed or
                            somebody coded it by hand instead of matching it. */}
                            {payout.bankTransactionId ? (
                              <Badge variant='green' size='sm'>
                                matched
                              </Badge>
                            ) : (
                              display.status === 'paid' && (
                                <Badge variant='outline' size='sm'>
                                  unmatched
                                </Badge>
                              )
                            )}
                            {/* The provider's payout id is what the drawer
                              resolves its evidence from, so a hand-recorded
                              payout with no id has no panel to open. */}
                            {externalId && (
                              <TreeRowButton
                                persistent
                                tooltipText='Open details'
                                onClick={() => void setOpenPayoutId(externalId)}>
                                <PanelRight />
                              </TreeRowButton>
                            )}
                          </div>
                        }
                        /* Mid-selection a row click extends the pick; otherwise it
                       opens the drawer, the same split the review queue makes. */
                        onToggleOpen={() => {
                          if (selecting) toggle(payout.payoutId)
                          else if (externalId) void setOpenPayoutId(externalId)
                        }}
                        rowClassName={cn(
                          openPayoutId === externalId && 'bg-primary-100 ring-1 ring-primary-200',
                          selectedIds.includes(payout.payoutId) &&
                            cn(
                              'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
                              openPayoutId === externalId && 'ring-info/40'
                            )
                        )}
                      />
                      {/* 🛑 Brief 13 §2.3: a payout debits a bank account, not a role, and
                    refuses to post until its Stripe destination is confirmed on
                    one. `bank_account_unmapped` is the same shape the deposit's
                    own unmapped-account refusal uses (`deposits-page.tsx`). */}
                      {source?.amountIssue && (
                        <p className='text-sm text-bad-500'>{source.amountIssue}</p>
                      )}
                      {source?.routingIssue && (
                        <p className='text-sm text-muted-foreground'>
                          {source.routingIssue}{' '}
                          <Link
                            className='underline'
                            href='/app/accounting/settings/payment-gateways'>
                            Review payment gateways
                          </Link>
                        </p>
                      )}
                      {payout.blockedReason && (
                        <EntryBlockers
                          blockers={[
                            { status: 'bank_account_unmapped', error: payout.blockedReason },
                          ]}
                        />
                      )}
                    </div>
                  )
                }}
              />
            )}

            {/* `key` on the filters: a new view is a new pile, so the tail's
                auto-fetch budget starts over rather than carrying the last
                one's. Same as the payouts list and the review queue. */}
            <InfiniteListTail
              key={JSON.stringify(listInput)}
              hasNextPage={payoutsQuery.hasNextPage}
              isFetchingNextPage={payoutsQuery.isFetchingNextPage}
              fetchNextPage={payoutsQuery.fetchNextPage}
              loadingLabel='Loading more settlements...'
            />
          </div>
        </ScrollArea>
      </div>

      <ActionBar
        open={selectedIds.length > 0}
        onOpenChange={(open) => !open && exitSelection()}
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        actions={[]}
        showClose
      />

      {/* Below the dock breakpoint the same drawer is a floating overlay. */}
      {!isDesktop && drawer}
    </>
  )
}
