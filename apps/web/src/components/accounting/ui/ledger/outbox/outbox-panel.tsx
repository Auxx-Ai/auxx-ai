// apps/web/src/components/accounting/ui/ledger/outbox/outbox-panel.tsx

'use client'

// Accounting > Ledger > the OUTBOX (TARGET §3, §4 gate 1 and 2, step 3 part C).
//
// One strip over the whole pipeline of work leaving the books: Drafts (posted
// with `autoPost` off), Blocked (the ledger refused the movement), then the
// export-batch states. This is the list half - the strip and its counts; each
// tab's rows live in its own panel beside this file.
//
// Lists default to all periods. Select-all leads the second toolbar row.

import {
  type ExportBatchTab,
  isExportBatchTab,
  OUTBOX_TABS,
  type OutboxGroupBy,
  type OutboxOrder,
  type OutboxTab,
  type OutboxView,
} from '@auxx/lib/accounting/export/client'
import { EXPORT_AVENUES } from '@auxx/lib/accounting/ledger/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ChevronDown, Layers, List, Loader } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ListSelectionProvider, useListSelection } from '~/components/list-selection'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BlockedPanel } from './blocked-panel'
import { DraftsPanel } from './drafts-panel'
import { TAB_ICON, TAB_LABEL } from './outbox-tabs'
import { EMPTY_OUTBOX_FILTERS, type OutboxFilters, OutboxToolbar } from './outbox-toolbar'
import { SummaryPanel } from './summary-panel'
import { TransactionsPanel } from './transactions-panel'
import { type OutboxRun, useOutboxRealtime } from './use-outbox-realtime'

interface OutboxPanelProps {
  tab: OutboxTab
  onTabChange: (tab: OutboxTab) => void
  /** How the batch tabs are grouped and ordered - `?group=` and `?order=`, so a link carries the view. */
  groupBy: OutboxGroupBy | null
  onGroupByChange: (groupBy: OutboxGroupBy | null) => void
  order: OutboxOrder
  onOrderChange: (order: OutboxOrder) => void
  /** `?view=`; null follows the org's export mode. Drafts and Blocked ignore it. */
  view: OutboxView | null
  onViewChange: (view: OutboxView) => void
  bookTimeZone: string
  currencyCode: string
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** So an open row reads as "the one you are looking at" the same as the rail strip does. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
  activeMovementId: string | null
  onSelectMovement: (moneyTransactionId: string) => void
  /** A refused shipment opens its `?shipment=` frame in the same drawer slot. */
  activeShipmentId: string | null
  onSelectShipment: (fulfillmentId: string) => void
}

/**
 * The outbox. One `ListSelectionProvider` per mount, same as the banking review
 * queue - leaving the outbox disposes the selection.
 */
export function OutboxPanel(props: OutboxPanelProps) {
  return (
    <ListSelectionProvider>
      <OutboxBody {...props} />
    </ListSelectionProvider>
  )
}

function OutboxBody({
  tab,
  onTabChange,
  groupBy,
  onGroupByChange,
  order,
  onOrderChange,
  view: viewParam,
  onViewChange,
  bookTimeZone,
  currencyCode,
  providerLabel,
  activePostingId,
  onSelectPosting,
  activeMovementId,
  onSelectMovement,
  activeShipmentId,
  onSelectShipment,
}: OutboxPanelProps) {
  const { can } = useAccess()
  const canRelease = can(PermissionKey.ledgerPost)
  const canRollback = can(PermissionKey.ledgerControl)

  // 🛑 Drafts and Blocked are `ledgerPost`-gated on the server, so the tabs are
  // absent, not disabled, for a read-only member - a tab that 403s on click is
  // worse than one never offered. `effectiveTab` catches a pasted link.
  const effectiveTab: OutboxTab =
    (tab === 'drafts' || tab === 'blocked') && !canRelease ? 'ready' : tab
  // One filter state across every tab: the category vocabulary is the same on all of them.
  const [filters, setFilters] = useState(EMPTY_OUTBOX_FILTERS)
  const search = useDebounce(filters.search.trim(), 250)
  const appliedFilters = { ...filters, search }
  // ⚠️ Free: `useSettings` rides the org cache the provider already hydrated.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const view: OutboxView =
    viewParam ?? (getSetting('accounting.exportMode') === 'summary' ? 'summary' : 'transaction')
  const filterKey = JSON.stringify([effectiveTab, filters, groupBy, order, view])
  const searchPending = search !== filters.search.trim()
  const filtered = !!(search || filters.categories.length || filters.from || filters.to)
  const tabs = useMemo(
    () => OUTBOX_TABS.filter((value) => canRelease || isExportBatchTab(value)),
    [canRelease]
  )

  const live = useOutboxRealtime()

  // One SQL read for every badge - no tab's count rides on its rows.
  const countsQuery = api.ledger.outboxCounts.useQuery()
  const counts = countsQuery.data
  const tally: Record<OutboxTab, number> = {
    drafts: counts?.drafts ?? 0,
    blocked: counts?.blocked ?? 0,
    // Ready holds `sending` too (75-D6).
    ready: (counts?.ready ?? 0) + (counts?.sending ?? 0) + (counts?.unbuilt ?? 0),
    sent: counts?.sent ?? 0,
    failed: counts?.failed ?? 0,
  }

  const heldForRelease = EXPORT_AVENUES.every(
    (avenue) =>
      getSetting(`accounting.autoSend.${avenue}` as Parameters<typeof getSetting>[0]) !== true
  )

  const exitSelection = useListSelection((state) => state.exit)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tab and filters trigger a selection reset
  useEffect(() => {
    exitSelection()
  }, [filterKey])

  const changeFilters = (next: OutboxFilters) => {
    exitSelection()
    setFilters(next)
  }
  const clearFilters = () => changeFilters(EMPTY_OUTBOX_FILTERS)
  const clearAction = filtered ? (
    <Button variant='outline' size='sm' onClick={clearFilters}>
      Clear filters
    </Button>
  ) : undefined

  const emptyCopy = (value: OutboxTab) =>
    filtered
      ? 'Try another search, category, or date range.'
      : emptyDescription(value, providerLabel, heldForRelease)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='shrink-0'>
        <ListToolbar sticky={false}>
          <ListToolbarGroup className='shrink-0'>
            <RadioTab
              value={effectiveTab}
              onValueChange={(value) => onTabChange(value as OutboxTab)}
              size='sm'>
              {tabs.map((value) => {
                const Icon = TAB_ICON[value]
                const count = tally[value]
                return (
                  <RadioTabItem key={value} value={value}>
                    <Icon />
                    {TAB_LABEL[value]}
                    {count > 0 && (
                      <span
                        title='Total before search, category, and date filters'
                        className='tabular-nums opacity-60'>
                        {count}
                      </span>
                    )}
                  </RadioTabItem>
                )
              })}
            </RadioTab>
            {isExportBatchTab(effectiveTab) && (
              <ViewDropdown view={view} onViewChange={onViewChange} />
            )}
          </ListToolbarGroup>
        </ListToolbar>
        <OutboxToolbar
          tab={effectiveTab}
          filters={filters}
          onChange={changeFilters}
          onClear={clearFilters}
          selectionDisabled={searchPending}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          order={order}
          onOrderChange={onOrderChange}
        />
      </div>

      {live.run && <RunStrip run={live.run} />}

      {/* List page, so the bar pins and only the rows move (§6). */}
      {/* Keyed so a tab, filter, group or order change starts at the top: a viewport left at the
          bottom of the old list sits on the new list's tail and keeps paging it in. */}
      <ScrollArea key={filterKey} className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {searchPending ? (
          <p role='status' className='p-3 text-sm text-muted-foreground'>
            Searching…
          </p>
        ) : (
          <div className='flex flex-1 flex-col'>
            {effectiveTab === 'blocked' ? (
              <BlockedPanel
                filters={appliedFilters}
                emptyTitle={filtered ? 'No matching results' : undefined}
                emptyAction={clearAction}
                emptyDescription={emptyCopy('blocked')}
                bookTimeZone={bookTimeZone}
                activeMovementId={activeMovementId}
                onSelectMovement={onSelectMovement}
                activeShipmentId={activeShipmentId}
                onSelectShipment={onSelectShipment}
              />
            ) : effectiveTab === 'drafts' ? (
              <DraftsPanel
                filters={appliedFilters}
                emptyTitle={filtered ? 'No matching results' : undefined}
                emptyAction={clearAction}
                emptyDescription={emptyCopy('drafts')}
                currencyCode={currencyCode}
                bookTimeZone={bookTimeZone}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
              />
            ) : view === 'transaction' ? (
              <TransactionsPanel
                // Remounts per tab, so one tab's open rows and selection never leak into the next.
                key={effectiveTab}
                tab={effectiveTab}
                filters={appliedFilters}
                order={order}
                groupBy={groupBy}
                bookTimeZone={bookTimeZone}
                currencyCode={currencyCode}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
                emptyTitle={filtered ? 'No matching results' : emptyTitle(effectiveTab)}
                emptyDescription={emptyCopy(effectiveTab)}
                emptyAction={clearAction}
              />
            ) : (
              <SummaryPanel
                key={effectiveTab}
                tab={effectiveTab}
                filters={appliedFilters}
                order={order}
                groupBy={groupBy}
                bookTimeZone={bookTimeZone}
                providerLabel={providerLabel}
                canRelease={canRelease}
                canRollback={canRollback}
                activePostingId={activePostingId}
                onSelectPosting={onSelectPosting}
                onReleased={live.startRun}
                watchRun={live.watchRun}
                emptyTitle={filtered ? 'No matching results' : emptyTitle(effectiveTab)}
                emptyDescription={emptyCopy(effectiveTab)}
                emptyAction={clearAction}
              />
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

/** The open release's tally; the rows below move on their own. */
function RunStrip({ run }: { run: OutboxRun }) {
  return (
    <p
      role='status'
      className='flex shrink-0 items-center gap-1.5 px-3 pt-3 text-muted-foreground text-xs tabular-nums'>
      <Loader className='size-3 animate-spin' />
      {run.sent} of {run.total} sent · {run.failed} failed
      {run.waiting > 0 && ` · ${run.waiting} waiting`}
    </p>
  )
}

const VIEW_LABEL: Record<OutboxView, string> = { summary: 'Summary', transaction: 'Transaction' }

/** Summary rows are period buckets, Transaction rows are postings (95 §3.1). */
function ViewDropdown({
  view,
  onViewChange,
}: {
  view: OutboxView
  onViewChange: (view: OutboxView) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='sm' aria-label={`View: ${VIEW_LABEL[view]}`}>
          {view === 'summary' ? <Layers /> : <List />}
          {VIEW_LABEL[view]}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(value) => onViewChange(value === 'summary' ? 'summary' : 'transaction')}>
          <DropdownMenuRadioItem value='summary'>Summary</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='transaction'>Transaction</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** ⚠️ An empty Ready tab is the HEALTHY state and has to read like one. */
function emptyTitle(tab: ExportBatchTab): string {
  switch (tab) {
    case 'ready':
      return 'Nothing is waiting to be sent'
    case 'sent':
      return 'Nothing has been sent yet'
    case 'failed':
      return 'Nothing has been refused'
  }
}

/** Why a tab is empty (75-D7) - it used to read as a fault. */
function emptyDescription(tab: OutboxTab, providerLabel: string, heldForRelease: boolean): string {
  const held = heldForRelease
    ? ' No avenue has auto-send switched on, so nothing leaves until somebody presses Send.'
    : ''
  switch (tab) {
    case 'blocked':
      return 'Nothing the ledger refused is waiting. A movement lands here when its entry could not be built - an account role nothing is mapped to, a period that is shut - and leaves it the moment a retry is accepted.'
    case 'drafts':
      return `A draft is left here when its avenue posts with autoPost switched off (Settings › Posting). Approving one posts its entry and puts it on Ready - as its own row in Transaction mode, or inside its period's summary in Summary mode.${held}`
    case 'ready':
      return `These tabs list every period, so nothing anywhere is waiting to be sent.${held}`
    case 'sent':
      return `Nothing has settled in ${providerLabel} yet, in any period.${held}`
    case 'failed':
      return `${providerLabel} has not refused anything, in any period. A refusal shows the reason it gave, on the row.`
  }
}
