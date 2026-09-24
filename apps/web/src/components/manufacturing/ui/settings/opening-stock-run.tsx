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
//      column is the one that shows just the number.
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
import { PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { formatQuantity } from '~/components/purchasing/purchasing-summary-strip'
import { useConfirm } from '~/hooks/use-confirm'
import type {
  OpeningStockAccountTotal,
  OpeningStockExclusion,
  OpeningStockExclusionReason,
  OpeningStockRunSummary,
} from '../../hooks/use-opening-stock'

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
            entryCount={entryCount}
            currencyCode={currencyCode}
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

/**
 * Section 2: the opening inventory the run writes, by the account each part's kind
 * resolves to. The ledger's side is the opening entry; any gap between the two is
 * posted once as an adjustment after cutover (plans/accounting/tasks/103 §5a).
 */
function OpeningInventoryReconciliation({
  accountTotals,
  totalExtended,
  entryCount,
  currencyCode,
}: {
  accountTotals: OpeningStockAccountTotal[]
  totalExtended: number
  entryCount: number
  currencyCode: string
}) {
  return (
    <section className='flex flex-col gap-1.5'>
      <h3 className='font-medium text-foreground text-sm'>Opening inventory</h3>
      <p className='text-muted-foreground text-xs'>
        The sum of every opening balance, by the inventory account each part's kind resolves to.
        Where it differs from the opening balances in your books, setup posts the difference once,
        the day after the cutover.
      </p>

      {accountTotals.length === 0 ? (
        <p className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
          Nothing is in the run yet. Type a quantity against a part on the left.
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='min-w-[140px] text-muted-foreground'>Account</TableHead>
                <TableHead className='text-right text-muted-foreground'>Counted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountTotals.map((total) => (
                <TableRow key={total.role} className='hover:bg-transparent'>
                  <TableCell className='align-top text-xs'>
                    <span className='block'>{total.account}</span>
                    <span className='block text-[11px] text-muted-foreground'>
                      {total.parts} {total.parts === 1 ? 'part' : 'parts'}
                      {' · '}
                      {formatQuantity(total.units)} units
                    </span>
                  </TableCell>
                  <TableCell className='align-top text-right text-xs tabular-nums'>
                    {formatCurrency(total.extended, { currencyCode })}
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
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <p className='text-muted-foreground text-xs'>{WIP_NOTE}</p>
    </section>
  )
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
