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
  CircleSlash,
  ClipboardCheck,
  Clock3,
  FileText,
  Layers,
  Lock,
  Plus,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect } from 'react'
import { useAccountingMonth } from '~/components/accounting/hooks/use-accounting-month'
import { useAccountingProviderStatus } from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useMonthEndEntry } from '~/components/accounting/hooks/use-month-end-entry'
import { useMonthEntries } from '~/components/accounting/hooks/use-month-entries'
import { useLedgerSidebarStore } from '~/components/accounting/stores/ledger-sidebar-store'
import { AccountingChecklistPanel } from '~/components/accounting/ui/checklist/accounting-checklist-panel'
import { EntriesList } from '~/components/accounting/ui/journal/entries-list'
import { JournalEntryDrawer } from '~/components/accounting/ui/journal/journal-entry-drawer'
import { lastDayOfPeriod, today } from '~/components/accounting/ui/journal/period-helpers'
import {
  ProviderAgreementAction,
  ProviderAgreementPanel,
  useProviderAgreement,
} from '~/components/accounting/ui/provider-agreement/provider-agreement-panel'
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

import { type CountAdjustmentRow, CountEvidenceSection } from './count-evidence-section'
import { EntryBlockers } from './entry-blockers'
import { EntryRollForward } from './entry-roll-forward'
import { formatPeriodLabel, lockRefusalReason } from './format'
import { type LateArrivalRow, LateArrivalsSection } from './late-arrivals-section'
import { LedgerBanners } from './ledger-banners'
import { LedgerStats } from './ledger-stats'
import { LedgerToolbar } from './ledger-toolbar'
import { MonthEndEntrySection } from './month-end-entry-section'
import { PostingDrawer } from './posting-drawer'
import { RevisionStrip } from './revision-strip'
import { LedgerSidebar } from './sidebar/ledger-sidebar'

/** The setting that declares how far the books are closed. `DOCUMENTS` scope. */
const LOCKED_THROUGH_KEY = 'ledger.lockedThroughMonth'

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
  const setSidebarOpen = useLedgerSidebarStore((state) => state.setOpen)

  /**
   * 🛑 The lock lives in the RAIL now, so "Review the lock" opens the rail
   * rather than scrolling. A scroll target that is inside a collapsed sidebar
   * scrolls to nothing and the refusal's only remedy reads as a dead button.
   */
  const revealLock = useCallback(() => setSidebarOpen(true), [setSidebarOpen])

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
  const providerLabel = provider.providerLabel ?? 'the accounting system'

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
  // The duplicate detector (plans/accounting/tasks/18-two-feeds-one-author.md
  // §1). Same month, same `||` (not `??`) reasoning as `balanceQuery` above -
  // `activePeriodKey` is `''` while periods are loading and permanently for a
  // finalized org whose cutoff is still ahead of the wall clock.
  const duplicateMovementsQuery = api.ledger.duplicateMovements.useQuery({
    periodKey: activePeriodKey || undefined,
  })
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

  // `ledgerControl`-gated (plans/accounting/tasks/12-accountant-permissions.md
  // §4.4): the period lock used to write `ledger.lockedThroughMonth` through
  // the generic `setting.updateOrganizationSetting` door, which asserted
  // `settingsManage` - handing whoever closes the books every organization
  // setting in the product. `ledger.setLockedThrough` is now the only door.
  const setLockedThrough = api.ledger.setLockedThrough.useMutation()

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
      {/* The dispatch board's shell: one toolbar across the top, then the
          module rail and the content as flex siblings beneath it. */}
      <div className='flex h-full flex-col overflow-hidden'>
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

        <div className='flex flex-1 overflow-hidden'>
          <LedgerSidebar
            periodLabel={periodLabel}
            isLocked={isLocked}
            lockBlockedReason={lockBlockedReason}
            lockedThrough={lockedThrough}
            canControlLedger={canControlLedger}
            onToggleLock={() => void handleToggleLock()}
            canReverse={!!entry.postedPostingId}
            onReverse={() => entry.postedPostingId && void setPostingId(entry.postedPostingId)}
            balanceReport={balanceQuery.data}
            balanceError={balanceQuery.isError ? balanceQuery.error.message : null}
            duplicates={duplicateMovementsQuery.data}
            currencyCode={currencyCode}
            bookTimeZone={bookTimeZone}
            hasPeriod={!!activePeriodKey && !isChecklistState}
          />

          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            {!isChecklistState && (
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
                  />

                  {!!activePeriodKey && (
                    <RevisionStrip
                      entries={entry.revisionEntries}
                      activePostingId={postingId}
                      onSelect={(id) => void setPostingId(id)}
                      bookTimeZone={bookTimeZone}
                    />
                  )}

                  {!!activePeriodKey && entry.blockers.length > 0 && (
                    <Section
                      title={
                        entry.isSoftRefusal
                          ? `There is nothing to post for ${periodLabel}`
                          : `${periodLabel} cannot be closed yet`
                      }
                      icon={
                        entry.isSoftRefusal ? (
                          <CircleSlash className='size-4' />
                        ) : (
                          <Lock className='size-4' />
                        )
                      }
                      description='Every refusal names what is missing and where it is fixed.'
                      collapsible={false}>
                      <EntryBlockers
                        blockers={entry.blockers}
                        onReviewLock={revealLock}
                        onNextPeriod={
                          period.nextPeriodKey
                            ? () => goToPeriod(period.nextPeriodKey as string)
                            : undefined
                        }
                      />
                    </Section>
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
                  gated on one having resolved. Closing the month and the balance
                  sweep are no longer among them - they live in the rail
                  (`sidebar/ledger-sidebar.tsx`), because consulting them is not
                  the work this column is for. */}

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

                  {/* The OTHER sweep (brief 20 §8.3): the rail's Books group
                  proves our own rows balance, this one asks whether the
                  connected system agrees with them. On the period already on screen, as of its
                  last day, and only when somebody presses the button - the read
                  costs a round trip to QuickBooks and the drift it finds is
                  made at close, not on a Tuesday. */}
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
