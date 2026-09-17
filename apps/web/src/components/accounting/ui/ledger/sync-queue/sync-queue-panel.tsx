// apps/web/src/components/accounting/ui/ledger/sync-queue/sync-queue-panel.tsx

'use client'

// Accounting > Ledger > the SYNC QUEUE
// (plans/accounting/tasks/53-two-modes-one-ledger.md §7.2, decision D17).
//
// ## What this screen is for
//
// `quickbooks.postJournalEntries` OFF is the hold: a posting is accepted,
// balanced, claimed and written to our books, and its delivery is created
// UNRELEASED (`delivery.ts:93`). It then rests at `exportStatus: 'pending'` with
// nothing sent anywhere. This is the surface that releases it. MK, 2026-09-15:
// *"we are posting right away to quickbooks. we dont want that. we want it
// similar to synder where we can see the summaries and posting and then post
// 'sync' them to quickbooks."*
//
// ## 🛑 ONE list, and not a second route (D17)
//
// Synder splits Register from Summaries because those are different GRAINS -
// one entry per transaction versus the summary derived from it. **We have no
// such split.** `GlPosting` IS the aggregate, so an "exports" page would list
// the same rows the ledger lists with different columns. So this is a panel in
// the ledger's own column, reached from the rail's Sync queue item, addressed
// by `?queue=<tab>`, and rows open the EXISTING `?posting=<id>` drawer. No new
// route, no new detail view.
//
// ## 🛑 Two status axes, not one (§7.2.5)
//
// `exportStatus` alone cannot say what a row needs, because with the hold on
// `pending` stops meaning "in flight" and becomes the resting state of every
// entry the organization posts. The RELEASE axis
// (`AccountingDelivery.releasedAt`) is what separates *held* from *sending*, and
// `syncQueueState` is the one place the two collapse into a word. Three tabs,
// never one pile.
//
// ## 🛑 All periods, always
//
// Every other ledger surface resolves a month (`?month=YYYY-MM`). This one must
// not: the entries it is about are a backlog that spans months, and a month
// filter would hide every held posting from before the one on screen.
// `listFailedExports` is called with no `through` bound, and the period picker
// below defaults to All and narrows what is ALREADY loaded.

import { type SyncQueueRow, syncQueueState } from '@auxx/lib/postings/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, CircleAlert, FileText, Loader, PanelRight, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useBulkMode,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { useViewportFill } from '~/hooks/use-viewport-fill'
import { api } from '~/trpc/react'
import { EMPTY_CELL, formatMinor, formatPeriodLabel } from '../format'
import {
  filterSyncQueue,
  refusalTooltipLines,
  SYNC_QUEUE_STATE_DOT,
  SYNC_QUEUE_TAB_LABELS,
  SYNC_QUEUE_TABS,
  type SyncQueueTab,
  syncQueuePeriods,
  syncQueueStateSentence,
  tallySyncQueue,
} from './sync-queue-rows'

/** The panel never fills less than this, however short the viewport is. */
const MIN_PANEL_HEIGHT = 260

/** "All periods" as a `Select` value. Never the empty string - `SelectItem` refuses one. */
const ALL_PERIODS = 'all'

/** The tab icons. `Loader` is not a spinner here - it is "on its way". */
const TAB_ICON = {
  held: CheckCircle2,
  sending: Loader,
  failed: CircleAlert,
  all: FileText,
} as const

interface SyncQueuePanelProps {
  rows: SyncQueueRow[] | undefined
  isLoading: boolean
  /** The read's own failure, or `null`. */
  error: string | null
  tab: SyncQueueTab
  onTabChange: (tab: SyncQueueTab) => void
  /** 🔌 Never a vendor name in this file. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** `ledger.post`. Without it the queue is readable and nothing can be released. */
  canSync: boolean
  /** The posting open in the drawer, so the row can show it is the one being read. */
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
}

/**
 * The queue. Modelled on `banking/review-queue-page.tsx`, which was built to
 * clear a pile and already had every part this needs - `TreeRowList`, state
 * tabs, bulk selection, and rows that open a drawer rather than a page.
 *
 * ⚠️ It is a PANEL, not that page: it renders inside the ledger's own scroll
 * column, so there is no `SettingsPage` and no docked panel of its own. The
 * drawer it opens is the ledger's, already mounted.
 *
 * The provider is mounted HERE, not by the ledger page: one selection store per
 * list, scoped to the view that owns it, so leaving the queue disposes it.
 */
export function SyncQueuePanel(props: SyncQueuePanelProps) {
  return (
    <ListSelectionProvider>
      <SyncQueueBody {...props} />
    </ListSelectionProvider>
  )
}

function SyncQueueBody({
  rows,
  isLoading,
  error,
  tab,
  onTabChange,
  providerLabel,
  canSync,
  activePostingId,
  onSelectPosting,
}: SyncQueuePanelProps) {
  const utils = api.useUtils()
  /**
   * A floor, not a height: the empty state is `flex-1` and centres in whatever
   * room it is given, and the ledger's scroll column is auto-height - so
   * without this it pins to the toolbar instead of the middle of the screen. A
   * MIN leaves a long queue free to grow past the fold as it always did.
   */
  const panelRef = useRef<HTMLDivElement>(null)
  const panelHeight = useViewportFill(panelRef, MIN_PANEL_HEIGHT)
  const [period, setPeriod] = useState<string>(ALL_PERIODS)

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const toggle = useListSelection((state) => state.toggle)
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  /**
   * Why the last Sync did not release a posting, BY POSTING.
   *
   * 🛑 Keyed rather than a flat list, because some of these never reach the row
   * any other way. `planAccountingDeliveryInTx` re-proves each effect's
   * component partition on every attempt and THROWS on a gap or an overlap
   * (`assertCoveragePartitionsInTx`) - and, like every other plan refusal, it
   * does not stamp `exportStatus: 'failed'`. So the row stays exactly where it
   * was, wearing "Ready to sync", and this message is the only thing in the
   * product that knows anything went wrong. It belongs on the row.
   *
   * Cleared by any view change - it describes a Sync you ran on a view you have
   * since left.
   */
  const [refusals, setRefusals] = useState<Record<string, string>>({})

  const all = useMemo(() => rows ?? [], [rows])
  const tally = useMemo(() => tallySyncQueue(all), [all])
  const periods = useMemo(() => syncQueuePeriods(all), [all])

  const visible = useMemo(() => {
    const byTab = filterSyncQueue(all, tab)
    return period === ALL_PERIODS ? byTab : byTab.filter((row) => row.periodKey === period)
  }, [all, tab, period])

  /**
   * What shift-range and Cmd+A read: the rows actually on screen, in render
   * order.
   *
   * 🛑 Default pruning, unlike `chart-list.tsx`. Nothing here HIDES a row from
   * a selection you are mid-way through - the tab and the period are the view
   * itself and clear it outright below - so the only other way an id leaves
   * `visible` is a refetch moving a synced posting to another tab. That row is
   * gone from this list and has to leave the selection with it.
   */
  const visibleIds = useMemo(() => visible.map((row) => row.glPostingId), [visible])
  useEffect(() => {
    setItemIds(visibleIds)
  }, [visibleIds, setItemIds])

  /**
   * ⚠️ A selection that outlives the view it was made in would act on rows that
   * are no longer listed - the same guard the banking queue keeps, and for the
   * same reason. The last run's refusals go with it: they describe a view you
   * have left.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is the trigger
  useEffect(() => {
    exitSelection()
    setRefusals({})
  }, [tab, period])

  /** A bookmarked period that has since cleared is ordinary, not an error. */
  useEffect(() => {
    if (period !== ALL_PERIODS && !isLoading && !periods.includes(period)) setPeriod(ALL_PERIODS)
  }, [period, periods, isLoading])

  const refresh = () => {
    void utils.ledger.failedExports.invalidate()
    void utils.ledger.listPostings.invalidate()
  }

  /**
   * 🛑 **Sync RELEASES. It never pushes, and one row and forty take the same
   * path.**
   *
   * An export is three to five sequential round trips to a rate-limited third
   * party. `delivery.ts`'s own header says to call it from an acceptance rather
   * than inline for exactly that reason, and #2182 landed to get exports out of
   * somebody's HTTP request; a single-row inline push is a smaller version of
   * the same shape and would spin one button through all five. So this stamps
   * `releasedAt` and hands the journal to the delivery worker, whatever the
   * selection size - see `releaseExportsForSync`.
   *
   * 🔑 The cost is real and it is paid deliberately: pressing Sync on a Refused
   * row no longer returns the provider's answer in the same breath. **That is
   * what the Sending state is for.** §7.2.5's second axis exists precisely so a
   * released-but-unacknowledged entry has somewhere honest to sit, and the row
   * moves there and comes back Refused - with the provider's own words on it -
   * if it is refused again. Two mental models behind one verb is the worse
   * trade.
   */
  const syncExports = api.ledger.syncExports.useMutation({
    onSuccess: (result) => {
      exitSelection()
      // ⚠️ `skipped` is on this list as well as `error`. An entry that is never
      // exported, or that has no destination, is not a failure - but pressing
      // Sync on it and watching nothing happen is worse than being told why.
      setRefusals(
        Object.fromEntries(
          result.outcomes
            .filter((outcome) => outcome.status === 'error' || outcome.status === 'skipped')
            .map((outcome) => [outcome.glPostingId, outcome.message ?? 'It was not released.'])
        )
      )
      refresh()
    },
    onError: (mutationError) => {
      toastError({ title: 'Could not sync', description: mutationError.message })
    },
  })

  /**
   * One row, through the same door. A single-element array, so a row synced on
   * its own is indistinguishable from one synced in a batch - same write, same
   * enqueue, same move to Sending.
   */
  const syncOne = (glPostingId: string) => syncExports.mutate({ glPostingIds: [glPostingId] })

  const refusedCount = Object.keys(refusals).length

  if (error) {
    return (
      <p className='p-3 text-destructive text-xs'>
        The sync queue could not be read, so nothing here has been checked. {error}
      </p>
    )
  }

  return (
    <div ref={panelRef} className='flex flex-col' style={{ minHeight: panelHeight }}>
      <ListToolbar>
        {canSync && <SelectAllCheckbox listPadding={12} />}

        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={tab}
            onValueChange={(value) => onTabChange(value as SyncQueueTab)}
            size='sm'>
            {SYNC_QUEUE_TABS.map((value) => {
              const Icon = TAB_ICON[value]
              const count =
                value === 'all' ? tally.total : tally[value as 'held' | 'sending' | 'failed']
              return (
                <RadioTabItem key={value} value={value}>
                  <Icon />
                  {SYNC_QUEUE_TAB_LABELS[value]}
                  {count > 0 && <span className='tabular-nums opacity-60'>{count}</span>}
                </RadioTabItem>
              )
            })}
          </RadioTab>
        </ListToolbarGroup>

        <Separator orientation='vertical' className='h-5 shrink-0' />

        <ListToolbarGroup className='shrink-0'>
          {/* 🛑 Defaults to ALL, and this is the whole of §7.2.4's month rule.
              The queue is a backlog that spans months; the month the toolbar
              above resolved is irrelevant to it, and inheriting that month would
              hide every entry held from before it. This narrows what is already
              loaded - there is no second read. */}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger size='sm' className='h-7 w-44 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PERIODS}>All periods</SelectItem>
              {periods.map((key) => (
                <SelectItem key={key} value={key}>
                  {formatPeriodLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ListToolbarGroup>
      </ListToolbar>

      {/* ⚠️ A COUNT here, with the reasons themselves on the rows. Spelling out
          six coverage refusals above a list of forty puts the explanation a
          screen away from the entry it is about, and the row is where somebody
          is looking. No success toast by policy, so a run that released
          everything says nothing at all - which is the right amount. */}
      {refusedCount > 0 && (
        <p className='px-3 pt-3 text-amber-600 text-xs'>
          {refusedCount === 1 ? 'One entry was' : `${refusedCount} entries were`} not released. Each
          one says why on its own row.
        </p>
      )}

      {!isLoading && visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={emptyTitle(tab)}
          description={<span>{emptyDescription(tab, providerLabel)}</span>}
        />
      ) : (
        <div className='flex flex-col gap-px p-3 pb-16'>
          <TreeRowList
            items={visible}
            loading={isLoading}
            skeletonCount={5}
            className='gap-px'
            getKey={(row: SyncQueueRow) => row.glPostingId}
            renderRow={(row: SyncQueueRow) => {
              const state = syncQueueState(row)
              // One door, so one pending check - and it covers the row whether it
              // was synced alone or as one of forty.
              const busy =
                syncExports.isPending &&
                syncExports.variables?.glPostingIds.includes(row.glPostingId) === true
              return (
                <TreeRow
                  className={TREE_SECONDARY_NOTRUNCATE}
                  icon={<FileText className='size-4 text-muted-foreground' />}
                  selectable={canSync}
                  selecting={selecting}
                  selected={selectedIds.includes(row.glPostingId)}
                  onSelectChange={(_next, event) =>
                    toggle(row.glPostingId, { shiftKey: event.shiftKey })
                  }
                  selectLabel={`Select ${row.docNumber}`}
                  /* Period, then doc number, then type - three fixed columns, so
                     the eye reads straight down them the way the banking queue's
                     direction/date/description does. */
                  title={
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <span className='w-24 shrink-0 text-muted-foreground text-xs'>
                        {formatPeriodLabel(row.periodKey)}
                      </span>
                      <span className='shrink-0 font-mono text-sm'>
                        {row.docNumber || EMPTY_CELL}
                      </span>
                      <span className='truncate text-muted-foreground text-xs'>
                        {row.postingType.replace(/_/g, ' ')}
                      </span>
                    </span>
                  }
                  secondary={
                    <span className='flex flex-wrap items-center gap-1.5'>
                      {/* 🛑 The refusal is ON the row, as a warning ICON with
                          the words on hover. It is already in the database, and
                          sending somebody to the logs for it is the defect
                          `FailedExportsBanner` exists not to repeat - but a
                          provider refusal is a paragraph ("Product Revenue is
                          not mapped to a QuickBooks account. Sales Tax Payable
                          is not mapped…"), and printed inline on forty rows it
                          IS the list. An icon keeps the row one line and keeps
                          the reason one hover away. D18 lands here too: a month
                          the provider has closed arrives as a refused row
                          carrying the provider's own words.

                          ONE icon for both reasons, never two - see
                          `refusalTooltipLines`. */}
                      <RefusalWarning
                        lines={refusalTooltipLines(row, refusals[row.glPostingId], providerLabel)}
                      />
                      {row.attempts > 0 && (
                        <Badge variant='outline' size='xs'>
                          {row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}
                        </Badge>
                      )}
                      {row.deliveryState === 'blocked' && state !== 'failed' && (
                        <Badge variant='amber' size='xs'>
                          Delivery parked
                        </Badge>
                      )}
                    </span>
                  }
                  actions={
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-xs tabular-nums'>
                        {formatMinor(row.totalMinor, row.currency)}
                      </span>
                      <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                        <span
                          className={cn('size-1.5 rounded-full', SYNC_QUEUE_STATE_DOT[state])}
                          aria-hidden
                        />
                        {SYNC_QUEUE_TAB_LABELS[state]}
                      </span>
                      {canSync && (
                        <TreeRowButton
                          persistent
                          tooltipText={syncQueueStateSentence(state, providerLabel)}
                          disabled={busy}
                          onClick={() => syncOne(row.glPostingId)}>
                          <RefreshCw className={cn(busy && 'animate-spin')} />
                        </TreeRowButton>
                      )}
                      <TreeRowButton
                        persistent
                        tooltipText='Open the entry'
                        onClick={() => onSelectPosting(row.glPostingId)}>
                        <PanelRight />
                      </TreeRowButton>
                    </div>
                  }
                  /* Mid-selection a row click EXTENDS the selection rather than
                     opening the drawer, the same rule the banking queue keeps:
                     picking the next of forty rows is a click on the row, and a
                     drawer thrown open over the list is how a bulk pass gets
                     abandoned. */
                  onToggleOpen={() =>
                    selecting && canSync
                      ? toggle(row.glPostingId)
                      : onSelectPosting(row.glPostingId)
                  }
                  rowClassName={cn(
                    activePostingId === row.glPostingId && 'bg-primary-100 ring-1 ring-primary-200',
                    selectedIds.includes(row.glPostingId) &&
                      cn(
                        'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
                        activePostingId === row.glPostingId && 'ring-info/40'
                      )
                  )}
                />
              )
            }}
          />
        </div>
      )}

      <ActionBar
        open={selecting}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          {
            id: 'sync',
            label: `Sync to ${providerLabel}`,
            icon: RefreshCw,
            disabled: syncExports.isPending,
            onClick: () => syncExports.mutate({ glPostingIds: selectedIds }),
          },
        ]}
      />
    </div>
  )
}

/**
 * A row's refusals, as ONE amber warning icon with the words on hover.
 *
 * ⚠️ `SimpleTooltip` + an amber `CircleAlert`, NOT `TooltipError`. The existing
 * primitive renders a `CircleX` in `text-destructive` on a `destructive`
 * bubble, and a refused export is a WARNING here, not an error: the entry is in
 * the books and correct, and only the copy is outstanding
 * (`FailedExportsBanner` uses `variant='warning'` for the same condition, and
 * this row's own state dot is `bg-amber-500`). No `warning` variant was added to
 * `@auxx/ui` for this - the icon already carries the semantics, and widening
 * `tooltipContentVariants` is a shared-package change for one row.
 *
 * `CircleAlert` rather than `TriangleAlert`, matching `books-health.tsx`'s
 * `FailedExportsBanner`, which is the other place this same condition is shown.
 */
function RefusalWarning({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <SimpleTooltip
      contentComponent={
        <div className='flex max-w-xs flex-col gap-1'>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      }>
      {/* A `span`, because `SimpleTooltip` clones its child with pointer
          handlers and the trigger has to accept DOM props. `tabIndex` so the
          reason is reachable without a mouse - a tooltip that only opens on
          hover hides the only record some of these refusals have. */}
      <span
        tabIndex={0}
        role='img'
        aria-label={lines.join(' ')}
        className='inline-flex cursor-pointer items-center text-amber-600'>
        <CircleAlert className='size-3.5' />
      </span>
    </SimpleTooltip>
  )
}

/** ⚠️ An empty Ready-to-sync tab is the HEALTHY state and has to read like one. */
function emptyTitle(tab: SyncQueueTab): string {
  switch (tab) {
    case 'held':
      return 'Nothing is waiting to be synced'
    case 'sending':
      return 'Nothing is in flight'
    case 'failed':
      return 'Nothing has been refused'
    case 'all':
      return 'Everything has been synced'
  }
}

function emptyDescription(tab: SyncQueueTab, providerLabel: string): string {
  switch (tab) {
    case 'held':
      return `Every entry in your books has been handed to ${providerLabel}. New entries land here when exporting posted entries is switched off in the provider settings.`
    case 'sending':
      return `Nothing has been released to ${providerLabel} and left unacknowledged.`
    case 'failed':
      return `${providerLabel} has not refused anything. A refusal would show the reason it gave, on the row.`
    case 'all':
      return `Nothing is outstanding. Every posted entry is either in ${providerLabel} or is a kind that is never sent.`
  }
}
