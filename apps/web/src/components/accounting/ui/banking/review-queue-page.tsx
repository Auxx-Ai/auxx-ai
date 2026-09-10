// apps/web/src/components/accounting/ui/banking/review-queue-page.tsx

'use client'

// Accounting > Banking > Review queue (plans/accounting/ui-plan.md §2.8,
// plans/bank-connection/03-categorization-and-gl.md, HANDOFF slot 3B).
//
// ## What this screen is for
//
// Every bank line is exactly one of four things, and deciding which is the
// reviewer's real work: a document auxx already holds (MATCH, posts nothing), a
// direct expense or receipt (CODE, one entry), our own money moving between two
// of our accounts (TRANSFER, one cash-to-cash entry), or not ours at all
// (EXCLUDE). The real book this was designed against had 2,390 unreviewed items
// reaching back eighteen months, so the surface is built to clear a pile: state
// tabs, bulk selection, and a drawer that opens on the treatment rather than on
// an account picker.
//
// 🛑 **A matched line posts NOTHING** (decision B5). The document's own entry
// already credited cash; a second entry from the feed credits it twice, both
// balance, and nothing detects it until a cash account will not tie.
//
// ## ⚠️ Departure: a TreeRowList, not `RecordsView`
//
// `ui-plan.md` §2.8 calls for `RecordsView` in embedded mode with a
// `baselineFilter` on `reviewStatus` and a `primaryCellRender`. **`RecordsView`
// exposes none of those** - its props are `{ slug, basePath, pageActions }` and
// the baseline filter it does build is its own saved-view search group, private
// to the component. Adding three props to a component every records page in the
// app renders is not this slot's to do, and the queue needs filters
// (`RecordsView` has no date or amount range) that would need three more.
//
// So the list is a `TreeRowList` over `bankingReview.list`, which is the shape
// `entries-list.tsx` already uses on the ledger page. What is lost is saved
// views, column configuration and CSV export; what is gained is the amount
// range, the signed in/out colouring and the suggestion badge, none of which the
// registry can express. Reported in HANDOFF §5 for the coordinator.

import { type BankTransactionRow, REVIEW_QUEUE_STATES } from '@auxx/lib/banking/review/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Inbox, Landmark, ListChecks, PanelRight } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useViewportFill } from '~/hooks/use-viewport-fill'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { AccountLabel } from '../account-label'
import { BankAccountBadge } from '../bank-account-badge'
import { EMPTY_CELL, formatMinor } from '../ledger/format'
import { ReviewBulkBar } from './review/review-bulk-bar'
import { ReviewDrawer } from './review/review-drawer'
import { ReviewStats } from './review/review-stats'
import { EMPTY_REVIEW_FILTERS, type ReviewFilters, ReviewToolbar } from './review/review-toolbar'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Review queue' },
]

const PAGE_DESCRIPTION =
  'Bank lines waiting for a decision. Match one to something you already recorded, code it to an account, mark it a transfer between your own accounts, or exclude it.'

/**
 * The ledger is pinned to USD for the cutover (`LEDGER_CURRENCY`), so the
 * display currency is that constant rather than a read.
 */
const DISPLAY_CURRENCY = 'USD'

/** The queue never collapses below this, however short the window is. */
const MIN_FRAME_HEIGHT = 260

/**
 * Consecutive pages the sentinel may pull without the reviewer scrolling again.
 *
 * The sentinel sits at the end of the list, so a page that does not fill the
 * viewport leaves it still on screen and it fires straight away. That is
 * correct once or twice - it is how a short first page catches up to a tall
 * window - but unbounded it walks the whole queue on mount. Reset on scroll,
 * the same guard `mail-thread-list.tsx` uses.
 */
const MAX_AUTO_FETCHES = 5

/** What one "apply rules" run reports back, as `applySuggestions` returns it. */
interface RunCounts {
  suggested: number
  ruleMatched: number
  autoApplied: number
  skipped: number
}

/** The status dot vocabulary, matching `ledger-toolbar.tsx`'s `STATE_DOT`. */
const STATUS_DOT: Record<string, string> = {
  for_review: 'bg-amber-500',
  suggested: 'bg-blue-500',
  matched: 'bg-green-500',
  coded: 'bg-teal-500',
  excluded: 'bg-muted-foreground',
}

/**
 * Dollars as typed to integer minor units, or `undefined` for a blank box.
 *
 * 🛑 `Math.round` at the LAST step, not `Math.trunc` and not a `toFixed` round
 * trip - both have shipped in this repo's history and both are wrong on the
 * doubles a currency input actually produces. Same rule as `toMinorUnits`.
 */
function toMinor(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return Math.round(parsed * 100)
}

export function BankingReviewQueuePage() {
  useRequireCapability(PermissionKey.ledgerView)
  const utils = api.useUtils()
  const { can } = useAccess()
  const [confirm, ConfirmDialog] = useConfirm()

  /**
   * The tab and the account are the VIEW; the rest of the toolbar narrows it.
   *
   * Only the view goes in the URL (`plans/bank-connection/10-review-queue-url-state.md`
   * §2). `?txn=` was already linkable, and a link that reopens a drawer inside a
   * queue that has silently reset to For review / All accounts is the worst of
   * the two halves. Search and the ranges stay local: a text box in the URL is
   * either a history entry per keystroke or a throttle to tune, and nobody
   * shares "amount between 12 and 40".
   */
  const [queueState, setQueueState] = useQueryState(
    's',
    parseAsStringLiteral(REVIEW_QUEUE_STATES).withDefault('for_review')
  )
  const [account, setAccount] = useQueryState('account')
  const [localFilters, setLocalFilters] = useState<ReviewFilters>(EMPTY_REVIEW_FILTERS)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [txn, setTxn] = useQueryState('txn')

  const filters = useMemo<ReviewFilters>(
    () => ({ ...localFilters, state: queueState, bankAccountId: account }),
    [localFilters, queueState, account]
  )

  const handleFiltersChange = useCallback(
    (next: ReviewFilters) => {
      if (next.state !== queueState) void setQueueState(next.state)
      if (next.bankAccountId !== account) void setAccount(next.bankAccountId)
      setLocalFilters(next)
    },
    [queueState, account, setQueueState, setAccount]
  )

  /**
   * ⚠️ Keyed on the URL, not folded into `handleFiltersChange`. Back and forward
   * change the tab or the account without going through the toolbar at all, and
   * a bulk bar still holding rows that are no longer listed would act on them.
   * The last run's counts go with it - they describe a view you have left.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the URL is the trigger
  useEffect(() => {
    setSelectedIds([])
    setLastRun(null)
  }, [queueState, account])

  /**
   * ⚠️ `1280px`, not the `1024px` `ledger-page.tsx` docks at. This page sits
   * behind the Banking layout's `SidebarSecondary`, so the shell eats ~255px
   * more than the ledger's does: at 1100 the app rail plus that sidebar plus a
   * 450px panel leave the queue about 100px, which is not a list any more.
   * 1280 is the first width where the queue keeps a readable column.
   */
  const isDesktop = useMedia('(min-width: 1280px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // The same input `useBankAccounts` sends, so this and the toolbar's picker
  // share one React Query key rather than issuing two reads of the same list.
  // Archived rows are filtered out below - this list drives the empty state and
  // the "which account" copy, and an archived account is not one to work in.
  const accountsQuery = api.banking.bankAccount.list.useQuery({ includeArchived: true })
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => !account.archivedAt),
    [accountsQuery.data]
  )

  // `glAccountId`/`suggestedGlAccountId` on a row are `gl_account` ids (task 15
  // §4), never codes - rendered through `AccountLabel`, which resolves each one
  // against the one chart fetch every picker on this page shares.

  /**
   * A bookmarked `?account=` for an account that has since been archived or
   * deleted is an ordinary state, not an error - `getBankAccount` takes the same
   * posture on the read side. Clear it rather than render an empty list under a
   * filter the picker cannot show.
   */
  useEffect(() => {
    if (!account || accountsQuery.isPending) return
    if (!accounts.some((row) => row.id === account)) void setAccount(null)
  }, [account, accounts, accountsQuery.isPending, setAccount])

  const listInput = useMemo(
    () => ({
      bankAccountId: filters.bankAccountId ?? undefined,
      state: filters.state,
      search: filters.search.trim() || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      amountMin: toMinor(filters.amountMin),
      amountMax: toMinor(filters.amountMax),
    }),
    [filters]
  )

  const list = api.bankingReview.list.useInfiniteQuery(listInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  const stats = api.bankingReview.stats.useQuery({
    bankAccountId: filters.bankAccountId ?? undefined,
  })

  const rows = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data?.pages]
  )

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    )
  }, [])

  /**
   * Anything selected → the list is in SELECTING mode: the checkboxes are
   * pinned and a row click picks that row rather than opening it. Clearing the
   * selection hands the row click back to the drawer.
   */
  const selecting = selectedIds.length > 0

  const hasAccounts = accounts.length > 0

  // ── Applying rules ──────────────────────────────────────────────────────
  //
  // 🛑 This button used to live on the Rules page under the name "Run
  // suggestions now", where every neighbouring control acts on a rule - so it
  // read as "propose some rules to me". It does the opposite: it writes
  // suggestions onto TRANSACTIONS, and an `autoApply` rule posts to the ledger.
  // It belongs here, where the lines it touches are on screen, and it says so.

  /** Only `for_review` lines can be touched, so only those two tabs offer it. */
  const canApplyRules =
    can(PermissionKey.ledgerPost) && (queueState === 'for_review' || queueState === 'suggested')

  // Fetched only when the button is on screen. Its one job is the confirm
  // below: an auto-apply rule is the difference between suggesting and posting.
  const rulesQuery = api.bankingRules.list.useQuery(undefined, { enabled: canApplyRules })
  const autoApplyRules = useMemo(
    () => (rulesQuery.data ?? []).filter((rule) => rule.enabled && rule.autoApply),
    [rulesQuery.data]
  )

  const [lastRun, setLastRun] = useState<RunCounts | null>(null)

  const applyRules = api.bankingRules.runSuggestions.useMutation({
    onSuccess: async (result) => {
      setLastRun(result)
      await Promise.all([
        utils.bankingReview.list.invalidate(),
        utils.bankingReview.stats.invalidate(),
      ])
    },
    onError: (error) => {
      toastError({ title: 'Error applying rules', description: error.message })
    },
  })

  const handleApplyRules = async () => {
    if (autoApplyRules.length > 0) {
      const names = autoApplyRules.map((rule) => rule.name).join(', ')
      const confirmed = await confirm({
        title: 'Apply rules now?',
        description:
          `${autoApplyRules.length === 1 ? 'One rule is' : `${autoApplyRules.length} rules are`} ` +
          `set to auto-apply (${names}). Lines they match are coded and POSTED, not suggested. ` +
          'Every other line only gets a suggestion for you to accept.',
        confirmText: 'Apply rules',
        cancelText: 'Cancel',
      })
      if (!confirmed) return
    }
    setLastRun(null)
    // The account the person is looking at, not the whole org.
    applyRules.mutate({ bankAccountId: filters.bankAccountId ?? undefined })
  }

  const applyRulesAction = canApplyRules ? (
    <div className='flex items-center gap-2'>
      <Button
        variant='ghost'
        size='sm'
        className='h-7'
        loading={applyRules.isPending}
        loadingText='Applying...'
        onClick={() => void handleApplyRules()}>
        <ListChecks />
        Apply rules to unreviewed lines
      </Button>
      {/* No success toasts by policy, so the counts have nowhere else to go. */}
      {lastRun && !applyRules.isPending && (
        <span className='whitespace-nowrap text-muted-foreground text-xs'>
          {lastRun.suggested} suggested, {lastRun.autoApplied} applied, {lastRun.skipped} skipped
        </span>
      )}
    </div>
  ) : undefined

  /**
   * ⚠️ Built ONCE and memoised. The panel array below is published to the
   * Banking layout's docked slot through an effect, so a drawer element with a
   * fresh identity every render would re-publish on every render.
   */
  const drawer = useMemo(
    () => (
      <ReviewDrawer
        transactionId={txn}
        onOpenChange={(open) => {
          if (!open) void setTxn(null)
        }}
        isDocked={isDesktop}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode={DISPLAY_CURRENCY}
      />
    ),
    [txn, setTxn, isDesktop, dockedWidth, setDockedWidth]
  )

  // The Banking LAYOUT owns the `MainPageContent`, so the docked panel is
  // published to it rather than passed as a prop (`docked-panels-outlet.tsx`).
  const dockedPanels = useMemo(
    () =>
      isDesktop && txn
        ? [
            {
              key: 'txn',
              content: drawer,
              width: dockedWidth,
              onWidthChange: setDockedWidth,
              minWidth: 380,
              maxWidth: 800,
            },
          ]
        : [],
    [isDesktop, txn, drawer, dockedWidth, setDockedWidth]
  )
  useRegisterDockedPanels(dockedPanels)

  /**
   * 🛑 The frame needs a DEFINITE height, and `flex-1` is not one here.
   *
   * `SettingsPage` is itself a `ScrollArea` whose content wrapper is
   * `min-h-full` with an auto height, and a grow item of an auto-height flex
   * column is sized by its own content, not by the container. Left on `flex-1`
   * this frame grew to the full list, the `ScrollArea` below it became as tall
   * as its contents and never scrolled, and the settings viewport scrolled the
   * whole page instead - the stat strip and the toolbar scrolled away with it.
   * `rules-page.tsx` and `deposits-page.tsx` measure the same way.
   */
  const frameRef = useRef<HTMLDivElement>(null)
  const frameHeight = useViewportFill(frameRef, MIN_FRAME_HEIGHT)

  // ── Infinite scroll ─────────────────────────────────────────────────────
  //
  // The queue pages 50 at a time. Refs rather than deps so the observer is
  // built once per viewport instead of being torn down on every fetch.
  const [listViewport, setListViewport] = useState<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const nextPage = useRef({ fetch: list.fetchNextPage, has: false, fetching: false })
  nextPage.current = {
    fetch: list.fetchNextPage,
    has: list.hasNextPage,
    fetching: list.isFetchingNextPage,
  }
  const autoFetches = useRef(0)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!listViewport || !sentinel) return

    const reset = () => {
      autoFetches.current = 0
    }
    listViewport.addEventListener('scroll', reset, { passive: true })

    const observer = new IntersectionObserver(
      ([entry]) => {
        const { has, fetching, fetch } = nextPage.current
        if (!entry?.isIntersecting || !has || fetching) return
        if (autoFetches.current >= MAX_AUTO_FETCHES) return
        autoFetches.current++
        void fetch()
      },
      { root: listViewport, threshold: 0 }
    )
    observer.observe(sentinel)

    return () => {
      listViewport.removeEventListener('scroll', reset)
      observer.disconnect()
    }
  }, [listViewport])

  /** A new view is a new pile - the auto-fetch budget starts over with it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filters are the trigger
  useEffect(() => {
    autoFetches.current = 0
    listViewport?.scrollTo({ top: 0 })
  }, [listInput])

  return (
    <SettingsPage title='Review queue' description={PAGE_DESCRIPTION} breadcrumbs={BREADCRUMBS}>
      <div ref={frameRef} className='flex min-h-0 flex-col' style={{ height: frameHeight }}>
        <ReviewStats
          stats={stats.data}
          loading={stats.isPending}
          currencyCode={DISPLAY_CURRENCY}
          accountSelected={!!filters.bankAccountId}
        />

        <ReviewToolbar
          filters={filters}
          onChange={handleFiltersChange}
          actions={applyRulesAction}
        />

        {!list.isPending && rows.length === 0 ? (
          <EmptyState
            icon={hasAccounts ? Inbox : Landmark}
            title={hasAccounts ? 'Nothing in this view' : 'No bank account yet'}
            description={
              hasAccounts ? (
                <span>
                  No bank lines match these filters. An empty For review tab is the healthy state -
                  it means every line the bank showed has been decided on.
                </span>
              ) : (
                <span>
                  Add a bank account and map it to a GL account, then import a statement or connect
                  a feed. Until an account is mapped there is nothing to credit, so nothing can be
                  coded.
                </span>
              )
            }
            button={
              hasAccounts ? undefined : (
                <Button asChild variant='outline'>
                  <a href='/app/accounting/settings/bank-accounts'>Add a bank account</a>
                </Button>
              )
            }
          />
        ) : (
          <ScrollArea className='min-h-0 flex-1' viewportRef={setListViewport}>
            <div className='flex flex-col gap-1 p-4 pb-24'>
              <TreeRowList
                items={rows}
                loading={list.isPending}
                skeletonCount={6}
                /* A hairline between rows. The selected row draws a `ring-1`,
                   which paints OUTSIDE its border box - flush against the next
                   row, whose background paints later and clips the ring's
                   bottom edge. One pixel of gap is enough to keep it whole. */
                className='gap-px'
                getKey={(row: BankTransactionRow) => row.id}
                renderRow={(row: BankTransactionRow) => (
                  <TreeRow
                    className={TREE_SECONDARY_NOTRUNCATE}
                    icon={<Landmark className='size-4 text-muted-foreground' />}
                    /* 🛑 Selection is always AVAILABLE and only PINNED once
                       something is selected - the same idiom the chart list
                       uses. A pinned column of empty boxes is what a list of
                       270 lines looks like before anyone has decided anything;
                       the box belongs on the row you are pointing at, and on
                       every row only once you are actually picking. */
                    selectable
                    selecting={selecting}
                    selected={selectedIds.includes(row.id)}
                    onSelectChange={() => toggle(row.id)}
                    selectLabel={`Select ${row.description ?? row.id}`}
                    /* Direction, then date, then the description - all three
                       inside `title`, so every row starts on the same two
                       fixed-width columns and the eye reads straight down them.
                       The In/Out badge is width-pinned for exactly that reason:
                       left to its content, "Out" and "In" differ by ~8px and
                       every date after them sits at a different x. */
                    title={
                      <span className='flex min-w-0 items-center gap-1.5'>
                        <Badge
                          variant={row.amountMinor < 0 ? 'outline' : 'green'}
                          size='xs'
                          className='w-9 shrink-0 justify-center'>
                          {row.amountMinor < 0 ? 'Out' : 'In'}
                        </Badge>
                        <span className='shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
                          {row.postedAt ?? EMPTY_CELL}
                        </span>
                        <span className='truncate text-sm' title={row.matchKey ?? undefined}>
                          {row.description || EMPTY_CELL}
                        </span>
                      </span>
                    }
                    secondary={
                      <span className='flex flex-wrap items-center gap-1.5'>
                        <BankAccountBadge bankAccountId={row.bankAccountId} size='sm' />
                        {row.bankStatus === 'void' && (
                          <Badge variant='outline' size='xs'>
                            Void
                          </Badge>
                        )}
                        {row.suggestedGlAccountId && row.reviewStatus !== 'coded' && (
                          <Badge variant='blue' size='xs'>
                            Suggested{' '}
                            <AccountLabel glAccountId={row.suggestedGlAccountId} density='chip' />
                          </Badge>
                        )}
                        {row.glAccountId && (
                          <Badge variant='outline' size='xs' className='font-mono'>
                            <AccountLabel glAccountId={row.glAccountId} density='chip' />
                          </Badge>
                        )}
                      </span>
                    }
                    /* The status is where a row ENDS, not another chip in the
                       middle of it: right-aligned it lands at the same x on
                       every row, so a column of "for review" reads as one thing
                       to clear rather than six labels at six positions. */
                    actions={
                      <div className='flex items-center gap-2'>
                        {/* Amounts are unsigned with the direction in its own
                            badge, the same rule the ledger's own tables keep.
                            It leads the trailing cluster because the money is
                            what a reviewer scans a queue for. */}
                        <span
                          className={cn(
                            'font-mono text-xs tabular-nums',
                            row.amountMinor < 0
                              ? 'text-foreground'
                              : 'text-green-700 dark:text-green-400'
                          )}>
                          {formatMinor(Math.abs(row.amountMinor), DISPLAY_CURRENCY)}
                        </span>
                        <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              STATUS_DOT[row.reviewStatus] ?? 'bg-muted-foreground'
                            )}
                            aria-hidden
                          />
                          {row.reviewStatus.replace('_', ' ')}
                        </span>
                        {/* 🛑 `persistent`, not the hover-revealed default. Once
                            anything is selected a row click extends the
                            selection, so this button is the ONLY way into a
                            line's detail - an affordance you have to discover by
                            hovering is not one at that point. */}
                        <TreeRowButton
                          persistent
                          tooltipText='Open details'
                          onClick={() => void setTxn(row.id)}>
                          <PanelRight />
                        </TreeRowButton>
                      </div>
                    }
                    /* 🛑 Mid-selection, a row click EXTENDS the selection - it
                       does not open the drawer. Picking the next of forty lines
                       is a click on the row, not a click on a 16px box, and a
                       drawer thrown open over the list every time somebody
                       missed the box is how a bulk pass gets abandoned. The
                       drawer comes back the moment the selection clears. */
                    onToggleOpen={() => (selecting ? toggle(row.id) : void setTxn(row.id))}
                    rowClassName={cn(
                      'bg-primary-100/50 hover:bg-primary-100',
                      txn === row.id && 'bg-primary-100 ring-1 ring-primary-200',
                      // Picked for a bulk action - a DIFFERENT state from "open
                      // in the drawer", and the app already separates the two by
                      // hue: `info` is what a multi-selection wears on
                      // `ListCard` and in the mail list, while `primary-*` stays
                      // the row you are looking AT. Last in the merge, so a row
                      // that is both keeps the drawer's ring and takes the
                      // selection's tint.
                      selectedIds.includes(row.id) &&
                        cn(
                          'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
                          // Open AND picked: the ring turns info too, so the two
                          // states read as one row rather than a blue fill
                          // wearing a grey outline from the other palette.
                          txn === row.id && 'ring-info/40'
                        )
                    )}
                  />
                )}
              />

              {/* The trigger for the next page. It sits INSIDE the padded
                  wrapper so `pb-24` keeps it clear of the bulk bar; the
                  observer's root is the viewport above, not the window. */}
              <div ref={sentinelRef} className='h-px shrink-0' aria-hidden />
              {list.isFetchingNextPage && (
                <div className='py-3 text-center text-muted-foreground text-xs'>
                  Loading more lines...
                </div>
              )}
              {/* The budget only runs out on a viewport the pages do not fill,
                  which is exactly when there is nothing to scroll to reset it. */}
              {list.hasNextPage && !list.isFetchingNextPage && (
                <div className='flex justify-center py-3'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      autoFetches.current = 0
                      void list.fetchNextPage()
                    }}>
                    Load more
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      <ReviewBulkBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds([])}
        onDone={() => setSelectedIds([])}
      />

      {/* Below the dock breakpoint the same drawer renders as a floating
          overlay, the way every other docked panel's fallback does. */}
      {!isDesktop && drawer}

      <ConfirmDialog />
    </SettingsPage>
  )
}
