// apps/web/src/components/manufacturing/ui/settings/opening-stock-run.tsx
'use client'

// The right column of the Set counts tab (money 52 §2.3; 111 D21): THE RUN. The count date
// every row without its own follows, what the run writes, the readiness line, and the result.
// The books-versus-parts comparison lives on the server-read difference screen, linked below.

import { FieldType } from '@auxx/database/enums'
import { normalizeCalendarDayIso } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import type {
  OpeningStockExclusion,
  OpeningStockExclusionReason,
  OpeningStockRunSummary,
} from '../../hooks/use-opening-stock'

/** The explicit, repeatable books-versus-parts screen (111 Q19/Q23). */
export const OPENING_DIFFERENCE_HREF = '/app/accounting/settings/opening?s=inventory'

const EXCLUSION_COPY: Record<OpeningStockExclusionReason, { label: string; detail: string }> = {
  'kind-unconfirmed': {
    label: 'Kind not confirmed',
    detail: 'The kind decides the account, and the account is frozen on the movement.',
  },
  'no-quantity': {
    label: 'No count',
    detail: 'Nobody has typed a count for this part yet.',
  },
}

export interface OpeningStockRunSummaryCounts {
  firstCounts: number
  adjustments: number
  /** Rows on parts with no standard and no typed cost: written pending, valued later. */
  pending: number
  /** Rows whose typed unit cost replaces the part's standard and revalues what is on hand. */
  restates: number
  /** Rows the Q25 banner is warning about. */
  backflushFirst: number
}

interface OpeningStockRunProps {
  entryCount: number
  summary: OpeningStockRunSummaryCounts
  exclusions: OpeningStockExclusion[]
  /** `YYYY-MM`, or `null` when nobody has set one. */
  cutoffPeriod: string | null
  occurredAt: string
  onOccurredAtChange: (next: string) => void
  canOpenStock: boolean
  isRunning: boolean
  onRun: () => Promise<OpeningStockRunSummary>
  currencyCode: string
}

export function OpeningStockRun({
  entryCount,
  summary,
  exclusions,
  cutoffPeriod,
  occurredAt,
  onOccurredAtChange,
  canOpenStock,
  isRunning,
  onRun,
  currencyCode,
}: OpeningStockRunProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [lastRun, setLastRun] = useState<OpeningStockRunSummary | null>(null)
  const parts = (n: number) => `${n} ${n === 1 ? 'part' : 'parts'}`

  const handleRun = async () => {
    const confirmed = await confirm({
      title: `Set counts for ${parts(entryCount)}?`,
      description:
        `Writes one movement per part: ${summary.firstCounts} first ${summary.firstCounts === 1 ? 'count anchors' : 'counts anchor'} ` +
        `the part at its ledger start, ${summary.adjustments} ${summary.adjustments === 1 ? 'adjustment writes' : 'adjustments write'} ` +
        'the difference on the count day. Movements are append-only: a wrong count is corrected by counting again, never by editing.' +
        (summary.backflushFirst > 0
          ? ` ${parts(summary.backflushFirst)} still ${summary.backflushFirst === 1 ? 'has' : 'have'} unbuilt sales; counting them first hides those sales.`
          : ''),
      confirmText: 'Set counts',
      cancelText: 'Cancel',
      destructive: summary.backflushFirst > 0,
    })
    if (!confirmed) return

    try {
      setLastRun(await onRun())
    } catch (error) {
      toastError({
        title: 'Error setting counts',
        description: error instanceof Error ? error.message : 'Could not write the counts.',
      })
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <div className='flex flex-col gap-4'>
          <section className='flex flex-col gap-1.5'>
            <h3 className='font-medium text-foreground text-sm'>Count date</h3>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              value={occurredAt}
              onChange={(value) => {
                if (typeof value === 'string' && value) onOccurredAtChange(value)
              }}
              disabled={isRunning}
            />
            <p className='text-muted-foreground text-xs'>
              Fills every row that has no date of its own.{' '}
              {cutoffPeriod
                ? `A count dated on or before the accounting cutoff (${cutoffPeriod}) posts nothing — the opening covers it; one dated after posts the difference to Inventory Count Variance.`
                : 'Nothing posts until accounting is set up; the count still moves stock.'}
            </p>
          </section>

          <Separator />

          <section className='flex flex-col gap-1.5'>
            <h3 className='font-medium text-foreground text-sm'>What the run writes</h3>
            {entryCount === 0 ? (
              <p className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
                Nothing is in the run yet. Type a count against a part on the left.
              </p>
            ) : (
              <ul className='flex flex-col gap-1 text-muted-foreground text-xs'>
                <li>
                  <span className='font-medium text-foreground'>{summary.firstCounts}</span> first{' '}
                  {summary.firstCounts === 1 ? 'count' : 'counts'} — an initial dated at the ledger
                  start, so the replay reads the count on the count day.
                </li>
                <li>
                  <span className='font-medium text-foreground'>{summary.adjustments}</span>{' '}
                  {summary.adjustments === 1 ? 'adjustment' : 'adjustments'} — the difference, dated
                  the count day.
                </li>
                {summary.pending > 0 && (
                  <li>
                    <span className='font-medium text-foreground'>{summary.pending}</span> with no
                    standard cost — written now, valued when a cost is set.
                  </li>
                )}
                {summary.restates > 0 && (
                  <li>
                    <span className='font-medium text-foreground'>{summary.restates}</span>{' '}
                    {summary.restates === 1 ? 'replaces its' : 'replace their'} standard cost — what
                    is on hand is revalued at the new cost.
                  </li>
                )}
                {summary.backflushFirst > 0 && (
                  <li className='text-yellow-700 dark:text-yellow-500'>
                    <span className='font-medium'>{summary.backflushFirst}</span> with unbuilt sales
                    — backflush first, or the count hides them.
                  </li>
                )}
              </ul>
            )}
          </section>

          <Separator />

          <RunReadiness entryCount={entryCount} exclusions={exclusions} />
        </div>
      </ScrollArea>

      <div className='mt-3 flex shrink-0 flex-col gap-1.5 border-t pt-3'>
        {lastRun && !isRunning && (
          <RunResult run={lastRun} cutoffPeriod={cutoffPeriod} currencyCode={currencyCode} />
        )}
        <Button
          variant='outline'
          size='sm'
          className='self-end'
          disabled={!canOpenStock || entryCount === 0}
          loading={isRunning}
          loadingText='Counting...'
          onClick={() => void handleRun()}>
          <PlayCircle />
          Set counts for {parts(entryCount)}
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

/** The three numbers side by side, never as a fraction: excluded is correct, failed is somebody's. */
function RunResult({
  run,
  cutoffPeriod,
  currencyCode,
}: {
  run: OpeningStockRunSummary
  cutoffPeriod: string | null
  currencyCode: string
}) {
  const first = run.opened.filter((row) => row.outcome === 'initial').length
  const adjusts = run.opened.length - first
  const unchanged = run.excluded.filter((skip) => skip.reason === 'unchanged').length
  const changes = [...run.opened, ...run.excluded].flatMap((row) =>
    row.standardCostChange ? [row.standardCostChange] : []
  )
  const setCount = changes.filter((change) => change.action === 'set').length
  const restated = changes.length - setCount
  const revalued = changes.reduce((sum, change) => sum + change.revaluationPostedMinor, 0)
  return (
    <div className='flex flex-col gap-1 text-muted-foreground text-xs'>
      <p>
        Counted {run.opened.length} of {run.requested} ({first} first, {adjusts}{' '}
        {adjusts === 1 ? 'adjustment' : 'adjustments'}){unchanged > 0 && `, ${unchanged} unchanged`}
        {run.failed.length > 0 && `, ${run.failed.length} failed`}.
        {cutoffPeriod && (
          <>
            {' '}
            <Link className='underline' href={OPENING_DIFFERENCE_HREF}>
              Review the opening inventory difference
            </Link>
            .
          </>
        )}
      </p>
      {changes.length > 0 && (
        <p>
          Standard cost: {setCount > 0 && `${setCount} set`}
          {setCount > 0 && restated > 0 && ', '}
          {restated > 0 && `${restated} replaced`}
          {revalued !== 0 &&
            ` · revalued on hand ${revalued > 0 ? '+' : ''}${formatCurrency(revalued, { currencyCode })}`}
          .
        </p>
      )}
      {run.failed.length > 0 && (
        <ul className='flex flex-col gap-0.5'>
          {run.failed.slice(0, 5).map((skip) => (
            <li key={skip.partId} className='text-destructive'>
              {skip.detail}
            </li>
          ))}
          {run.failed.length > 5 && <li>…and {run.failed.length - 5} more.</li>}
        </ul>
      )}
    </div>
  )
}

const HELD_BACK_REASONS = (Object.keys(EXCLUSION_COPY) as OpeningStockExclusionReason[]).filter(
  // Before anybody types, every part is held back for this; counting it reports the resting state.
  (reason) => reason !== 'no-quantity'
)

/** `34 parts ready · 6 held back (6 kind not confirmed)`. */
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

/** `2026-06-30` from whatever ISO shape the date input handed back. */
export function formatDay(iso: string): string {
  return normalizeCalendarDayIso(iso)?.slice(0, 10) ?? iso
}
