// apps/web/src/components/accounting/ui/ledger/ledger-page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Separator } from '@auxx/ui/components/separator'
import {
  BookOpenCheck,
  CalendarCheck2,
  ClipboardCheck,
  Clock3,
  Layers,
  Lock,
  LockOpen,
  Scale,
  Send,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import {
  FIXTURE_ASSERTIONS,
  FIXTURE_BOOK_TIME_ZONE,
  FIXTURE_BOOKS_BALANCE,
  FIXTURE_COUNT_ADJUSTMENTS,
  FIXTURE_LATE_ARRIVALS,
  FIXTURE_POSTED_DRAFT,
  FIXTURE_PROVIDER,
  FIXTURE_REVISIONS,
  FIXTURE_ROLE_ACCOUNTS,
  FIXTURE_UNPOSTED_PERIODS,
  type FixtureRevision,
} from '~/components/accounting/fixtures'
import { useLedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
// PLACEHOLDER SLOT: another agent owns this component (13-accounting-ui.md
// §5.5). Setup-not-finalized is the module home's FIRST state: the body IS the
// goals, progress and CTAs, not a sidebar widget.
import { AccountingChecklistPanel } from '~/components/accounting/ui/checklist/accounting-checklist-panel'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useSettings } from '~/hooks/use-settings'
import { useDockStore } from '~/stores/dock-store'
import { BooksBalanceLine, UnpostedPeriodsBanner } from './books-health'
import { CountEvidenceSection } from './count-evidence-section'
import { EntryBlockers, type LedgerBlocker } from './entry-blockers'
import { EntryJournal } from './entry-journal'
import { EntryRollForward } from './entry-roll-forward'
import { formatPeriodLabel } from './format'
import { LateArrivalsSection } from './late-arrivals-section'
import { LedgerToolbar } from './ledger-toolbar'
import { LineDrillDown, type LineDrillDownTarget } from './line-drill-down'
import { PostResultCallout } from './post-result-callout'
import { PostingDrawer } from './posting-drawer'
import { RevisionStrip } from './revision-strip'

/** Account code per role, for the roll-forward's left column. */
const ACCOUNT_CODE_BY_ROLE = Object.fromEntries(
  Object.entries(FIXTURE_ROLE_ACCOUNTS).map(([role, account]) => [role, account.code])
)

interface LedgerPageProps {
  /** Absent on `/app/accounting`, which resolves a period instead. */
  periodKey?: string
}

/**
 * The ledger: ONE component behind both `/app/accounting` and
 * `/app/accounting/[period]` (13-accounting-ui.md §5.1).
 *
 * 🛑 `/app/accounting` RENDERS, it never redirects: a redirect would make the
 * module home URL unstable and break "Accounting" as a bookmark. Only the period
 * resolution differs between the two routes.
 *
 * Three states:
 *
 *   1. Setup not finalized  → the getting-started checklist, period nav disabled
 *   2. A month is open      → that month's entry, ready to preview and post
 *   3. Everything posted    → the most recent posted month, plus "nothing to close"
 *
 * 🛑 Under the L1 regime a month has exactly ONE entry (no receipt, build or
 * shipment posts individually), so the entry renders inline with no list. What a
 * month does have is a revision chain, which is why the revision strip appears
 * only above revision 0 and why `?posting=<id>` exists.
 *
 * ⚠️ Every number on this screen is placeholder data from
 * `~/components/accounting/fixtures`. See `use-ledger-entry-actions.ts` for the
 * four procedures that replace it.
 */
export function LedgerPage({ periodKey }: LedgerPageProps) {
  const router = useRouter()
  const period = useLedgerPeriod(periodKey)
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const [confirm, ConfirmDialog] = useConfirm()

  // 🛑 The deep link. A ledger entry is the thing somebody pastes into Slack.
  const [postingId, setPostingId] = useQueryState('posting')
  const [drillDown, setDrillDown] = useState<LineDrillDownTarget | null>(null)
  const lockSectionRef = useRef<HTMLDivElement | null>(null)

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currencyCode = (getSetting('organization.currency') as string) || 'USD'
  // PLACEHOLDER: `accounting.bookTimeZone` is a real catalog key; the fixture
  // value stands in until an org has been through setup.
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FIXTURE_BOOK_TIME_ZONE

  const activePeriodKey = period.activePeriodKey
  const summary = period.activeSummary
  const periodLabel = formatPeriodLabel(activePeriodKey)
  const isBlocked = period.screenState === 'blocked'
  const isPostedPeriod = !!summary && summary.state !== 'open'

  const actions = useLedgerEntryActions({
    periodKey: activePeriodKey,
    blocked: isBlocked,
    providerConnected: period.providerConnected,
  })

  // PLACEHOLDER: `ledger.lockedThroughMonth` is a DOCUMENTS-scope setting and
  // nothing in the app writes it today: the last step of a close currently has
  // no button anywhere. Locking is a SEPARATE action from posting, never a side
  // effect of it: a person may reasonably want to post, look at it for a day,
  // then lock (13-accounting-ui.md §5.2).
  const [lockOverrides, setLockOverrides] = useState<Record<string, boolean>>({})
  const isLocked = lockOverrides[activePeriodKey] ?? summary?.state === 'locked'

  // PLACEHOLDER: `ledger.get(id)` returns the chain. Only 2027-02 carries a
  // reversal in the fixtures, so a posted month without one is given its single
  // revision 0 here rather than leaving the drawer unreachable from it.
  const revisions: FixtureRevision[] =
    FIXTURE_REVISIONS[activePeriodKey] ??
    (summary && summary.state !== 'open' && summary.docNumber
      ? [
          {
            glPostingId: `glp_${activePeriodKey.replace('-', '_')}_r0`,
            revision: 0,
            status: 'posted',
            docNumber: summary.docNumber,
            postedAt: summary.postedAt ?? '',
          },
        ]
      : [])
  const showRevisionStrip = !!summary && summary.revision > 0 && revisions.length > 1

  const blockers: LedgerBlocker[] = actions.preview.blockedBy ? [actions.preview.blockedBy] : []
  const lines = isPostedPeriod ? FIXTURE_POSTED_DRAFT.resolvedLines : actions.preview.lines
  const canPost = !isPostedPeriod && !isLocked && blockers.length === 0 && !actions.justPosted

  function goToPeriod(next: string) {
    // The placeholder `?state=` / `?provider=` toggles are carried across a
    // period change so a demo state survives navigation. They go away with the
    // fixtures; `?posting=` deliberately does NOT survive, because a posting id
    // belongs to one month.
    const carried = new URLSearchParams()
    if (period.screenState !== 'open') carried.set('state', period.screenState)
    if (!period.providerConnected) carried.set('provider', 'none')
    const query = carried.toString()
    router.push(`/app/accounting/${next}${query ? `?${query}` : ''}`)
  }

  async function handleToggleLock() {
    if (isLocked) {
      // ⚠️ Unlocking is mechanically just a setting write, so it is made loud.
      // It permits posting into a month the accountant may already have seen.
      const confirmed = await confirm({
        title: `Unlock ${periodLabel}?`,
        description: `Unlocking permits new postings into ${periodLabel}, a month that has already been closed and may already have been reported on. Anything posted after this changes figures somebody has seen.`,
        confirmText: 'Unlock the month',
        cancelText: 'Keep it locked',
        destructive: true,
      })
      if (!confirmed) return
    }
    // PLACEHOLDER: writes `ledger.lockedThroughMonth` (scope DOCUMENTS).
    setLockOverrides((previous) => ({ ...previous, [activePeriodKey]: !isLocked }))
  }

  const postingDrawer = (
    <PostingDrawer
      postingId={postingId}
      chain={revisions}
      chainPeriodKey={activePeriodKey}
      onOpenChange={(open) => {
        if (!open) void setPostingId(null)
      }}
      isDocked={isDesktop}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      currencyCode={currencyCode}
      bookTimeZone={bookTimeZone}
      providerLabel={FIXTURE_PROVIDER.label}
      providerConnected={period.providerConnected}
    />
  )

  const isChecklistState = period.screenState === 'checklist'

  const content = (
    <MainPageContent
      dockedPanels={
        isDesktop && postingId
          ? [
              {
                key: 'posting',
                content: postingDrawer,
                width: dockedWidth,
                onWidthChange: setDockedWidth,
                minWidth: 380,
                maxWidth: 720,
              },
            ]
          : []
      }>
      <LedgerToolbar
        periodKey={activePeriodKey}
        options={period.options}
        summary={summary}
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
          ) : (
            <>
              {FIXTURE_UNPOSTED_PERIODS.length > 0 && (
                <UnpostedPeriodsBanner periods={FIXTURE_UNPOSTED_PERIODS} />
              )}

              {!period.hasOpenPeriod && (
                <div className='flex items-start gap-3 rounded-xl border bg-muted/40 p-4'>
                  <CalendarCheck2 className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
                  <div className='flex flex-col gap-1'>
                    <span className='font-medium'>Nothing to close</span>
                    <p className='text-sm text-muted-foreground'>
                      Every month from the cutoff forward has been posted. {periodLabel} is the most
                      recent, and it is shown below.
                    </p>
                  </div>
                </div>
              )}

              {showRevisionStrip && (
                <RevisionStrip
                  revisions={revisions}
                  activePostingId={postingId}
                  onSelect={(id) => void setPostingId(id)}
                  bookTimeZone={bookTimeZone}
                />
              )}

              {blockers.length > 0 && (
                <Section
                  title={`${periodLabel} cannot be closed yet`}
                  icon={<Lock className='size-4' />}
                  description='Every refusal names what is missing and where it is fixed.'
                  collapsible={false}>
                  <EntryBlockers
                    blockers={blockers}
                    onReviewLock={() =>
                      lockSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                    }
                  />
                </Section>
              )}

              <Section
                title='Journal entry'
                icon={<BookOpenCheck className='size-4' />}
                secondary={actions.preview.docNumber}
                description={
                  isPostedPeriod
                    ? 'The stored draft, exactly as it was posted. Never a re-run of the builder.'
                    : `The month-end inventory entry auxx would post for ${periodLabel}.`
                }
                collapsible={false}
                actions={
                  <div className='flex items-center gap-1'>
                    {!isPostedPeriod && (
                      <Button
                        variant='ghost'
                        size='sm'
                        loading={actions.isPreviewing}
                        loadingText='Building...'
                        onClick={actions.runPreview}>
                        Rebuild preview
                      </Button>
                    )}
                  </div>
                }>
                {lines.length === 0 && blockers.length > 0 ? (
                  <p className='text-sm text-muted-foreground'>
                    No entry was built. The refusals above are the whole of what happened.
                  </p>
                ) : (
                  <div className='flex flex-col gap-4'>
                    <EntryJournal
                      lines={lines}
                      currencyCode={currencyCode}
                      onDrillDown={(accountCode, accountName) =>
                        setDrillDown({ accountCode, accountName })
                      }
                    />

                    {actions.postResult && (
                      <PostResultCallout
                        result={actions.postResult}
                        providerLabel={FIXTURE_PROVIDER.label}
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
                        disabled={!isPostedPeriod || revisions.length === 0}
                        onClick={() => {
                          const newest = revisions[0]
                          if (newest) void setPostingId(newest.glPostingId)
                        }}>
                        Reverse or re-enter
                      </Button>
                      <Separator orientation='vertical' className='h-6' />
                      <span className='text-xs text-muted-foreground'>
                        {canPost
                          ? 'Posting records the entry here and pushes it to the accounting system, if one is connected.'
                          : isPostedPeriod || actions.justPosted
                            ? 'This month is posted. A mistake is corrected by reversing and re-entering, never by editing.'
                            : 'Posting is refused until the blockers above are cleared.'}
                      </span>
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title='Roll-forward'
                icon={<Layers className='size-4' />}
                description='Opening, activity and closing per balance. The entry shows the delta; this shows what the delta is a delta of.'
                collapsible={false}>
                <EntryRollForward
                  assertions={FIXTURE_ASSERTIONS}
                  currencyCode={currencyCode}
                  accountCodeByRole={ACCOUNT_CODE_BY_ROLE}
                />
              </Section>

              <div ref={lockSectionRef}>
                <Section
                  title='Close the month'
                  icon={isLocked ? <Lock className='size-4' /> : <LockOpen className='size-4' />}
                  description='Declaring the month shut is a separate assertion from posting the entry.'
                  collapsible={false}>
                  <div className='flex flex-wrap items-center gap-3'>
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
                  </div>
                </Section>
              </div>

              <Section
                title='Late-arriving activity'
                icon={<Clock3 className='size-4' />}
                description='Rows dated before this month but entered after the previous close.'
                collapsible={false}>
                <LateArrivalsSection
                  arrivals={FIXTURE_LATE_ARRIVALS}
                  currencyCode={currencyCode}
                  bookTimeZone={bookTimeZone}
                  periodLabel={periodLabel}
                />
              </Section>

              <Section
                title='Cycle-count evidence'
                icon={<ClipboardCheck className='size-4' />}
                description='Evidence about the closing inventory balance. Not a check that passed.'
                collapsible={false}>
                <CountEvidenceSection
                  adjustments={FIXTURE_COUNT_ADJUSTMENTS}
                  currencyCode={currencyCode}
                  bookTimeZone={bookTimeZone}
                />
              </Section>

              <Section
                title='Books'
                icon={<Scale className='size-4' />}
                description='The after-the-fact balance sweep across every posting in the books.'
                collapsible={false}>
                <BooksBalanceLine report={FIXTURE_BOOKS_BALANCE} />
              </Section>
            </>
          )}

          <PlaceholderStateSwitcher
            screenState={period.screenState}
            onScreenStateChange={period.setScreenState}
            providerConnected={period.providerConnected}
            onProviderConnectedChange={period.setProviderConnected}
          />
        </div>
      </ScrollArea>
    </MainPageContent>
  )

  return (
    <>
      {content}

      {/* Below the dock breakpoint the same drawer renders as a floating
          overlay. Placed outside `MainPageContent`, the way every other docked
          panel's overlay fallback is. */}
      {!isDesktop && postingDrawer}

      <LineDrillDown
        target={drillDown}
        onOpenChange={(open) => {
          if (!open) setDrillDown(null)
        }}
        currencyCode={currencyCode}
        bookTimeZone={bookTimeZone}
        periodLabel={periodLabel}
      />

      <ConfirmDialog />
    </>
  )
}

interface PlaceholderStateSwitcherProps {
  screenState: ReturnType<typeof useLedgerPeriod>['screenState']
  onScreenStateChange: (state: PlaceholderStateSwitcherProps['screenState']) => void
  providerConnected: boolean
  onProviderConnectedChange: (connected: boolean) => void
}

const PLACEHOLDER_STATES: Array<{
  value: PlaceholderStateSwitcherProps['screenState']
  label: string
}> = [
  { value: 'checklist', label: 'Setup not finalized' },
  { value: 'open', label: 'A month is open' },
  { value: 'blocked', label: 'Open, preview refused' },
  { value: 'posted', label: 'Everything posted' },
]

/**
 * 🛑 PLACEHOLDER CONTROL: delete with `fixtures.ts`.
 *
 * The four procedures in 13-accounting-ui.md §4 do not exist, so nothing on this
 * screen can reach a state by doing the thing that causes it. This strip writes
 * `?state=` and `?provider=` so every state is reachable and reviewable. It is
 * not a product feature and no real org will ever see it.
 */
function PlaceholderStateSwitcher({
  screenState,
  onScreenStateChange,
  providerConnected,
  onProviderConnectedChange,
}: PlaceholderStateSwitcherProps) {
  return (
    <div className='mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3'>
      <span className='text-xs font-medium text-muted-foreground'>Placeholder states</span>
      <Separator orientation='vertical' className='h-5' />
      {PLACEHOLDER_STATES.map((state) => (
        <Button
          key={state.value}
          variant={screenState === state.value ? 'secondary' : 'ghost'}
          size='sm'
          onClick={() => onScreenStateChange(state.value)}>
          {state.label}
        </Button>
      ))}
      <Separator orientation='vertical' className='h-5' />
      <Button
        variant={providerConnected ? 'ghost' : 'secondary'}
        size='sm'
        onClick={() => onProviderConnectedChange(!providerConnected)}>
        {providerConnected ? 'Provider connected' : 'No provider connected'}
      </Button>
    </div>
  )
}
