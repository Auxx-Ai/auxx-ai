// apps/web/src/components/accounting/ui/banking/payouts/payouts-page.tsx

'use client'

// Accounting > Banking > Payouts (task 49 §3-§5; ui-plan.md §2.6).
//
// What the PROVIDER reported: `payoutEvidence.*`, exact `string` minor units,
// per-row source currency, membership and reconciliation state. The sibling page, Settlements
// (`banking/settlements/settlements-page.tsx`), is what auxx POSTED from it -
// a different question, answered from a different query, on a route of its
// own.

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ResponsiveTabs } from '@auxx/ui/components/responsive-tabs'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Inbox, Landmark, Link2Off, PanelRight, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SourceAccountBadge } from '~/components/accounting/ui/source-account-badge'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import SettingsPage from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { useMedia } from '~/hooks/use-media'
import { useViewportFill } from '~/hooks/use-viewport-fill'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { EMPTY_CELL } from '../../ledger/format'
import { formatEvidenceAmount } from './evidence-format'
import { MATCH_REASON_LABEL } from './match-reason-copy'
import { PayoutEvidenceDrawer } from './payout-evidence-drawer'
import {
  EMPTY_PAYOUT_FILTERS,
  PAYOUT_FILTER_STATUSES,
  type PayoutFilterStatus,
  type PayoutFilters,
  PayoutsToolbar,
} from './payouts-toolbar'
import { ProcessorActivity } from './processor-activity'
import { RejectedProcessorEvidence } from './rejected-processor-evidence'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Payouts' },
]

const PAGE_DESCRIPTION =
  'Inspect imported payouts and processor activity, exactly as the provider reported them. What auxx posted from them is on Settlements.'

type PayoutsTab = 'payouts' | 'unassigned' | 'issues'

const TABS = [
  { value: 'payouts', label: 'Payouts', icon: Landmark },
  { value: 'unassigned', label: 'Unassigned', icon: Inbox },
  { value: 'issues', label: 'Import issues', icon: AlertTriangle },
]

/** The frame never collapses below this, matching the review queue's own. */
const MIN_FRAME_HEIGHT = 260

/** Inspect imported payouts and processor activity as the provider reported them. */
export function PayoutsPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const utils = api.useUtils()

  const [tab, setTab] = useQueryState('s', { defaultValue: 'payouts' as string })
  const activeTab: PayoutsTab = tab === 'unassigned' || tab === 'issues' ? tab : 'payouts'

  const [payoutId, setPayoutId] = useQueryState('payout')

  /**
   * The source account and the status are the VIEW; the rest of the toolbar
   * narrows it. Only the view goes in the URL, the split
   * `review-queue-page.tsx` settled on.
   *
   * `?payout=` was already linkable, and a link that reopens the drawer inside
   * a list that has silently reset to All accounts / All statuses is the worst
   * of the two halves. Search and the date range stay LOCAL: a text box in the
   * URL is either a history entry per keystroke or a throttle to tune, and
   * nobody shares "payouts between two dates".
   *
   * ⚠️ `?s=` (the tab) and `?payout=` (the drawer) are untouched by any of this.
   */
  const [sourceAccount, setSourceAccount] = useQueryState('account')
  const [status, setStatus] = useQueryState(
    'status',
    // A hand-edited `?status=` reaching the query would be a 400 rather than an
    // empty list, so the literal parser folds anything unknown back to `all`.
    parseAsStringLiteral(PAYOUT_FILTER_STATUSES).withDefault('all')
  )
  const [localFilters, setLocalFilters] = useState<PayoutFilters>(EMPTY_PAYOUT_FILTERS)

  const filters = useMemo<PayoutFilters>(
    () => ({ ...localFilters, sourceAccountId: sourceAccount, status }),
    [localFilters, sourceAccount, status]
  )

  const handleFiltersChange = useCallback(
    (next: PayoutFilters) => {
      if (next.sourceAccountId !== sourceAccount) void setSourceAccount(next.sourceAccountId)
      // The `RadioTab` can only emit a `PAYOUT_FILTER_STATUSES` member, which is
      // what makes this cast total.
      if (next.status !== status) void setStatus(next.status as PayoutFilterStatus)
      setLocalFilters(next)
    },
    [sourceAccount, status, setSourceAccount, setStatus]
  )

  /**
   * ⚠️ `1280px`, matching `review-queue-page.tsx`: this page sits behind the
   * Banking layout's `SidebarSecondary`, so the shell eats more room than a
   * bare `MainPageContent` page does, and 1280 is the first width where the
   * list keeps a readable column next to a docked panel.
   */
  const isDesktop = useMedia('(min-width: 1280px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  /**
   * ⚠️ Built ONCE and memoised. The panel array below is published to the
   * Banking layout's docked slot through an effect, so a drawer element with a
   * fresh identity every render would re-publish on every render.
   */
  const drawer = useMemo(
    () => (
      <PayoutEvidenceDrawer
        payoutId={payoutId}
        onOpenChange={(open) => {
          if (!open) void setPayoutId(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
      />
    ),
    [payoutId, setPayoutId, isDesktop, dockedWidth, setDockedWidth]
  )

  // The Banking LAYOUT owns the `MainPageContent`, so the docked panel is
  // published to it rather than passed as a prop (`docked-panels-outlet.tsx`).
  const dockedPanels = useMemo(
    () =>
      isDesktop && payoutId
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
    [isDesktop, payoutId, drawer, dockedWidth, setDockedWidth]
  )
  useRegisterDockedPanels(dockedPanels)

  /**
   * 🛑 The frame needs a DEFINITE height, and `flex-1` is not one here.
   * `SettingsPage` is itself a `ScrollArea` whose content wrapper is
   * `min-h-full` with an auto height, so a grow item of it is sized by its own
   * content, not by the container - `review-queue-page.tsx` documents this at
   * length. `useViewportFill` measures the room actually left under the
   * header instead.
   */
  const frameRef = useRef<HTMLDivElement>(null)
  const frameHeight = useViewportFill(frameRef, MIN_FRAME_HEIGHT)

  return (
    <SettingsPage
      title='Payouts'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      subHeader={
        <ResponsiveTabs
          value={activeTab}
          onValueChange={(next) => void setTab(next)}
          items={TABS}
          size='sm'
        />
      }
      button={
        <Button variant='outline' size='sm' onClick={() => void utils.payoutEvidence.invalidate()}>
          <RefreshCw />
          Refresh evidence
        </Button>
      }>
      {/* 🛑 BLED to the page edges, not a bordered card - `review-queue-page.tsx`,
          which is the screen this one is a sibling of. This used to be a `p-4`
          wrapper around a `rounded-xl border bg-background` frame (the shape
          `rules-page.tsx` uses for a SETTINGS list), which put a second border
          inside the panel's own and inset the rows from the docked drawer by
          16px the queue does not spend. The padding lives inside each tab's
          `ScrollArea` instead, so a row's hover and its selected ring reach the
          full width the way the queue's do. */}
      <div
        ref={frameRef}
        className='flex min-h-0 flex-col'
        style={frameHeight ? { height: `${frameHeight}px` } : undefined}>
        {activeTab === 'payouts' ? (
          <>
            {/* 🛑 The payouts tab ONLY. Unassigned reads
                `payoutEvidence.entries` and Import issues reads
                `payoutEvidence.rejected` - different rows, none of which carry
                a payout status or a source-account filter, so a toolbar above
                them would be four controls that do nothing. */}
            <PayoutsToolbar filters={filters} onChange={handleFiltersChange} />
            <PayoutList
              filters={filters}
              selectedId={payoutId}
              onSelect={(id) => void setPayoutId(id)}
            />
          </>
        ) : activeTab === 'unassigned' ? (
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col gap-4 p-4'>
              <ProcessorActivity unassignedOnly />
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className='min-h-0 flex-1'>
            <div className='flex flex-col p-4'>
              <RejectedProcessorEvidence />
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Below the dock breakpoint the same drawer renders as a floating
          overlay, the way every other docked panel's fallback does. */}
      {!isDesktop && drawer}
    </SettingsPage>
  )
}

/**
 * The status dot's hue, the shape `review-queue-page.tsx` uses.
 *
 * ⚠️ `MoneyTransfer.status` is free text carrying the PROVIDER's word, so the
 * keys here are the observed vocabulary (`source.ts` ships
 * `in_transit | paid | failed | canceled`, the record side adds `reversed`) and
 * the lookup falls back rather than asserting the set is closed.
 */
const STATUS_DOT: Record<string, string> = {
  paid: 'bg-green-500',
  in_transit: 'bg-blue-500',
  failed: 'bg-destructive',
  canceled: 'bg-muted-foreground',
  reversed: 'bg-amber-500',
}

/**
 * The provider's date, as a fixed-width column.
 *
 * 🛑 Date-only, unlike {@link formatEvidenceDate}, which deliberately renders
 * timestamp evidence as `YYYY-MM-DD HH:MM:SS UTC`. That is right in the drawer,
 * where precision is the point, and wrong here: a column that is 10 characters
 * on one row and 23 on the next stops being a column, and the leading date is
 * what makes this list scannable. The exact stored value stays one click away.
 */
function listDate(payout: { occurredOn: string | null; occurredAt: string | null }): string {
  const value = payout.occurredOn ?? payout.occurredAt
  return value ? value.slice(0, 10) : EMPTY_CELL
}

/**
 * The payout list: what the provider reported, one row per payout.
 *
 * Rendered as `review-queue-page.tsx` renders bank lines, because it is the same
 * kind of screen - a queue of provider-reported rows you work down, each opening
 * a docked drawer. Concretely: the date leads `title` as a fixed-width mono
 * column so the eye reads straight down it, the identity badges sit in
 * `secondary`, and the money, the status dot and the open-details button end the
 * row at the same x on every line. `gap-px` between rows, not `gap-2`, so the
 * open row's ring has one pixel to paint into.
 *
 * ⚠️ NOT selectable. The review queue's checkbox column exists for its bulk bar;
 * payout evidence has no bulk action, so a row click opens the drawer with no
 * mid-selection branch to guard.
 */
function PayoutList({
  filters,
  selectedId,
  onSelect,
}: {
  /** The toolbar's state, already merged with the URL half by the page. */
  filters: PayoutFilters
  /** The payout the drawer is showing, from `?payout=`. Draws the ring. */
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  /**
   * ⚠️ Memoised, and the reset effect below is keyed on it. `useInfiniteQuery`
   * takes this as its query key, so a fresh object every render would be a new
   * key every render.
   *
   * `undefined` for anything unset, never `''`: a blank string is a filter the
   * server would honour by matching nothing. `all` is the absence of a status
   * filter rather than a status, so it maps to `undefined` too.
   */
  const listInput = useMemo(
    () => ({
      limit: 50,
      sourceAccountId: filters.sourceAccountId ?? undefined,
      status: filters.status === 'all' ? undefined : filters.status,
      search: filters.search.trim() || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      needsMatching: filters.needsMatching || undefined,
    }),
    [filters]
  )

  const query = api.payoutEvidence.list.useInfiniteQuery(listInput, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const payouts = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages]
  )

  /**
   * The accounts that appear on a payout - the same query the toolbar's picker
   * issues, deduped by React Query rather than fetched twice.
   *
   * It is here to tell the two empty states apart: a non-empty list means
   * payouts exist and these filters simply exclude all of them, which is a very
   * different message from "nothing has ever been imported".
   */
  const accounts = api.payoutEvidence.sourceAccounts.useQuery()
  const hasPayouts = (accounts.data ?? []).length > 0

  /** A new view is a new pile: back to the top, and the tail below is keyed on the filters so its auto-fetch budget starts over. */
  const [listViewport, setListViewport] = useState<HTMLDivElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filters are the trigger
  useEffect(() => {
    listViewport?.scrollTo({ top: 0 })
  }, [listInput])

  if (!query.isPending && !query.error && payouts.length === 0) {
    // 🛑 Two different answers, the split `review-queue-page.tsx` makes. Telling
    // somebody whose filters excluded everything to go connect a connector is
    // wrong, and it hides the one thing that would fix their screen.
    return (
      <EmptyState
        icon={hasPayouts ? Inbox : Landmark}
        title={hasPayouts ? 'Nothing in this view' : 'No payout evidence yet'}
        description={
          hasPayouts
            ? 'No payouts match these filters. Widen the date range, or clear them, to see everything the provider reported.'
            : 'Import payout and processor activity evidence to inspect it here.'
        }
        button={
          hasPayouts ? undefined : (
            <Button variant='outline' asChild>
              <Link href='/app/connectors'>Open connectors</Link>
            </Button>
          )
        }
      />
    )
  }

  return (
    <ScrollArea className='min-h-0 flex-1' viewportRef={setListViewport}>
      <div className='flex flex-col gap-1 p-4'>
        {query.error && (
          <Alert variant='destructive'>
            <AlertTitle>Could not load payouts</AlertTitle>
            <AlertDescription>
              {query.error.message} Use Refresh evidence to try again.
            </AlertDescription>
          </Alert>
        )}
        <TreeRowList
          items={payouts}
          loading={query.isPending}
          skeletonCount={6}
          /* A hairline between rows, not a gap. The open row draws a `ring-1`
             that paints OUTSIDE its border box, so flush rows clip its bottom
             edge under the next row's background - verbatim the reason
             `review-queue-page.tsx` sets this. */
          className='gap-px'
          getKey={(payout) => payout.id}
          renderRow={(payout) => (
            <TreeRow
              /* The `secondary` slot carries badges and the slot clips pill
                 shapes by default. On the ROW rather than the container, the way
                 the review queue does it. */
              className={TREE_SECONDARY_NOTRUNCATE}
              icon={<Landmark className='size-4 text-muted-foreground' />}
              /* Date then id, both inside `title`, so every row starts on the
                 same fixed-width mono column and the eye reads straight down it
                 - the review queue's argument for leading with `postedAt`. The
                 id truncates; the date never does. */
              title={
                <span className='flex min-w-0 items-center gap-1.5'>
                  <span className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                    {listDate(payout)}
                  </span>
                  <span className='truncate text-sm'>{payout.externalId}</span>
                </span>
              }
              secondary={
                <span className='flex flex-wrap items-center gap-1.5'>
                  <SourceAccountBadge
                    providerKey={payout.providerKey}
                    externalAccountId={payout.externalAccountId}
                    environment={payout.environment}
                    size='sm'
                  />
                  {/* 🛑 No raw `membershipState` and no provider-readiness badge,
                      matching the drawer header. Both spoke an internal
                      vocabulary (`unsupported`, `Provider pending`) that a
                      reader cannot act on. */}
                  {payout.reconciliationState === 'pending' && (
                    <Badge variant='outline' size='xs'>
                      Reconciliation pending
                    </Badge>
                  )}
                  {/* The worklist's own count and the code that explains most of
                      it (§10.4) - the two facts that decide whether this payout
                      is worth opening. */}
                  {payout.needsMatchingCount > 0 && (
                    <>
                      <Badge variant='amber' size='xs'>
                        <Link2Off />
                        {payout.needsMatchingCount} need matching
                      </Badge>
                      {payout.dominantMatchReason && (
                        <Badge variant='outline' size='xs'>
                          {MATCH_REASON_LABEL[payout.dominantMatchReason]}
                        </Badge>
                      )}
                    </>
                  )}
                </span>
              }
              /* Where the row ENDS, at the same x on every line: the money the
                 list is scanned for, then the status as a dot plus its word,
                 then the way in. */
              actions={
                <div className='flex items-center gap-2'>
                  <span className='font-mono text-xs tabular-nums'>
                    {formatEvidenceAmount(
                      payout.sourceAmountMinor,
                      payout.sourceCurrency,
                      payout.sourceCurrencyExponent
                    )}
                  </span>
                  <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        STATUS_DOT[payout.status] ?? 'bg-muted-foreground'
                      )}
                      aria-hidden
                    />
                    {payout.status.replaceAll('_', ' ')}
                  </span>
                  {payout.blockers.length > 0 && (
                    // The app's warning mark: amber + a warning glyph, the shape
                    // `chart-list.tsx` and `setup-streams-overview.tsx` use. NOT
                    // `destructive` - nothing here is broken or lost, the
                    // evidence is just incomplete, and a red badge on a routine
                    // unreconciled payout spends alarm this row has not earned.
                    // The count replaces the words "Needs attention": it says
                    // the same thing and also says how much.
                    <Tooltip
                      content={`${payout.blockers.length} ${
                        payout.blockers.length === 1 ? 'issue' : 'issues'
                      } to review`}>
                      <Badge variant='amber' size='sm'>
                        <AlertTriangle />
                        {payout.blockers.length}
                      </Badge>
                    </Tooltip>
                  )}
                  <TreeRowButton
                    persistent
                    tooltipText='Open details'
                    onClick={() => onSelect(payout.id)}>
                    <PanelRight />
                  </TreeRowButton>
                </div>
              }
              onToggleOpen={() => onSelect(payout.id)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === payout.id && 'bg-primary-100 ring-1 ring-primary-200'
              )}
            />
          )}
        />
        <InfiniteListTail
          key={JSON.stringify(listInput)}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          loadingLabel='Loading more payouts...'
        />
      </div>
    </ScrollArea>
  )
}
