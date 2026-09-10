// apps/web/src/components/manufacturing/ui/settings/opening-stock-run.tsx
'use client'

// The right column of the Opening stock tab (money 52-parts-costing-page.md
// §2.3): THE RUN, not a per-part editor.
//
// ⚠️ That is the one deliberate departure from the Tariffs page this tab
// otherwise copies. Selecting 495 rows one at a time into a right-hand form is
// the part create dialog with extra steps, and the create dialog is precisely
// the door that is shut for every part that already exists (§0).
//
// Three things live here, in the order somebody actually needs them:
//
//   1. ONE opening date for the whole run. `openStockBalance` takes
//      `occurredAt` per part, but an opening balance is one event on one date,
//      and exposing it per row invites 495 dates for it.
//   2. The per-account RECONCILIATION. The sum of every opening balance IS the
//      opening inventory on the balance sheet, and the split by account is
//      literally the opening journal entry - nobody can check the run without
//      it. This block keeps the account NAME spelled out; the list's narrow
//      column is the one that shows just the number. Beside each counted total
//      it shows the `accounting.opening*` baseline that owns the same row, the
//      difference between them, and the action that proposes one from the other.
//   3. The readiness line: how many parts are in the run, and how many are
//      held back, counted per reason with the reason's own sentence as a
//      tooltip.
//
// ⚠️ The bulk "set kind" is NOT here any more. It is an ActionBar over the
// list's selection, next to the rows being classified.
//
// 🛑 The Open button sits behind a confirm that says ONCE, because it is.
// `stock_movement_gl_account` is `updatable: false`, so a part opened in the
// wrong account is corrected only by REVERSING the movement and writing
// another, which leaves two rows in an append-only ledger forever (§6.3).

import { FieldType } from '@auxx/database/enums'
import { normalizeCalendarDayIso } from '@auxx/lib/field-values/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { PlayCircle, Scale } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { formatQuantity } from '~/components/purchasing/purchasing-summary-strip'
import { useConfirm } from '~/hooks/use-confirm'
import type {
  OpeningStockAccountTotal,
  OpeningStockBaseline,
  OpeningStockExclusion,
  OpeningStockExclusionReason,
  OpeningStockRunSummary,
} from '../../hooks/use-opening-stock'
import { PROPOSABLE_OPENING_ROLES } from '../../hooks/use-opening-stock'
import { inventoryAccountLabelForRole } from '../../parts/opening-stock-input'

/** Where the accounting cutoff is set, for the unset-cutoff note. */
const ACCOUNTING_GENERAL_HREF = '/app/accounting/settings/general'

/**
 * What each reason is called, and the rule behind it - the label goes in the
 * readiness line and the detail is that count's tooltip.
 *
 * A total `Record` over the closed reason union on purpose - a sixth reason
 * stops this file compiling rather than rendering as a raw slug.
 */
const EXCLUSION_COPY: Record<OpeningStockExclusionReason, { label: string; detail: string }> = {
  opened: {
    label: 'Already opened',
    detail: 'Opening happens once, and this part has had its.',
  },
  blocked: {
    label: 'Has other movements',
    detail: 'An opening after a receipt would be a hand-valued adjustment wearing its name.',
  },
  'kind-unconfirmed': {
    label: 'Kind not confirmed',
    detail: 'The kind decides the account, and the account is frozen on the movement.',
  },
  'no-quantity': {
    label: 'No quantity',
    detail: 'Nothing was on the shelf, or nobody has counted it yet.',
  },
  'no-cost': {
    label: 'No unit cost',
    detail: 'An opening balance IS a valuation, so a quantity with no cost is refused.',
  },
}

/**
 * The one-line reason Work in Process is never a row here.
 *
 * 🛑 This exists so nobody hunts for a missing derivation. Two of the three
 * inventory roles are reachable from `part_kind` and `inventory_wip` is not
 * (`postings/build-entry.ts`), so a reconciliation that silently listed two
 * accounts out of three would read as a bug in the grouping.
 */
const WIP_NOTE =
  'Work in Process (1320) is never a line here, and nothing is missing: no part kind resolves ' +
  'to it, and a build writes its consume and produce legs in one step, so material moves from ' +
  'raw materials to finished goods without resting in 1320.'

interface OpeningStockRunProps {
  accountTotals: OpeningStockAccountTotal[]
  /** Minor units. */
  totalExtended: number
  /** What the run counts per proposable role. Minor units, `0` for an empty role. */
  countedByRole: Record<string, number>
  /** `accounting.opening*` per role. `null` is UNSET, and it is not zero. */
  openingBaseline: OpeningStockBaseline
  /** Writes the counted totals into the two derivable baseline settings. */
  onProposeBaseline: () => Promise<void>
  isProposingBaseline: boolean
  /** Exactly what the run will write. */
  entryCount: number
  exclusions: OpeningStockExclusion[]
  currencyCode: string
  /** `YYYY-MM`, or `null` when nobody has set one. */
  cutoffPeriod: string | null
  /** The last day of {@link cutoffPeriod}, or `null` when it is unset or malformed. */
  cutoffDate: string | null
  occurredAt: string
  onOccurredAtChange: (next: string) => void
  canOpenStock: boolean
  isRunning: boolean
  onRun: () => Promise<OpeningStockRunSummary>
}

export function OpeningStockRun({
  accountTotals,
  totalExtended,
  countedByRole,
  openingBaseline,
  onProposeBaseline,
  isProposingBaseline,
  entryCount,
  exclusions,
  currencyCode,
  cutoffPeriod,
  cutoffDate,
  occurredAt,
  onOccurredAtChange,
  canOpenStock,
  isRunning,
  onRun,
}: OpeningStockRunProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [lastRun, setLastRun] = useState<OpeningStockRunSummary | null>(null)

  const handleRun = async () => {
    const confirmed = await confirm({
      title: `Open stock for ${entryCount} ${entryCount === 1 ? 'part' : 'parts'}?`,
      description:
        `This writes one opening movement per part, dated ${formatDay(occurredAt)}, totalling ` +
        `${formatCurrency(totalExtended, { currencyCode })}. It happens ONCE: a stock movement is ` +
        'append-only and the inventory account is frozen on it at write time, so a part opened ' +
        'against the wrong account is corrected only by reversing the movement and writing ' +
        'another. Parts that already have movements are refused rather than doubled.',
      confirmText: 'Open stock',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    try {
      setLastRun(await onRun())
    } catch (error) {
      toastError({
        title: 'Error opening stock',
        description:
          error instanceof Error ? error.message : 'Could not write the opening balances.',
      })
    }
  }

  /**
   * Propose the counted totals as the opening baseline.
   *
   * 🛑 Behind a confirm that NAMES BOTH AMOUNTS, because these settings freeze
   * the moment a ledger entry stands on them: after that a correction is a
   * reversal and a re-entry, never an edit to the baseline.
   *
   * 🛑 The freeze itself is not pre-empted here.
   * `setting.batchUpdateOrganizationSettings` already calls
   * `assertAccountingSetupUnfrozen`, so a second guess in the browser could only
   * disagree with the server. Its refusal names the reversal path, and that
   * sentence is what the toast carries.
   */
  const handlePropose = async () => {
    const confirmed = await confirm({
      title: 'Use the counted totals as the opening baseline?',
      description:
        `${proposalSentence(countedByRole, currencyCode)} Those two settings own the inventory ` +
        'rows of the opening trial balance and are what the first month-end close measures its ' +
        'delta from. They FREEZE once a ledger entry stands on them, and after that a ' +
        'correction is a reversal and a re-entry, never an edit. Work in Process is not ' +
        'written: no part kind resolves to it.',
      confirmText: 'Use these totals',
      cancelText: 'Cancel',
      destructive: false,
    })
    if (!confirmed) return

    try {
      await onProposeBaseline()
    } catch (error) {
      toastError({
        title: 'Error setting the opening baseline',
        description:
          error instanceof Error ? error.message : 'Could not write the opening baseline.',
      })
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <div className='flex flex-col gap-4'>
          {/* ── 1. The date ─────────────────────────────────────────────── */}
          <section className='flex flex-col gap-1.5'>
            <h3 className='font-medium text-foreground text-sm'>Opening date</h3>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              value={occurredAt}
              onChange={(value) => {
                if (typeof value === 'string' && value) onOccurredAtChange(value)
              }}
              disabled={isRunning}
            />
            {cutoffDate ? (
              <p className='text-muted-foreground text-xs'>
                The last day of the accounting cutoff ({cutoffPeriod}), which is the day before the
                first month auxx.ai values. One date for the whole run, not one per part.
              </p>
            ) : (
              // 🛑 Never a silent default to today. The opening date IS the
              // `accounting.cutoffPeriod` decision (§3), and a run dated today
              // against a cutoff chosen later is uncorrectable.
              <Alert variant='warning'>
                <AlertDescription>
                  {cutoffPeriod
                    ? `The accounting cutoff reads "${cutoffPeriod}", which is not a YYYY-MM month, so this date is today's.`
                    : "The accounting cutoff is not set, so this date is today's."}{' '}
                  Opening balances belong on the day before the first month auxx.ai values.{' '}
                  <Link className='underline' href={ACCOUNTING_GENERAL_HREF}>
                    Set the cutoff on Accounting &gt; General
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            )}
          </section>

          <Separator />

          {/* ── 2. The opening journal entry, reconciled ────────────────── */}
          <OpeningInventoryReconciliation
            accountTotals={accountTotals}
            totalExtended={totalExtended}
            countedByRole={countedByRole}
            openingBaseline={openingBaseline}
            entryCount={entryCount}
            currencyCode={currencyCode}
            isProposing={isProposingBaseline}
            onPropose={handlePropose}
          />

          <Separator />

          {/* ── 3. What is in the run, and what is not ──────────────────── */}
          <RunReadiness entryCount={entryCount} exclusions={exclusions} />
        </div>
      </ScrollArea>

      <div className='mt-3 flex shrink-0 flex-col gap-1.5 border-t pt-3'>
        {/* ⚠️ The three numbers side by side, never as a fraction. The run
            never throws for a part: an already-opened part is EXCLUDED (opening
            is once, and that is correct), while a failure is somebody's to look
            at - and collapsing the two would hide the second behind the first. */}
        {lastRun && !isRunning && (
          <p className='text-muted-foreground text-xs'>
            Opened {lastRun.opened.length} of {lastRun.requested}
            {lastRun.excluded.length > 0 && `, ${lastRun.excluded.length} already had movements`}
            {lastRun.failed.length > 0 && `, ${lastRun.failed.length} failed`}.
          </p>
        )}
        <Button
          variant='outline'
          size='sm'
          className='self-end'
          disabled={!canOpenStock || entryCount === 0}
          loading={isRunning}
          loadingText='Opening...'
          onClick={() => void handleRun()}>
          <PlayCircle />
          Open stock for {entryCount} {entryCount === 1 ? 'part' : 'parts'}
        </Button>
        {!canOpenStock && (
          <p className='self-end text-muted-foreground text-xs'>
            You do not have edit access to stock movements.
          </p>
        )}
      </div>

      <ConfirmDialog />
    </div>
  )
}

/** One account's line of the reconciliation. */
interface ReconciliationLine {
  role: string
  /** `1310 Raw Materials / Parts`. */
  account: string
  parts: number
  units: number
  /** What the typed rows sum to, minor units. */
  counted: number
  /** `accounting.opening*`, minor units, or `null` when nobody has set one. */
  baseline: number | null
}

/**
 * The lines to render, over the two DERIVABLE roles rather than over the
 * accounts that happen to have typed rows.
 *
 * ⚠️ A role with a baseline and no counted rows is still a line. That is exactly
 * the disagreement the finalize gate refuses on - a baseline claiming $50,000 of
 * finished goods that no part accounts for - and grouping only by what somebody
 * typed would hide the one case a person most needs to see.
 *
 * A role that is neither counted nor baselined is omitted, so an untouched page
 * shows the empty-state sentence rather than a grid of zeros.
 *
 * The trailing loop covers an account somebody's rows landed in that is NOT a
 * proposable role. There is none today; it is there so a fourth part kind cannot
 * drop silently out of the opening journal entry.
 */
function buildReconciliation(
  accountTotals: OpeningStockAccountTotal[],
  countedByRole: Record<string, number>,
  openingBaseline: OpeningStockBaseline
): ReconciliationLine[] {
  const byRole = new Map(accountTotals.map((total) => [total.role, total]))
  const lines: ReconciliationLine[] = []

  for (const role of PROPOSABLE_OPENING_ROLES) {
    const total = byRole.get(role)
    const baseline = openingBaseline[role] ?? null
    const counted = countedByRole[role] ?? 0
    if (!total && baseline === null && counted === 0) continue
    lines.push({
      role,
      account: total?.account ?? inventoryAccountLabelForRole(role),
      parts: total?.parts ?? 0,
      units: total?.units ?? 0,
      counted,
      baseline,
    })
  }

  for (const total of accountTotals) {
    if (lines.some((line) => line.role === total.role)) continue
    lines.push({
      role: total.role,
      account: total.account,
      parts: total.parts,
      units: total.units,
      counted: total.extended,
      baseline: openingBaseline[total.role] ?? null,
    })
  }

  return lines
}

/**
 * Section 2: the opening journal entry beside the baseline that owns the same
 * three rows, the difference between them, and the action that proposes one from
 * the other.
 *
 * 🛑 **The count is the INPUT to the baseline, not a check against it.** The
 * baseline is "the frozen December 31 physical count, valued at CPA-approved
 * costs" (`postings/opening-baseline.ts`), and this page is where that count is
 * entered. So with no baseline set the panel shows no difference and no zero -
 * it says the totals will become it. A difference against an unset setting would
 * be a difference against a number nobody supplied.
 */
function OpeningInventoryReconciliation({
  accountTotals,
  totalExtended,
  countedByRole,
  openingBaseline,
  entryCount,
  currencyCode,
  isProposing,
  onPropose,
}: {
  accountTotals: OpeningStockAccountTotal[]
  totalExtended: number
  countedByRole: Record<string, number>
  openingBaseline: OpeningStockBaseline
  entryCount: number
  currencyCode: string
  isProposing: boolean
  onPropose: () => Promise<void>
}) {
  const lines = buildReconciliation(accountTotals, countedByRole, openingBaseline)
  const anyBaseline = lines.some((line) => line.baseline !== null)
  const anyDifference = lines.some(
    (line) => line.baseline !== null && line.baseline !== line.counted
  )
  // The total's difference is only shown when EVERY line has a baseline. A
  // partial sum compared against the full count is a number that means nothing.
  const baselineTotal =
    lines.length > 0 && lines.every((line) => line.baseline !== null)
      ? lines.reduce((sum, line) => sum + (line.baseline ?? 0), 0)
      : null

  return (
    <section className='flex flex-col gap-1.5'>
      <h3 className='font-medium text-foreground text-sm'>Opening inventory</h3>
      <p className='text-muted-foreground text-xs'>
        The sum of every opening balance, by the inventory account each part's kind resolves to.
        This is the opening journal entry, and it is what the opening baseline is meant to say.
      </p>

      {lines.length === 0 ? (
        <p className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
          Nothing is in the run yet. Type a quantity against a part on the left.
        </p>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow className='hover:bg-transparent'>
                  <TableHead className='min-w-[140px] text-muted-foreground'>Account</TableHead>
                  <TableHead className='text-right text-muted-foreground'>Counted</TableHead>
                  <TableHead className='text-right text-muted-foreground'>Baseline</TableHead>
                  <TableHead className='text-right text-muted-foreground'>Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.role} className='hover:bg-transparent'>
                    <TableCell className='align-top text-xs'>
                      <span className='block'>{line.account}</span>
                      <span className='block text-[11px] text-muted-foreground'>
                        {line.parts} {line.parts === 1 ? 'part' : 'parts'}
                        {' · '}
                        {formatQuantity(line.units)} units
                      </span>
                    </TableCell>
                    <TableCell className='align-top text-right text-xs tabular-nums'>
                      {formatCurrency(line.counted, { currencyCode })}
                    </TableCell>
                    <TableCell className='align-top text-right text-xs tabular-nums'>
                      {line.baseline === null ? (
                        <span className='text-muted-foreground'>Not set</span>
                      ) : (
                        formatCurrency(line.baseline, { currencyCode })
                      )}
                    </TableCell>
                    <TableCell className='align-top text-right text-xs tabular-nums'>
                      {line.baseline !== null && (
                        <Difference
                          counted={line.counted}
                          baseline={line.baseline}
                          currencyCode={currencyCode}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className='hover:bg-transparent'>
                  <TableCell className='align-top font-medium text-xs'>
                    Total
                    <span className='block font-normal text-[11px] text-muted-foreground'>
                      {entryCount} {entryCount === 1 ? 'part' : 'parts'} in the run
                    </span>
                  </TableCell>
                  <TableCell className='align-top text-right font-medium text-sm tabular-nums'>
                    {formatCurrency(totalExtended, { currencyCode })}
                  </TableCell>
                  <TableCell className='align-top text-right text-xs tabular-nums'>
                    {baselineTotal !== null && formatCurrency(baselineTotal, { currencyCode })}
                  </TableCell>
                  <TableCell className='align-top text-right text-xs tabular-nums'>
                    {baselineTotal !== null && (
                      <Difference
                        counted={totalExtended}
                        baseline={baselineTotal}
                        currencyCode={currencyCode}
                      />
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {!anyBaseline && (
            <p className='text-muted-foreground text-xs'>
              No opening baseline is set yet, so there is nothing to differ from: these totals will
              become it. The baseline is the frozen cutoff physical count, valued at approved costs,
              and this run is that count.
            </p>
          )}

          {/* ⚠️ States what a difference IS and makes no claim about what it
              prevents, because it prevents nothing. The close does not compare
              these two numbers: the baseline REPLACES pre-cutoff subledger
              history (`gather-month-end-inventory.ts` - at cutover "the opening
              baseline stands in", and the close's window starts after the
              cutoff), so a difference here reaches no journal entry and lands in
              no COGS plug. An earlier pass gated finalize on this and it was
              removed; do not describe it as a blocker. */}
          {anyDifference && (
            <p className='text-muted-foreground text-xs'>
              Counted does not match the baseline. Worth resolving - either the baseline figure or
              the count is the one to correct - but nothing is blocked by it: the opening baseline
              is what the balance sheet carries, and the first close measures its delta from that
              rather than from these movements.
            </p>
          )}
        </>
      )}

      <p className='text-muted-foreground text-xs'>{WIP_NOTE}</p>

      <div className='flex flex-col items-end gap-1'>
        <Button
          variant='outline'
          size='sm'
          disabled={totalExtended === 0}
          loading={isProposing}
          loadingText='Setting the baseline...'
          onClick={() => void onPropose()}>
          <Scale />
          Use totals as the baseline
        </Button>
        {totalExtended === 0 && (
          <p className='text-muted-foreground text-xs'>
            Nothing is counted yet, so there is no total to propose.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * `$2,700 unaccounted`, `$400 over baseline`, or `Matches`.
 *
 * Signed against the BASELINE, because that is the direction a person repairs
 * in: the baseline is the number the CPA signed off, so a short count means
 * inventory nothing on this page can name a part for.
 */
function Difference({
  counted,
  baseline,
  currencyCode,
}: {
  counted: number
  baseline: number
  currencyCode: string
}) {
  const delta = counted - baseline
  if (delta === 0) return <span className='text-muted-foreground'>Matches</span>
  return (
    <span className='text-amber-600 dark:text-amber-500'>
      {formatCurrency(Math.abs(delta), { currencyCode })}{' '}
      {delta < 0 ? 'unaccounted' : 'over baseline'}
    </span>
  )
}

/**
 * `1310 Raw Materials / Parts becomes $47,300.00, and 1330 Finished Goods
 * becomes $0.00.`
 *
 * ⚠️ BOTH amounts, always, including a zero. The propose action writes both
 * derivable settings, and a confirm that named only the non-zero one would hide
 * half of what it is about to freeze.
 */
function proposalSentence(countedByRole: Record<string, number>, currencyCode: string): string {
  const parts = PROPOSABLE_OPENING_ROLES.map(
    (role) =>
      `${inventoryAccountLabelForRole(role)} becomes ` +
      `${formatCurrency(countedByRole[role] ?? 0, { currencyCode })}`
  )
  return `${parts.join(', and ')}.`
}

/**
 * Every reason in {@link EXCLUSION_COPY} except `no-quantity`, in the order
 * they are declared there - the reasons the readiness line can report.
 *
 * 🛑 `no-quantity` is NEVER counted. Before anybody has typed anything, every
 * part in the org is held back for it, and "493 held back" on an untouched page
 * reports the form's resting state as a problem.
 */
const HELD_BACK_REASONS = (Object.keys(EXCLUSION_COPY) as OpeningStockExclusionReason[]).filter(
  (reason) => reason !== 'no-quantity'
)

/**
 * `34 parts ready · 6 held back (3 kind not confirmed, 3 no unit cost)`.
 *
 * 🛑 This replaced a per-part excluded table, deliberately. Every reason that
 * table listed is already ON the row in the left list - the Opened badge, the
 * Blocked badge, the suggestion sparkle, an empty quantity cell, an empty cost
 * cell - so with 495 parts it was a restatement of the checklist without its
 * record badges, repeating one sentence hundreds of times. 44 §7.2b's
 * per-row-evidence rule is for runs whose set is COMPUTED (the backfill and
 * post-fulfillment dialogs, where the block is the only way to learn why
 * something was skipped); here the set is exactly what somebody typed.
 *
 * The rule sentence still shows, once per reason, as that count's tooltip.
 */
function RunReadiness({
  entryCount,
  exclusions,
}: {
  entryCount: number
  exclusions: OpeningStockExclusion[]
}) {
  const counts = new Map<OpeningStockExclusionReason, number>()
  for (const exclusion of exclusions) {
    counts.set(exclusion.reason, (counts.get(exclusion.reason) ?? 0) + 1)
  }
  const held = HELD_BACK_REASONS.filter((reason) => (counts.get(reason) ?? 0) > 0)
  const heldTotal = held.reduce((sum, reason) => sum + (counts.get(reason) ?? 0), 0)

  return (
    <p className='text-muted-foreground text-xs'>
      <span className='font-medium text-foreground'>
        {entryCount} {entryCount === 1 ? 'part' : 'parts'} ready
      </span>
      {heldTotal > 0 && (
        <>
          {' · '}
          {heldTotal} held back (
          {held.map((reason, index) => (
            <Fragment key={reason}>
              {index > 0 && ', '}
              <Tooltip content={EXCLUSION_COPY[reason].detail}>
                <span className='cursor-default underline decoration-dotted'>
                  {counts.get(reason)} {EXCLUSION_COPY[reason].label.toLowerCase()}
                </span>
              </Tooltip>
            </Fragment>
          ))}
          )
        </>
      )}
    </p>
  )
}

/**
 * `2026-06-30`, from whatever ISO shape the date input handed back.
 *
 * Through `normalizeCalendarDayIso` rather than `new Date(...).toISOString()`,
 * so the day the confirm names is the day the run is dated - truncating an
 * instant is off by one for every reader east of UTC.
 */
function formatDay(iso: string): string {
  return normalizeCalendarDayIso(iso)?.slice(0, 10) ?? iso
}
