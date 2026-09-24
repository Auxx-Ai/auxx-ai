// apps/web/src/components/accounting/ui/ledger/closeout-page.tsx

'use client'

import type { ExportBatchTab } from '@auxx/lib/accounting/export/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowLeftRight, ClipboardCheck, Clock3, FileText, Lock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import { useAccountingMonth } from '~/components/accounting/hooks/use-accounting-month'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { useMonthEndEntry } from '~/components/accounting/hooks/use-month-end-entry'
import { useMonthEntries } from '~/components/accounting/hooks/use-month-entries'
import { AccountingChecklistPanel } from '~/components/accounting/ui/checklist/accounting-checklist-panel'
import { EntriesList } from '~/components/accounting/ui/journal/entries-list'
import { lastDayOfPeriod, today } from '~/components/accounting/ui/journal/period-helpers'
import {
  ProviderAgreementAction,
  ProviderAgreementPanel,
  useProviderAgreement,
} from '~/components/accounting/ui/provider-agreement/provider-agreement-panel'
import { KopilotContext } from '~/components/kopilot/context'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

import { CloseMonthPanel } from './close-month-panel'
import { type CountAdjustmentRow, CountEvidenceSection } from './count-evidence-section'
import { formatPeriodLabel, lockRefusalReason } from './format'
import { type LateArrivalRow, LateArrivalsSection } from './late-arrivals-section'
import { LedgerBanners } from './ledger-banners'
import { LedgerStats } from './ledger-stats'
import { LedgerSummaryPanel } from './ledger-summary-panel'
import { LedgerPeriodControls, ProviderPill } from './ledger-toolbar'
import { outboxHref } from './outbox-route'
import { useLedgerDrawers } from './use-ledger-drawers'

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
 * and what posted in a month.
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
 * Closeout, at `/app/accounting/closeout` — the month: its stats, its refusals,
 * the lock, its other entries. `?month=YYYY-MM` is what makes a month shareable
 * (`useAccountingMonth`); the Outbox is its own route because every tab there
 * reads with no month bound (81-one-accounting-shell.md §0).
 *
 * Three states:
 *
 *   1. Setup not finalized  -> the getting-started checklist, period nav disabled
 *   2. A month is open      -> that month's entry, ready to preview and post
 *   3. Everything posted    -> the most recent posted month, plus "nothing to close"
 *
 * 🛑 Under the L1 regime a month has exactly ONE entry (no receipt, build or
 * shipment posts individually), so the entry renders inline with no list. What a
 * month does have is a revision chain, which is why `?posting=<id>` exists.
 *
 * 🛑 An OPEN month renders the projected entry from `ledger.previewMonthEnd`; a
 * POSTED month renders the STORED entry from `ledger.get`. They are never
 * crossed. Re-running the builder over a posted month gives a different answer
 * the moment the subledger moves, and the number that matters is the one that
 * was posted.
 */
export function CloseoutPage() {
  const router = useRouter()
  const { requestedMonth, selectMonth, syncMonth } = useAccountingMonth()
  const period = useLedgerPeriod(requestedMonth)
  const provider = useAccountingProviderStatus()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const { can } = useAccess()

  /**
   * The Entries section's own view (TARGET §6) - Detail is one row per
   * posting, Summary groups them by avenue, grain, store, rail and currency.
   * Requires a month, so it rides with `activePeriodKey` rather than
   * outliving it into a month with nothing to group.
   */
  const [entriesView, setEntriesView] = useQueryState(
    'view',
    parseAsStringLiteral(['detail', 'summary']).withDefault('detail')
  )

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
  const isLocked = activePeriod?.state === 'locked'
  const isChecklistState = period.isSetupDraft
  const canControlLedger = can('ledger.control')
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL

  const openOutboxTab = useCallback((tab: ExportBatchTab) => router.push(outboxHref(tab)), [router])
  const openOutbox = useCallback(() => router.push(outboxHref('ready')), [router])

  const drawers = useLedgerDrawers({
    periodKey: activePeriodKey,
    currencyCode,
    bookTimeZone,
    providerLabel,
    defaultEntryDate: activePeriodKey ? lastDayOfPeriod(activePeriodKey) : today(bookTimeZone),
    onOpenOutbox: openOutboxTab,
  })
  const { closeDrawers, openJournalEntry, openPosting, postingId } = drawers

  // What the month still owes before it can be locked. A close posts nothing,
  // so this is a checklist rather than an entry.
  const entry = useMonthEndEntry({
    activePeriodKey,
    enabled: !isChecklistState && !!activePeriodKey,
  })

  // The banner's read: refusals only, summarised - the outbox is the list.
  const failedBatchesQuery = api.ledger.exportBatches.list.useQuery({ tab: 'failed' })
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
    isChecking: entry.isLoading,
    blockerCount: entry.items.length,
  })

  // ── Sections with no read (14-drive-the-close.md section 7) ────────────────
  //
  // 🛑 Both stay `undefined` on purpose and both sections therefore render
  // NOTHING. Neither read exists in `packages/lib` and neither is specified
  // anywhere. An empty state would assert "no counts were recorded" and "nothing
  // arrived late", and those are claims about the subledger that nobody has
  // gone and checked - which is worse than silence next to real numbers.
  const countAdjustments: CountAdjustmentRow[] | undefined = undefined
  const lateArrivals: LateArrivalRow[] | undefined = undefined

  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const lockedThrough = (getSetting(LOCKED_THROUGH_KEY) as string | null) ?? null

  // `ledgerControl`-gated (plans/accounting/tasks/done/12-accountant-permissions.md
  // §4.4): the period lock used to write `ledger.lockedThroughMonth` through
  // the generic `setting.updateOrganizationSetting` door, which asserted
  // `settingsManage` - handing whoever closes the books every organization
  // setting in the product. `ledger.setLockedThrough` is now the only door.
  const setLockedThrough = api.ledger.setLockedThrough.useMutation()

  // Fulfillments and credit memos post as they happen, so a blocker has no Fix dialog;
  // `LedgerBanners` still requires the prop.
  const onFix = useCallback(() => {}, [])

  const goToPeriod = useCallback(
    (next: string) => {
      // A drawer param deliberately does NOT survive: a posting belongs to one
      // month, and carrying it across would open a drawer on somebody else's entry.
      closeDrawers()
      selectMonth(next)
    },
    [closeDrawers, selectMonth]
  )

  /**
   * "Review the lock" from a close refusal — the lock is a section further down
   * this same column, so the remedy scrolls rather than navigates.
   */
  const closeSectionRef = useRef<HTMLDivElement>(null)
  const revealLock = useCallback(() => {
    closeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const toolbar = useMemo(
    () => ({
      left: (
        <LedgerPeriodControls
          periodKey={activePeriodKey}
          options={period.options}
          period={activePeriod}
          previousPeriodKey={period.previousPeriodKey}
          nextPeriodKey={period.nextPeriodKey}
          resolvedPeriodKey={period.resolvedPeriodKey}
          onSelectPeriod={goToPeriod}
          disabled={isChecklistState}
        />
      ),
      right: <ProviderPill />,
    }),
    [
      activePeriod,
      activePeriodKey,
      goToPeriod,
      isChecklistState,
      period.nextPeriodKey,
      period.options,
      period.previousPeriodKey,
      period.resolvedPeriodKey,
    ]
  )
  useRegisterAccountingToolbar(toolbar)

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

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {/* 🛑 Page context, not rendered chrome. Declaring the page here is what
          puts `get_ledger_status` in scope for the dock's next turn, so the
          balance sweep, the duplicate detector, processor fee treatment per rail
          and what posted this month are answered when somebody asks for them
          rather than standing in a rail nobody clicks.

          ⚠️ The MONTH is deliberately not bound. `SessionContext` carries a page
          plus typed entity refs and an accounting period is neither; the tool
          takes it as an argument. */}
      <KopilotContext page={LEDGER_KOPILOT_PAGE} />

      {/* Document page, so ONE scroll owner over the whole column
          (81-one-accounting-shell.md §6).
          🔀 `LedgerStats` scrolls away with everything else; pinning it is
          undecided (§9). */}
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {!isChecklistState && (
          <LedgerStats
            loading={period.isLoading}
            period={activePeriod}
            periodLabel={periodLabel}
            entryPending={entry.isLoading}
            blockerCount={entry.items.length}
            entryCount={activePeriodKey ? monthEntries.rows.length : null}
            draftCount={monthEntries.draftCount}
            balanceReport={balanceQuery.data}
            currencyCode={currencyCode}
          />
        )}

        {/* 🛑 NO padding on this column. Every `Section` below pads itself and
            draws a `border-b` that has to reach both edges; padding here would
            inset those rules and leave a gutter of background either side of
            each one. Anything that is NOT a `Section` pads itself instead. */}
        <div className='flex w-full flex-1 flex-col'>
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
                exports={failedBatchesQuery.data?.items ?? []}
                providerLabel={providerLabel}
                onOpenOutbox={openOutbox}
                blockers={activePeriodKey ? entry.blockers : []}
                isSoftRefusal={false}
                onFix={onFix}
                onReviewLock={revealLock}
                onNextPeriod={
                  period.nextPeriodKey
                    ? () => goToPeriod(period.nextPeriodKey as string)
                    : undefined
                }
              />

              {/* Closing the month: the last thing that happens to it, and the
                  thing the rail item is named after. Directly under the entry,
                  because the entry is what you read before deciding the month is
                  done - and because `revealLock` scrolls here. */}
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
                      canReverse={false}
                      onReverse={() => undefined}
                    />
                  </Section>
                </div>
              )}

              <Section
                className={SECTION_BLEED}
                title='Entries'
                icon={<FileText className='size-4' />}
                description={
                  activePeriodKey
                    ? entriesView === 'summary'
                      ? 'Posted entries grouped by avenue, grain, store, rail and currency (TARGET §6) - a batch state shows beside a row that has a live one.'
                      : 'Every entry dated in this month, and journal entries not yet posted.'
                    : 'Journal entries somebody has raised.'
                }
                collapsible={false}
                actions={
                  <div className='flex items-center gap-2'>
                    {/* Summary needs a month to group; with none resolved (a
                        finalized org whose cutoff is still ahead) there is
                        nothing to toggle to. */}
                    {!!activePeriodKey && (
                      <RadioTab
                        value={entriesView}
                        onValueChange={(value) =>
                          void setEntriesView(value as 'detail' | 'summary')
                        }
                        size='sm'>
                        <RadioTabItem value='detail'>Detail</RadioTabItem>
                        <RadioTabItem value='summary'>Summary</RadioTabItem>
                      </RadioTab>
                    )}
                    {/* 🛑 NOT gated on a period. This is the only door to a
                       manual entry in the module, and the drawer seeds its Date
                       from `today(bookTimeZone)` when no month resolves. */}
                    {can('ledger.post') && (
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={isChecklistState}
                        onClick={() => openJournalEntry('new')}>
                        <Plus />
                        New journal entry
                      </Button>
                    )}
                  </div>
                }>
                {!!activePeriodKey && entriesView === 'summary' ? (
                  <LedgerSummaryPanel
                    periodKey={activePeriodKey}
                    currencyCode={currencyCode}
                    bookTimeZone={bookTimeZone}
                    activePostingId={postingId}
                    onSelectPosting={openPosting}
                  />
                ) : (
                  <EntriesList
                    periodKey={activePeriodKey || undefined}
                    currencyCode={currencyCode}
                    onSelectPosting={openPosting}
                    onSelectJournalEntry={openJournalEntry}
                  />
                )}
              </Section>

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

              {/* The OTHER sweep (brief 20 §8.3): the balance sweep proves our
                  own rows balance, this one asks whether the connected system
                  agrees with them. On the period already on screen, as of its
                  last day, and only when somebody presses the button - the read
                  costs a round trip to the provider and the drift it finds is
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

      {drawers.overlays}
      <ConfirmDialog />
    </div>
  )
}
