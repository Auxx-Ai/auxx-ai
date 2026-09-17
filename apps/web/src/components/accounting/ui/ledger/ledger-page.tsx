// apps/web/src/components/accounting/ui/ledger/ledger-page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import {
  ArrowLeftRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Layers,
  Lock,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useRef } from 'react'
import { useAccountingMonth } from '~/components/accounting/hooks/use-accounting-month'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useMonthEndEntry } from '~/components/accounting/hooks/use-month-end-entry'
import { useMonthEntries } from '~/components/accounting/hooks/use-month-entries'
import { AccountingChecklistPanel } from '~/components/accounting/ui/checklist/accounting-checklist-panel'
import { EntriesList } from '~/components/accounting/ui/journal/entries-list'
import { JournalEntryDrawer } from '~/components/accounting/ui/journal/journal-entry-drawer'
import { lastDayOfPeriod, today } from '~/components/accounting/ui/journal/period-helpers'
import {
  ProviderAgreementAction,
  ProviderAgreementPanel,
  useProviderAgreement,
} from '~/components/accounting/ui/provider-agreement/provider-agreement-panel'
import { KopilotContext } from '~/components/kopilot/context'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'

import { CloseMonthPanel } from './close-month-panel'
import { type CountAdjustmentRow, CountEvidenceSection } from './count-evidence-section'
import { EntryRollForward } from './entry-roll-forward'
import { formatPeriodLabel, lockRefusalReason } from './format'
import { type LateArrivalRow, LateArrivalsSection } from './late-arrivals-section'
import { LedgerBanners } from './ledger-banners'
import { LedgerSidebar, type LedgerView } from './ledger-sidebar'
import { LedgerStats } from './ledger-stats'
import { LedgerToolbar } from './ledger-toolbar'
import { MonthEndEntrySection } from './month-end-entry-section'
import { PostingDrawer } from './posting-drawer'
import { RevisionStrip } from './revision-strip'
import { SyncQueuePanel } from './sync-queue/sync-queue-panel'
import { SYNC_QUEUE_TABS } from './sync-queue/sync-queue-rows'

/** The setting that declares how far the books are closed. `DOCUMENTS` scope. */
const LOCKED_THROUGH_KEY = 'ledger.lockedThroughMonth'

/**
 * Page key Kopilot scopes its tools by (`ACCOUNTING_LEDGER_PAGE` in
 * `@auxx/lib/ai/kopilot`) - hardcoded here for the same reason
 * `dashboard-detail-view.tsx` hardcodes `dashboard.builder`: importing the
 * constant from that barrel drags the whole server-side capability graph into
 * this client bundle. The two must be changed together.
 *
 * What it buys: `get_ledger_status`, the read that answers where the books
 * stand - balance, duplicate bank movements, processor fee treatment per rail,
 * and what posted in a month. Those were four groups of standing figures in the
 * module rail until this pass; asking for them is better than staring past them.
 */
const LEDGER_KOPILOT_PAGE = 'accounting.ledger'

/**
 * Bleeds a `Section`'s content past its own `p-3` so a full-width child sits
 * flush with the section's edges - the same override `eval-run-detail.tsx`,
 * `streams-section.tsx` and `detail-view-sections.tsx` use.
 *
 * 🛑 The `ListToolbar` inside `EntriesList` is the reason. It is a bordered,
 * full-bleed bar by construction (`border-b` across its whole width), and inset
 * by 12px on each side it read as a floating card rather than the list's own
 * header - with the section's border-b running past it on both sides.
 */
const SECTION_BLEED = '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'

/**
 * The ledger, at `/app/accounting` (13-accounting-ui.md section 5.1).
 *
 * 🛑 `/app/accounting` RENDERS, it never redirects: a redirect would make the
 * module home URL unstable and break "Accounting" as a bookmark. The month is
 * `?month=YYYY-MM` on that one stable URL rather than a path segment - see
 * `useAccountingMonth` for why, and for how it survives a trip through Banking
 * or Settings, neither of which carries a month.
 *
 * Three states:
 *
 *   1. Setup not finalized  -> the getting-started checklist, period nav disabled
 *   2. A month is open      -> that month's entry, ready to preview and post
 *   3. Everything posted    -> the most recent posted month, plus "nothing to close"
 *
 * ## Two destinations, one route
 *
 * The rail (`ledger-sidebar.tsx`) picks what the content column shows:
 *
 *   - **Closeout** - the month. Its stats, its refusals, its month-end entry,
 *     the lock, its other entries. The absence of `?queue=`.
 *   - **Sync queue** - `?queue=<tab>`. Everything in the books and not in the
 *     provider's copy, EVERY period, which is why it does not share a screen
 *     with a month-scoped header.
 *
 * 🛑 Both are this URL. `?month=`, `?queue=` and `?posting=` are the whole of
 * the page's state, so every one of them survives a paste into Slack.
 *
 * 🛑 Under the L1 regime a month has exactly ONE entry (no receipt, build or
 * shipment posts individually), so the entry renders inline with no list. What a
 * month does have is a revision chain, which is why the revision strip appears
 * only above revision 0 and why `?posting=<id>` exists.
 *
 * 🛑 An OPEN month renders the projected entry from `ledger.previewMonthEnd`; a
 * POSTED month renders the STORED entry from `ledger.get`. They are never
 * crossed. Re-running the builder over a posted month gives a different answer
 * the moment the subledger moves, and the number that matters is the one that
 * was posted.
 */
export function LedgerPage() {
  const { requestedMonth, selectMonth, syncMonth } = useAccountingMonth()
  const period = useLedgerPeriod(requestedMonth)
  const provider = useAccountingProviderStatus()
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const { can } = useAccess()

  // 🛑 The deep link. A ledger entry is the thing somebody pastes into Slack.
  const [postingId, setPostingId] = useQueryState('posting')
  // `?je=new` or `?je=<journalEntryId>` - the JE drawer (HANDOFF slot 1B).
  const [journalEntryParam, setJournalEntryParam] = useQueryState('je')
  /**
   * 🛑 The sync queue is a VIEW of this page, not a second route (53 D17).
   * `GlPosting` is already the aggregate, so an exports page would list the same
   * rows with different columns. One param carries both halves - present means
   * the queue is what the column is showing, and its value is the tab - so a
   * pasted link reopens the pile somebody was actually looking at.
   */
  const [queueTab, setQueueTab] = useQueryState('queue', parseAsStringLiteral(SYNC_QUEUE_TABS))
  const isSyncQueueOpen = queueTab !== null

  /**
   * The queue opens on Ready to sync, which is the pile it exists to clear.
   *
   * ⚠️ `?posting=` is dropped on the way out, not on the way in: a row opened
   * from the queue can be from any month, and leaving its drawer over the
   * month view would show an entry the month below it does not list.
   */
  const openSyncQueue = useCallback(() => void setQueueTab('held'), [setQueueTab])
  const closeSyncQueue = useCallback(() => {
    void setPostingId(null)
    void setQueueTab(null)
  }, [setQueueTab, setPostingId])

  /**
   * The two rail items and the one param behind them. Closeout is the absence
   * of `?queue=`, so selecting it is the same act as leaving the queue - there
   * is no third state to keep in step.
   */
  const selectView = useCallback(
    (next: LedgerView) => {
      if (next === 'sync-queue') openSyncQueue()
      else closeSyncQueue()
    },
    [openSyncQueue, closeSyncQueue]
  )

  /**
   * "Review the lock" from a close refusal. The lock is a section in the
   * Closeout column now, so the remedy leaves the queue if that is what is on
   * screen and then scrolls to it.
   *
   * 🛑 Both halves are needed. Scrolling alone does nothing while the queue is
   * the column's content (the section is not mounted), and switching alone
   * lands the reader at the top of a long scroll with no idea what moved.
   */
  const closeSectionRef = useRef<HTMLDivElement>(null)
  const revealLock = useCallback(() => {
    closeSyncQueue()
    // After the switch has rendered, not before it.
    requestAnimationFrame(() =>
      closeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    )
  }, [closeSyncQueue])

  const { activePeriod, activePeriodKey, bookTimeZone, currencyCode } = period

  // What resolved is what the URL says. `activePeriodKey` is the month AFTER
  // `useLedgerPeriod` has had its say - it refuses a month the org does not have
  // and falls back to the resolved one - so syncing from here is what keeps a
  // stale or hand-typed `?month=` from outliving the screen it disagrees with.
  // `''` while `ledger.periods` is in flight, and permanently for an org with no
  // months at all; neither is a month to remember.
  useEffect(() => {
    if (!activePeriodKey) return
    syncMonth(activePeriodKey)
  }, [activePeriodKey, syncMonth])

  const periodLabel = activePeriodKey ? formatPeriodLabel(activePeriodKey) : ''
  const isPostedPeriod = !!activePeriod && activePeriod.state !== 'open'
  const isLocked = activePeriod?.state === 'locked'
  const isChecklistState = period.isSetupDraft
  const canControlLedger = can('ledger.control')
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL

  // The two drawers share ONE dock slot (ui-plan.md §2.1), so opening one
  // closes the other rather than letting both params coexist unrendered.
  function openPosting(id: string) {
    void setJournalEntryParam(null)
    void setPostingId(id)
  }
  function openJournalEntry(id: string) {
    void setPostingId(null)
    void setJournalEntryParam(id)
  }

  const actions = useLedgerEntryActions({
    periodKey: activePeriodKey,
    // Reverse acts on what is on screen: the posting open in the drawer if there
    // is one, otherwise the month's effective entry.
    glPostingId: postingId ?? activePeriod?.glPostingId ?? null,
    enabled: !isChecklistState && !!activePeriodKey && !isPostedPeriod,
  })

  // Everything about THE month-end entry - which one, what it says, and whether
  // it can be posted - forks on `isPostedPeriod` in every field, so it lives in
  // one hook rather than scattered down this body.
  const entry = useMonthEndEntry({
    activePeriod,
    activePeriodKey,
    isPostedPeriod,
    isLocked,
    actions,
  })

  const failedExportsQuery = api.ledger.failedExports.useQuery({})
  // The month on screen rides along so the sweep can answer the COMPLETENESS
  // question too - what this month still owes the ledger. Without it the counts
  // come back `null` and the Books section renders the balance half alone.
  // 🛑 `||`, not `??`. `activePeriodKey` is `''` - not undefined - while
  // `ledger.periods` is in flight, and PERMANENTLY for a finalized org whose
  // cutoff is still ahead of the wall clock (the case `optionalMonthKey` exists
  // for). `??` lets the empty string through and the month regex refuses it, so
  // the sweep 400s and the Books section skeletons forever.
  //
  // ⚠️ Deliberately NOT gated on a month. Balance is a WHOLE-LEDGER fact and the
  // month only adds the completeness half; `countIncompleteRevenue` answers with
  // `null`s when none was asked and `CompletenessLines` renders nothing for
  // them. An `enabled: !!activePeriodKey` here would withhold an answer that is
  // available, and leave the same permanent skeleton behind.
  const balanceQuery = api.ledger.verifyBalance.useQuery({
    periodKey: activePeriodKey || undefined,
  })
  // 🛑 The duplicate detector, the processor-fee status and the month-activity
  // reads used to be asked here, for three rail groups that rendered their
  // answers as standing figures. The groups are gone (`ledger-sidebar.tsx`) and
  // so are the reads: the same three questions are Kopilot's to answer on this
  // page now, through `get_ledger_status`, which calls the same `packages/lib`
  // functions server-side. The balance sweep above stays because the stats
  // strip renders it.
  //
  // The same rows `EntriesList` renders, counted for the stats strip. One hook,
  // so the header cannot disagree with the list beneath it.
  const monthEntries = useMonthEntries(activePeriodKey || undefined)

  // 🛑 Hoisted, because the button that asks lives in the section's header and
  // the answer lives in its body. One hook, so the two cannot disagree about
  // whether anything has been asked.
  const agreement = useProviderAgreement(
    activePeriodKey ? lastDayOfPeriod(activePeriodKey) : today(bookTimeZone)
  )

  // Why Lock is refused, or `null` when it is offered. The reasoning, and the
  // trap of giving a `nothing_to_close` month the postable month's remedy, are
  // in `lockRefusalReason`'s own header. It is rendered as VISIBLE copy and not
  // only in the button's tooltip: a refusal an operator has to hover to
  // discover is the puzzle 13-accounting-ui.md §5.2 is about.
  const lockBlockedReason = lockRefusalReason({
    periodLabel,
    isPostedPeriod,
    justPosted: actions.justPosted,
    isNothingToClose: entry.blockers.some((blocker) => blocker.status === 'nothing_to_close'),
  })

  // ── Sections with no read (14-drive-the-close.md section 7) ────────────────
  //
  // 🛑 Both stay `undefined` on purpose and both sections therefore render
  // NOTHING. Neither read exists in `packages/lib` and neither is specified
  // anywhere. An empty state would assert "no counts were recorded" and "nothing
  // arrived late", and those are claims about the subledger that nobody has
  // gone and checked - which is worse than silence next to real numbers.
  // Lighting either one up is one line once its read lands; see each
  // component's header for what it is waiting on.
  const countAdjustments: CountAdjustmentRow[] | undefined = undefined
  const lateArrivals: LateArrivalRow[] | undefined = undefined

  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()

  // `ledgerControl`-gated (plans/accounting/tasks/done/12-accountant-permissions.md
  // §4.4): the period lock used to write `ledger.lockedThroughMonth` through
  // the generic `setting.updateOrganizationSetting` door, which asserted
  // `settingsManage` - handing whoever closes the books every organization
  // setting in the product. `ledger.setLockedThrough` is now the only door.
  const setLockedThrough = api.ledger.setLockedThrough.useMutation()

  // The batch fulfillment/credit-memo posting dialogs that used to open from a
  // `revenue_incomplete` blocker's Fix button are gone (step 1b, part E): every
  // fulfillment and credit memo posts as it happens now, and the Drafts tab
  // (step 1c) is what a review-before-post queue becomes. `onFix` below is a
  // no-op until then - `LedgerBanners` still requires the prop.
  const onFix = useCallback(() => {}, [])

  function goToPeriod(next: string) {
    // `?posting=` deliberately does NOT survive: a posting id belongs to one
    // month, and carrying it across would open a drawer on somebody else's entry.
    void setPostingId(null)
    selectMonth(next)
  }

  async function handleToggleLock() {
    if (!activePeriodKey) return

    if (isLocked) {
      // ⚠️ Unlocking is mechanically just a setting write, so it is made loud.
      // It permits posting into a month the accountant may already have seen,
      // and because the setting is a THROUGH marker it reopens every month
      // after this one as well.
      const confirmed = await confirm({
        title: `Unlock ${periodLabel}?`,
        description: `Unlocking permits new postings into ${periodLabel} and every month after it - months that have already been closed and may already have been reported on. Anything posted after this changes figures somebody has seen.`,
        confirmText: 'Unlock the month',
        cancelText: 'Keep it locked',
        destructive: true,
      })
      if (!confirmed) return
    }

    // A THROUGH marker, not a per-month flag: locking March declares everything
    // up to and including March shut, and unlocking it winds the marker back to
    // February. `null` means nothing is closed.
    const previousLockedThrough = lockedThrough
    const nextLockedThrough = isLocked ? period.previousPeriodKey : activePeriodKey

    // Optimistic, same as the settings-door write this replaces: the toggle
    // should feel instant rather than wait on a round trip.
    if (organizationId) patchSettings(organizationId, { [LOCKED_THROUGH_KEY]: nextLockedThrough })

    setLockedThrough.mutate(
      { periodKey: nextLockedThrough },
      {
        onError: (error) => {
          if (organizationId) {
            patchSettings(organizationId, { [LOCKED_THROUGH_KEY]: previousLockedThrough })
          }
          toastError({ title: 'Error updating the period lock', description: error.message })
        },
        onSettled: () => {
          void utils.ledger.periods.invalidate()
          void utils.setting.getOrganizationSettingsWithMetadata.invalidate()
        },
      }
    )
  }

  const lockedThrough = (getSetting(LOCKED_THROUGH_KEY) as string | null) ?? null

  const postingDrawer = (
    <PostingDrawer
      postingId={postingId}
      onOpenChange={(open) => {
        if (!open) void setPostingId(null)
      }}
      onSelectPosting={openPosting}
      isDocked={isDesktop}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      currencyCode={currencyCode}
      bookTimeZone={bookTimeZone}
      providerLabel={providerLabel}
      connectedTenantId={provider.connectedTenantId}
      canUnsync={canControlLedger}
      onReverse={actions.runReverse}
      isReversing={actions.isReversing}
    />
  )

  const journalEntryDrawer = (
    <JournalEntryDrawer
      journalEntryId={journalEntryParam === 'new' ? null : journalEntryParam}
      isNew={journalEntryParam === 'new'}
      open={!!journalEntryParam}
      onOpenChange={(open) => {
        if (!open) void setJournalEntryParam(null)
      }}
      isDocked={isDesktop}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      currencyCode={currencyCode}
      defaultDate={activePeriodKey ? lastDayOfPeriod(activePeriodKey) : today(bookTimeZone)}
      onCreated={(id) => void setJournalEntryParam(id)}
      onPosted={(glPostingId) => {
        void utils.ledger.listPostings.invalidate()
        void utils.ledger.journalEntry.list.invalidate()
        void utils.ledger.periods.invalidate()
        openPosting(glPostingId)
      }}
      onOpenPosting={openPosting}
      onDiscarded={() => {
        // The record is archived, so every read that could still be showing it
        // is stale - and the drawer itself is now open over a record no read
        // path returns. Close it.
        void setJournalEntryParam(null)
        void utils.ledger.journalEntry.list.invalidate()
      }}
    />
  )

  const content = (
    <MainPageContent
      dockedPanels={
        isDesktop && (postingId || journalEntryParam)
          ? [
              {
                key: journalEntryParam ? 'je' : 'posting',
                content: journalEntryParam ? journalEntryDrawer : postingDrawer,
                width: dockedWidth,
                onWidthChange: setDockedWidth,
                minWidth: 380,
                maxWidth: 800,
              },
            ]
          : []
      }>
      {/* 🛑 The rail runs the FULL height and the toolbar is inside the content
          column, not across the top of both. The toolbar is the month picker
          and the month's state - it is about what the column below it is
          showing, and spanning it over the rail claimed it governed the rail
          too, which it never did (the Sync queue is every period). This is the
          shape `accounting/banking/layout.tsx` and its two siblings already
          have: nav column on the left, everything else to the right of it.

          ⚠️ A plain `flex` row, NOT `flex-col md:flex-row` the way those three
          layouts write it. They wrap `SidebarSecondary`, which is an inline
          column that has to stack above the content on a narrow screen;
          `ModuleSidebar` handles narrow itself by rendering into a Sheet, so a
          `flex-col` here would leave a zero-height stub above the toolbar. */}
      <div className='flex h-full overflow-hidden'>
        <LedgerSidebar
          view={isSyncQueueOpen ? 'sync-queue' : 'closeout'}
          onSelectView={selectView}
          syncQueue={failedExportsQuery.data}
          providerLabel={providerLabel}
        />

        <div className='flex h-full min-w-0 flex-1 flex-col overflow-hidden'>
          <LedgerToolbar
            periodKey={activePeriodKey}
            options={period.options}
            period={activePeriod}
            previousPeriodKey={period.previousPeriodKey}
            nextPeriodKey={period.nextPeriodKey}
            resolvedPeriodKey={period.resolvedPeriodKey}
            onSelectPeriod={goToPeriod}
            disabled={isChecklistState}
          />

          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            {/* ⚠️ The strip is about ONE month and the queue is about every
                period, so the two must not share a screen - a "September" header
                over a list reaching back eighteen months is a wrong claim about
                what is underneath it. */}
            {!isChecklistState && !isSyncQueueOpen && (
              <LedgerStats
                loading={period.isLoading}
                period={activePeriod}
                periodLabel={periodLabel}
                entryTotalMinor={entry.totalMinor}
                entryPending={entry.isLoading}
                blockerCount={entry.blockers.length}
                entryCount={activePeriodKey ? monthEntries.rows.length : null}
                draftCount={monthEntries.draftCount}
                balanceReport={balanceQuery.data}
                currencyCode={currencyCode}
              />
            )}

            {/* 🛑 NO padding on this column. Every `Section` below pads itself
                and draws a `border-b` that has to reach both edges; padding here
                would inset those rules and leave a gutter of background either
                side of each one. Anything in this column that is NOT a `Section`
                pads itself instead - the skeletons here, `LedgerBanners`, and
                `AccountingChecklistPanel`'s own `p-6`. */}
            <div className='flex w-full flex-col'>
              {isChecklistState ? (
                <AccountingChecklistPanel />
              ) : isSyncQueueOpen ? (
                /* 🛑 A VIEW of this page, not a route (D17). The rows open the
                   same `?posting=` drawer that is already docked beside it.

                   🛑 NO "Back to the month" action. The way back is the rail's
                   Closeout row, which is where somebody already looks to change
                   what this column shows; a second, differently-worded exit in
                   the section header made two affordances for one act and only
                   one of them looked like navigation. */

                <SyncQueuePanel
                  rows={failedExportsQuery.data}
                  isLoading={failedExportsQuery.isPending}
                  error={failedExportsQuery.isError ? failedExportsQuery.error.message : null}
                  tab={queueTab ?? 'held'}
                  onTabChange={(next) => void setQueueTab(next)}
                  providerLabel={providerLabel}
                  canSync={can('ledger.post')}
                  /* 🛑 `ledger.control`, not `ledger.post` (60 E5): withdrawing
                     rows out of the firm's books is the rung that closes a
                     period, not the one that posts a journal. */
                  canUnsync={canControlLedger}
                  activePostingId={postingId}
                  onSelectPosting={openPosting}
                />
              ) : period.isLoading ? (
                <div className='flex flex-col gap-3 p-3'>
                  <Skeleton className='h-24 w-full' />
                  <Skeleton className='h-64 w-full' />
                </div>
              ) : (
                <>
                  <LedgerBanners
                    hasPeriod={!!activePeriodKey}
                    hasOpenPeriod={period.hasOpenPeriod}
                    periodLabel={periodLabel}
                    exports={failedExportsQuery.data ?? []}
                    providerLabel={providerLabel}
                    onOpenSyncQueue={openSyncQueue}
                    blockers={activePeriodKey ? entry.blockers : []}
                    isSoftRefusal={entry.isSoftRefusal}
                    onFix={onFix}
                    onReviewLock={revealLock}
                    onNextPeriod={
                      period.nextPeriodKey
                        ? () => goToPeriod(period.nextPeriodKey as string)
                        : undefined
                    }
                  />

                  {!!activePeriodKey && (
                    <RevisionStrip
                      entries={entry.revisionEntries}
                      activePostingId={postingId}
                      onSelect={(id) => void setPostingId(id)}
                      bookTimeZone={bookTimeZone}
                    />
                  )}

                  {!!activePeriodKey && (
                    <MonthEndEntrySection
                      periodLabel={periodLabel}
                      currencyCode={currencyCode}
                      lines={entry.lines}
                      docNumber={entry.docNumber}
                      isLoading={entry.isLoading}
                      blockerCount={entry.blockers.length}
                      isPostedPeriod={isPostedPeriod}
                      justPosted={actions.justPosted}
                      canPost={entry.canPost}
                      isPosting={actions.isPosting}
                      onPost={actions.runPost}
                      isPreviewing={actions.isPreviewing}
                      onRebuild={actions.runPreview}
                      postResult={actions.postResult}
                      providerLabel={providerLabel}
                      connectedTenantId={provider.connectedTenantId ?? null}
                    />
                  )}

                  {/* Closing the month: the last thing that happens to it, and
                      the thing the rail item is named after. Directly under the
                      entry, because the entry is what you read before deciding
                      the month is done - and because `revealLock` (a close
                      refusal's "Review the lock") scrolls here. */}
                  {!!activePeriodKey && (
                    <div ref={closeSectionRef}>
                      <Section
                        title='Close the month'
                        icon={<Lock className='size-4' />}
                        description='Reverse what was posted, and declare the month shut. Locking is a THROUGH marker - it closes this month and every one before it.'
                        collapsible={false}>
                        <CloseMonthPanel
                          periodLabel={periodLabel}
                          isLocked={isLocked}
                          lockBlockedReason={lockBlockedReason}
                          lockedThrough={lockedThrough}
                          canControlLedger={canControlLedger}
                          onToggleLock={() => void handleToggleLock()}
                          canReverse={!!entry.postedPostingId}
                          onReverse={() =>
                            entry.postedPostingId && void setPostingId(entry.postedPostingId)
                          }
                        />
                      </Section>
                    </div>
                  )}

                  {/* Everything the month-end entry above is NOT: other
                      postings this period, plus drafts nobody has posted yet.
                      With no month resolved it is the whole of the screen. */}
                  <Section
                    className={SECTION_BLEED}
                    title='Entries'
                    icon={<FileText className='size-4' />}
                    description={
                      activePeriodKey
                        ? 'Every other entry dated in this month - postings and drafts alike.'
                        : 'Journal entries somebody has raised. There is no month-end entry to show until a month opens.'
                    }
                    collapsible={false}
                    actions={
                      /* 🛑 NOT gated on a period. This is the only door to a
                         manual entry in the module, and the drawer seeds its
                         Date from `today(bookTimeZone)` when no month
                         resolves. */
                      can('ledger.post') && (
                        <Button
                          variant='ghost'
                          size='sm'
                          disabled={isChecklistState}
                          onClick={() => openJournalEntry('new')}>
                          <Plus />
                          New journal entry
                        </Button>
                      )
                    }>
                    <EntriesList
                      periodKey={activePeriodKey || undefined}
                      currencyCode={currencyCode}
                      onSelectPosting={openPosting}
                      onSelectJournalEntry={openJournalEntry}
                    />
                  </Section>

                  {!!activePeriodKey && entry.assertions && (
                    <Section
                      title='Roll-forward'
                      icon={<Layers className='size-4' />}
                      description='Opening, activity and closing per balance, as this entry asserted them. The entry shows the delta; this shows what the delta is a delta of.'
                      collapsible={false}>
                      <EntryRollForward
                        assertions={entry.assertions}
                        currencyCode={currencyCode}
                        accountByRole={entry.accountByRole}
                      />
                    </Section>
                  )}

                  {/* Every section below this point is ABOUT a month, so each is
                  gated on one having resolved. */}

                  {!!activePeriodKey && lateArrivals && (
                    <Section
                      title='Late-arriving activity'
                      icon={<Clock3 className='size-4' />}
                      description='Rows dated before this month but entered after the previous close.'
                      collapsible={false}>
                      <LateArrivalsSection
                        arrivals={lateArrivals}
                        currencyCode={currencyCode}
                        bookTimeZone={bookTimeZone}
                        periodLabel={periodLabel}
                      />
                    </Section>
                  )}

                  {!!activePeriodKey && countAdjustments && (
                    <Section
                      title='Cycle-count evidence'
                      icon={<ClipboardCheck className='size-4' />}
                      description='Evidence about the closing inventory balance. Not a check that passed.'
                      collapsible={false}>
                      <CountEvidenceSection
                        adjustments={countAdjustments}
                        currencyCode={currencyCode}
                        bookTimeZone={bookTimeZone}
                      />
                    </Section>
                  )}

                  {/* The OTHER sweep (brief 20 §8.3): the balance sweep proves
                  our own rows balance, this one asks whether the connected
                  system agrees with them. On the period already on screen, as of
                  its last day, and only when somebody presses the button - the
                  read costs a round trip to the provider and the drift it finds
                  is made at close, not on a Tuesday. */}
                  {!!activePeriodKey && (
                    <Section
                      title={`Does ${providerLabel} agree?`}
                      icon={<ArrowLeftRight className='size-4' />}
                      description='Our balances and theirs as of the last day of this month, account by account. A comparison only - nothing here posts, and no statement reads it.'
                      collapsible={false}
                      actions={
                        <ProviderAgreementAction
                          agreement={agreement}
                          asOf={lastDayOfPeriod(activePeriodKey)}
                        />
                      }>
                      <ProviderAgreementPanel agreement={agreement} />
                    </Section>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </MainPageContent>
  )

  return (
    <>
      {/* 🛑 Page context, not rendered chrome. The rail used to carry the
          balance sweep's findings, the duplicate detector, processor fee
          treatment per rail and what posted this month - four blocks of figures
          with nothing to click. Declaring the page here is what puts
          `get_ledger_status` in scope for the dock's next turn, so those same
          numbers are answered when somebody asks for them.

          ⚠️ The MONTH is deliberately not bound. `SessionContext` carries a
          page plus typed entity refs and an accounting period is neither; the
          tool takes it as an argument instead of this page inventing a second
          context mechanism for one screen. */}
      <KopilotContext page={LEDGER_KOPILOT_PAGE} />

      {content}

      {/* Below the dock breakpoint the same drawers render as floating
          overlays. Placed outside `MainPageContent`, the way every other
          docked panel's overlay fallback is.

          🛑 Gated on the PARAM, not just the breakpoint. Rendered
          unconditionally the JE drawer never unmounted, so its draft hook kept
          the closed entry's lines and its "already asked for a record" guard,
          and the next `?je=new` opened onto the previous entry with Save,
          Preview and Post disabled forever. The dock above is gated the same
          way; this is the mobile half of the same rule. */}
      {!isDesktop && !!postingId && postingDrawer}
      {!isDesktop && !!journalEntryParam && journalEntryDrawer}

      <ConfirmDialog />
    </>
  )
}
