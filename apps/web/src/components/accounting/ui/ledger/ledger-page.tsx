// apps/web/src/components/accounting/ui/ledger/ledger-page.tsx

'use client'

import { type AccountRole, NON_FAILURE_REFUSALS } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import {
  ArrowLeftRight,
  BookOpenCheck,
  CalendarCheck2,
  CircleSlash,
  ClipboardCheck,
  Clock3,
  Layers,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  Scale,
  Send,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useRef } from 'react'
import { useAccountingProviderStatus } from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { AccountingChecklistPanel } from '~/components/accounting/ui/checklist/accounting-checklist-panel'
import { EntriesList } from '~/components/accounting/ui/journal/entries-list'
import { JournalEntryDrawer } from '~/components/accounting/ui/journal/journal-entry-drawer'
import { lastDayOfPeriod, today } from '~/components/accounting/ui/journal/period-helpers'
import { ProviderAgreementPanel } from '~/components/accounting/ui/provider-agreement/provider-agreement-panel'
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
import { BooksBalanceLine, DuplicateMovementsCard, FailedExportsBanner } from './books-health'
import { type CountAdjustmentRow, CountEvidenceSection } from './count-evidence-section'
import { EntryBlockers, type LedgerBlocker } from './entry-blockers'
import { EntryJournal, journalLinesFromDetail } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatPeriodLabel } from './format'
import { type LateArrivalRow, LateArrivalsSection } from './late-arrivals-section'
import { LedgerToolbar } from './ledger-toolbar'
import { PostResultCallout } from './post-result-callout'
import { PostingDrawer } from './posting-drawer'
import { RevisionStrip, revisionEntryFromDetail } from './revision-strip'
import { readStoredAssertions } from './stored-draft'

/** The setting that declares how far the books are closed. `DOCUMENTS` scope. */
const LOCKED_THROUGH_KEY = 'ledger.lockedThroughMonth'

interface LedgerPageProps {
  /** Absent on `/app/accounting`, which resolves a period instead. */
  periodKey?: string
}

/**
 * The ledger: ONE component behind both `/app/accounting` and
 * `/app/accounting/[period]` (13-accounting-ui.md section 5.1).
 *
 * 🛑 `/app/accounting` RENDERS, it never redirects: a redirect would make the
 * module home URL unstable and break "Accounting" as a bookmark. Only the period
 * resolution differs between the two routes.
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
export function LedgerPage({ periodKey }: LedgerPageProps) {
  const router = useRouter()
  const period = useLedgerPeriod(periodKey)
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
  const lockSectionRef = useRef<HTMLDivElement | null>(null)

  const { activePeriod, activePeriodKey, bookTimeZone, currencyCode } = period
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

  // The stored entry for a posted month - lines, provider result and the frozen
  // assertions the roll-forward renders.
  const postedPostingId = activePeriod?.glPostingId ?? null
  const postedQuery = api.ledger.get.useQuery(
    { id: postedPostingId ?? '' },
    { enabled: !!postedPostingId }
  )
  const postedDetail = postedQuery.data

  // The one link the chain can be walked back along: a reversal names what it
  // reverses. See `RevisionStrip`'s header for why that is not the whole chain.
  const reversedQuery = api.ledger.get.useQuery(
    { id: postedDetail?.reversesId ?? '' },
    { enabled: !!postedDetail?.reversesId }
  )

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
  const roleMapQuery = api.ledger.roleMap.useQuery()

  const accountByRole: Partial<Record<AccountRole, { code: string | null; name: string }>> = {}
  for (const row of roleMapQuery.data ?? []) {
    if (row.account)
      accountByRole[row.role as AccountRole] = { code: row.account.code, name: row.account.name }
  }

  const revisionEntries = [postedDetail, reversedQuery.data]
    .filter((detail) => !!detail)
    .map(revisionEntryFromDetail)
    .sort((a, b) => b.revision - a.revision)

  const blockers: LedgerBlocker[] = actions.preview?.blockedBy ? [actions.preview.blockedBy] : []
  // 🛑 `nothing_to_close` and `setup_incomplete` are refusals, not faults. The
  // section around them says so too: "cannot be closed yet" over an empty month
  // is an alarm about the most ordinary thing that happens to a set of books.
  const isSoftRefusal = blockers.every((blocker) =>
    (NON_FAILURE_REFUSALS as readonly string[]).includes(blocker.status)
  )
  const lines = isPostedPeriod
    ? postedDetail
      ? journalLinesFromDetail(postedDetail.lines)
      : []
    : (actions.preview?.lines ?? [])
  const docNumber = isPostedPeriod ? activePeriod?.docNumber : actions.preview?.docNumber

  // Where the roll-forward's numbers come from, and it is a different source per
  // state.
  //
  // 🛑 A POSTED month reads the STORED assertions, never a re-derivation.
  // `reverseEntry` writes the reversal's envelope with the pair ALREADY swapped,
  // so reading it back verbatim is the only way a reversed month renders as
  // reversed. Re-deriving here would quietly undo the reversal on screen.
  //
  // An OPEN month reads them off the preview, which now carries the same
  // `assertions` object `postMonthEnd` hands the poster - not a second
  // derivation, so what you check before posting is what gets posted.
  const assertions = isPostedPeriod
    ? postedDetail
      ? readStoredAssertions(postedDetail.draft)
      : null
    : (actions.preview?.assertions ?? null)

  // 🛑 `isPostedPeriod` is `state !== 'open'`, so a LOCKED month takes this
  // branch too - and a locked month that was never posted carries no
  // `glPostingId`, which leaves `postedQuery` disabled. A disabled query sits at
  // `status: 'pending'` forever, so reading `isPending` alone pinned the journal
  // section to a skeleton that never resolved for every locked, never-posted
  // month. `lines` already falls back to `[]` on this path; the entry renders
  // empty, which is the truth about a month with no entry.
  const isEntryLoading = isPostedPeriod
    ? !!postedPostingId && postedQuery.isPending
    : actions.isPreviewing
  const canPost =
    !isPostedPeriod &&
    !isLocked &&
    blockers.length === 0 &&
    !actions.justPosted &&
    !!activePeriodKey

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
    router.push(`/app/accounting/${next}`)
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
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-2 p-4'>
          {isChecklistState ? (
            <AccountingChecklistPanel />
          ) : period.isLoading ? (
            <div className='flex flex-col gap-3'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-64 w-full' />
            </div>
          ) : (
            <>
              {/* 🛑 A BANNER, never a replacement for the body. As an early
                  return this card took the Entries list and the New journal
                  entry button down with it - and that button is the only door
                  to a manual entry anywhere in the module - so an org whose
                  cutoff is still ahead of the wall clock, or one whose period
                  read failed, could not raise an entry at all. */}
              {!activePeriodKey && (
                <Alert variant='neutral'>
                  <CalendarCheck2 />
                  <AlertTitle>No month is open for closing yet</AlertTitle>
                  <AlertDescription>
                    The first closable month is the one after the accounting cutoff. Nothing on or
                    before the cutoff belongs to this system. A journal entry can still be raised
                    below; it posts into whichever month its own date falls in.
                  </AlertDescription>
                </Alert>
              )}

              {(failedExportsQuery.data?.length ?? 0) > 0 && (
                <FailedExportsBanner exports={failedExportsQuery.data ?? []} />
              )}

              {!!activePeriodKey && !period.hasOpenPeriod && (
                <Alert variant='neutral'>
                  <CalendarCheck2 />
                  <AlertTitle>Nothing to close</AlertTitle>
                  <AlertDescription>
                    Every month from the cutoff forward has been posted. {periodLabel} is the most
                    recent, and it is shown below.
                  </AlertDescription>
                </Alert>
              )}

              {!!activePeriodKey && (
                <RevisionStrip
                  entries={revisionEntries}
                  activePostingId={postingId}
                  onSelect={(id) => void setPostingId(id)}
                  bookTimeZone={bookTimeZone}
                />
              )}

              {!!activePeriodKey && blockers.length > 0 && (
                <Section
                  title={
                    isSoftRefusal
                      ? `There is nothing to post for ${periodLabel}`
                      : `${periodLabel} cannot be closed yet`
                  }
                  icon={
                    isSoftRefusal ? <CircleSlash className='size-4' /> : <Lock className='size-4' />
                  }
                  description='Every refusal names what is missing and where it is fixed.'
                  collapsible={false}>
                  <EntryBlockers
                    blockers={blockers}
                    onReviewLock={() =>
                      lockSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                    }
                    onNextPeriod={
                      period.nextPeriodKey
                        ? () => goToPeriod(period.nextPeriodKey as string)
                        : undefined
                    }
                  />
                </Section>
              )}

              <Section
                title='Entries'
                icon={<BookOpenCheck className='size-4' />}
                secondary={docNumber ?? undefined}
                description={
                  !activePeriodKey
                    ? 'Journal entries somebody has raised. There is no month-end entry to show until a month opens.'
                    : isPostedPeriod
                      ? 'The stored month-end entry, exactly as it was posted, plus every other entry this month. Never a re-run of the builder.'
                      : `The month-end inventory entry auxx would post for ${periodLabel}, plus every other entry this month.`
                }
                collapsible={false}
                actions={
                  <div className='flex items-center gap-1'>
                    {!!activePeriodKey && !isPostedPeriod && (
                      /* 🛑 The spinner is rendered here rather than through
                         `loading`, because `Button` DISABLES a loading button -
                         and a preview that never settles would then leave the
                         only affordance that can refire it disabled, with a
                         reload as the sole way out. Refiring is free:
                         `previewMonthEnd` persists nothing, and the second
                         answer replaces the first. */
                      <Button variant='ghost' size='sm' onClick={actions.runPreview}>
                        {actions.isPreviewing ? (
                          <>
                            <Loader2 className='animate-spin' />
                            Building...
                          </>
                        ) : (
                          'Rebuild preview'
                        )}
                      </Button>
                    )}
                    {/* 🛑 NOT gated on a period. This is the only door to a
                        manual entry in the module, and the drawer seeds its
                        Date from `today(bookTimeZone)` when no month
                        resolves. */}
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
                {!activePeriodKey ? null : isEntryLoading && lines.length === 0 ? (
                  <Skeleton className='h-48 w-full' />
                ) : lines.length === 0 && blockers.length > 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    No entry was built. The refusals above are the whole of what happened.
                  </p>
                ) : (
                  <div className='flex flex-col gap-4'>
                    {/* ⚠️ No drill-down affordance: the subledger report behind a
                        line does not exist (section 7). `onDrillDown` is left
                        off rather than opening an empty dialog. */}
                    <EntryJournal lines={lines} currencyCode={currencyCode} />

                    {actions.postResult && (
                      <PostResultCallout
                        result={actions.postResult}
                        providerLabel={providerLabel}
                        connectedTenantId={provider.connectedTenantId}
                      />
                    )}

                    {/* 🛑 Post and Reverse live HERE, beside the entry they act
                        on, not in the toolbar. They are the decision, not
                        navigation, and exceptions and the Post control share one
                        screen by design. */}
                    <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
                      <Button
                        disabled={!canPost}
                        loading={actions.isPosting}
                        loadingText='Posting...'
                        onClick={actions.runPost}>
                        <Send />
                        Post {periodLabel}
                      </Button>
                      <Button
                        variant='outline'
                        disabled={!postedPostingId}
                        onClick={() => postedPostingId && void setPostingId(postedPostingId)}>
                        Reverse or re-enter
                      </Button>
                      <Separator orientation='vertical' className='h-6' />
                      <span className='text-xs text-muted-foreground'>
                        {canPost
                          ? 'Posting records the entry here and pushes it to the accounting system, if one is connected.'
                          : isPostedPeriod || actions.justPosted
                            ? 'This month is posted. A mistake is corrected by reversing and re-entering, never by editing.'
                            : isLocked
                              ? 'This month is locked. Nothing can post into it until it is unlocked.'
                              : 'Posting is refused until the blockers above are cleared.'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Everything the month-end entry above is NOT: other postings
                    this period, plus drafts nobody has posted yet. With no
                    month resolved it is the whole of the section. */}
                <div className={activePeriodKey ? 'mt-4 border-t pt-3' : ''}>
                  <EntriesList
                    periodKey={activePeriodKey || undefined}
                    currencyCode={currencyCode}
                    onSelectPosting={openPosting}
                    onSelectJournalEntry={openJournalEntry}
                  />
                </div>
              </Section>

              {!!activePeriodKey && assertions && (
                <Section
                  title='Roll-forward'
                  icon={<Layers className='size-4' />}
                  description='Opening, activity and closing per balance, as this entry asserted them. The entry shows the delta; this shows what the delta is a delta of.'
                  collapsible={false}>
                  <EntryRollForward
                    assertions={assertions}
                    currencyCode={currencyCode}
                    accountByRole={accountByRole}
                  />
                </Section>
              )}

              {/* Every section below this point is ABOUT a month, so each is
                  gated on one having resolved. Only the Entries section above
                  and the books sweep below survive the no-period state. */}
              {!!activePeriodKey && (
                <div ref={lockSectionRef}>
                  <Section
                    title='Close the month'
                    icon={isLocked ? <Lock className='size-4' /> : <LockOpen className='size-4' />}
                    description='Declaring the month shut is a separate assertion from posting the entry.'
                    collapsible={false}>
                    <div className='flex flex-wrap items-center gap-3'>
                      {canControlLedger ? (
                        <>
                          <Button
                            variant={isLocked ? 'outline' : 'default'}
                            disabled={!isPostedPeriod && !actions.justPosted}
                            onClick={() => void handleToggleLock()}>
                            {isLocked ? <LockOpen /> : <Lock />}
                            {isLocked ? `Unlock ${periodLabel}` : `Lock ${periodLabel}`}
                          </Button>
                          <span className='text-sm text-muted-foreground'>
                            {isLocked
                              ? 'Locked. Nothing can post into this month until it is unlocked, and unlocking asks first.'
                              : 'Open. The entry can still be reversed and re-entered.'}
                          </span>
                        </>
                      ) : (
                        <span className='text-sm text-muted-foreground'>
                          {isLocked ? 'Locked' : 'Not locked'}
                        </span>
                      )}
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      {lockedThrough
                        ? `The books are closed through ${formatPeriodLabel(lockedThrough)}.`
                        : 'Nothing is closed yet.'}
                    </p>
                  </Section>
                </div>
              )}

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

              <Section
                title='Books'
                icon={<Scale className='size-4' />}
                description='The after-the-fact balance sweep across every posting in the books.'
                collapsible={false}>
                {balanceQuery.data ? (
                  <BooksBalanceLine report={balanceQuery.data} />
                ) : balanceQuery.isError ? (
                  /* 🛑 A failed sweep and a running one are not the same state.
                     Rendering both as a skeleton hides the one that never
                     resolves, which is how a refused sweep read as "still
                     loading" indefinitely. */
                  <p className='text-sm text-destructive'>
                    The balance sweep could not run, so nothing here has been checked.{' '}
                    {balanceQuery.error.message}
                  </p>
                ) : (
                  <Skeleton className='h-6 w-64' />
                )}

                {/* The duplicate detector (brief 18 §1). Renders nothing while
                    loading or clean - unlike the balance sweep above, a
                    running or empty read here is not itself news. */}
                {!!duplicateMovementsQuery.data?.length && (
                  <div className='mt-3'>
                    <DuplicateMovementsCard
                      findings={duplicateMovementsQuery.data}
                      currencyCode={currencyCode}
                      bookTimeZone={bookTimeZone}
                    />
                  </div>
                )}
              </Section>

              {/* The OTHER sweep (brief 20 §8.3): the one above proves our own
                  rows balance, this one asks whether the connected system
                  agrees with them. On the period already on screen, as of its
                  last day, and only when somebody presses the button - the read
                  costs a round trip to QuickBooks and the drift it finds is
                  made at close, not on a Tuesday. */}
              {!!activePeriodKey && (
                <Section
                  title={`Does ${providerLabel} agree?`}
                  icon={<ArrowLeftRight className='size-4' />}
                  description='Our balances and theirs as of the last day of this month, account by account. A comparison only - nothing here posts, and no statement reads it.'
                  collapsible={false}>
                  <ProviderAgreementPanel asOf={lastDayOfPeriod(activePeriodKey)} />
                </Section>
              )}
            </>
          )}
        </div>
      </ScrollArea>
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
