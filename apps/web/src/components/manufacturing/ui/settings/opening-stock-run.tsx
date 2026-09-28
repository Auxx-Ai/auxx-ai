// apps/web/src/components/manufacturing/ui/settings/opening-stock-run.tsx
'use client'

// The run pane of Stock setup step 3 (plans/mrp/17 §5.3): the count date, what pressing the run
// writes, the result, and "Done counting". The books comparison lives on the difference screen.

import { FieldType } from '@auxx/database/enums'
import { normalizeCalendarDayIso } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2, PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type {
  OpeningStockCounts,
  OpeningStockExclusion,
  OpeningStockExclusionReason,
  OpeningStockRunResult,
} from '../../hooks/use-opening-stock'

/** The explicit, repeatable books-versus-parts screen (111 Q19/Q23). */
export const OPENING_DIFFERENCE_HREF = '/app/accounting/settings/opening?s=inventory'

const EXCLUSION_COPY: Record<OpeningStockExclusionReason, { label: string; detail: string }> = {
  'kind-unconfirmed': {
    label: 'Kind not confirmed',
    detail: "The kind decides which inventory account the part's stock sits in.",
  },
  'no-quantity': {
    label: 'No count',
    detail: 'Nobody has typed a count for this part yet.',
  },
}

export interface OpeningStockRunSummaryCounts {
  firstCounts: number
  /** Counts on parts counted before: the difference is written on the count day. */
  adjustments: number
  /** Parts getting their first cost, with or without a count. */
  firstCosts: number
  /** Counts on parts with no cost yet: valued once one is set. */
  pending: number
  /** Made parts in the run whose sales no build covers yet. */
  unbuilt: { title: string; unbuiltSales: number }[]
}

interface OpeningStockRunProps {
  entryCount: number
  summary: OpeningStockRunSummaryCounts
  exclusions: OpeningStockExclusion[]
  counts: OpeningStockCounts
  /** `YYYY-MM`, or `null` when nobody has set one. */
  cutoffPeriod: string | null
  occurredAt: string
  onOccurredAtChange: (next: string) => void
  canOpenStock: boolean
  isRunning: boolean
  onRun: () => Promise<OpeningStockRunResult>
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** `40 first counts · 3 corrections · 25 first costs`, dropping the zeros. */
export function runSummaryLine(summary: OpeningStockRunSummaryCounts): string {
  return [
    summary.firstCounts > 0 && plural(summary.firstCounts, 'first count', 'first counts'),
    summary.adjustments > 0 && plural(summary.adjustments, 'correction', 'corrections'),
    summary.firstCosts > 0 && plural(summary.firstCosts, 'first cost', 'first costs'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** D5: counting a made part with unbuilt sales is allowed, but says what it gives up. */
export function unbuiltWarning(unbuilt: OpeningStockRunSummaryCounts['unbuilt']): string | null {
  if (unbuilt.length === 0) return null
  const who =
    unbuilt.length === 1
      ? `${unbuilt[0]!.title} has ${plural(unbuilt[0]!.unbuiltSales, 'unbuilt sale', 'unbuilt sales')}.`
      : `${unbuilt.length} parts have unbuilt sales.`
  return `${who} Counting now means backflush won't build them later.`
}

export function OpeningStockRun({
  entryCount,
  summary,
  exclusions,
  counts,
  cutoffPeriod,
  occurredAt,
  onOccurredAtChange,
  canOpenStock,
  isRunning,
  onRun,
}: OpeningStockRunProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [lastRun, setLastRun] = useState<OpeningStockRunResult | null>(null)
  const line = runSummaryLine(summary)
  const warning = unbuiltWarning(summary.unbuilt)

  const handleRun = async () => {
    const confirmed = await confirm({
      title: `Save ${plural(entryCount, 'part', 'parts')}?`,
      description: [
        `${line}.`,
        "Counts can't be edited later; a wrong one is fixed by counting again.",
        warning,
      ]
        .filter(Boolean)
        .join(' '),
      confirmText: 'Save',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    try {
      setLastRun(await onRun())
    } catch (error) {
      toastError({
        title: 'Error saving counts',
        description: error instanceof Error ? error.message : 'Could not save the counts.',
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
              Used by every part without a date of its own.{' '}
              {cutoffPeriod
                ? `Counts dated on or before your books start (${cutoffPeriod}) post nothing; later ones post the difference to Inventory Count Variance.`
                : 'Nothing posts to the books until accounting is set up; the count still sets your stock.'}
            </p>
          </section>

          <Separator />

          <section className='flex flex-col gap-1.5'>
            <h3 className='font-medium text-foreground text-sm'>What gets saved</h3>
            {entryCount === 0 ? (
              <p className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
                Nothing to save yet. Type a count or a first cost against a part on the left.
              </p>
            ) : (
              <div className='flex flex-col gap-1 text-muted-foreground text-xs'>
                <p data-testid='run-summary'>
                  <span className='font-medium text-foreground'>{line}.</span> Counts can't be
                  edited later; a wrong one is fixed by counting again.
                </p>
                {summary.pending > 0 && (
                  <p>
                    {plural(summary.pending, 'part has', 'parts have')} no cost yet: the count is
                    saved now and valued once a cost is set.
                  </p>
                )}
                {warning && <p>{warning}</p>}
              </div>
            )}
          </section>

          <Separator />

          <RunReadiness entryCount={entryCount} exclusions={exclusions} />

          <Separator />

          <DoneCounting counts={counts} cutoffPeriod={cutoffPeriod} />
        </div>
      </ScrollArea>

      <div className='mt-3 flex shrink-0 flex-col gap-1.5 border-t pt-3'>
        {lastRun && !isRunning && <RunResult run={lastRun} cutoffPeriod={cutoffPeriod} />}
        <Button
          variant='outline'
          size='sm'
          className='self-end'
          disabled={!canOpenStock || entryCount === 0}
          loading={isRunning}
          loadingText='Saving...'
          onClick={() => void handleRun()}>
          <PlayCircle />
          Save {plural(entryCount, 'part', 'parts')}
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

/** Q2: one org flag ends the first count; parts left uncounted keep their numbers. */
function DoneCounting({
  counts,
  cutoffPeriod,
}: {
  counts: OpeningStockCounts
  cutoffPeriod: string | null
}) {
  const utils = api.useUtils()
  const status = api.purchasing.stockSetupStatus.useQuery(undefined, { retry: false })
  const setFlag = api.purchasing.setStockSetupFlag.useMutation({
    onSuccess: () => {
      void utils.purchasing.stockSetupStatus.invalidate()
      void utils.gettingStarted.getStatus.invalidate()
    },
    onError: (error) =>
      toastError({ title: 'Error saving the counting state', description: error.message }),
  })
  const done = setFlag.isPending ? setFlag.variables.value : !!status.data?.countingDone
  const others = counts.all - counts.counted
  const setDone = (value: boolean) => setFlag.mutate({ flag: 'countingDone', value })

  return (
    <section className='flex flex-col gap-1.5'>
      <h3 className='font-medium text-foreground text-sm'>Done counting</h3>
      <p className='text-muted-foreground text-xs'>
        {counts.counted.toLocaleString('en-US')} of {counts.all.toLocaleString('en-US')} counted.
        {others > 0 &&
          ` The ${others.toLocaleString('en-US')} ${others === 1 ? 'other keeps its' : 'others keep their'} current numbers; you can count them any time.`}
        {counts.uncosted > 0 && ` ${plural(counts.uncosted, 'part', 'parts')} without a cost.`}
      </p>
      {done ? (
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          <span className='flex items-center gap-1 text-foreground'>
            <CheckCircle2 className='size-3.5 text-green-600' />
            Counting marked done.
          </span>
          {cutoffPeriod && (
            <Link className='text-muted-foreground underline' href={OPENING_DIFFERENCE_HREF}>
              Compare with your books
            </Link>
          )}
          <Button
            variant='ghost'
            size='xs'
            disabled={setFlag.isPending}
            onClick={() => setDone(false)}>
            Undo
          </Button>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='self-start'
          disabled={status.isPending}
          loading={setFlag.isPending}
          loadingText='Saving...'
          onClick={() => setDone(true)}>
          <CheckCircle2 />
          Done counting
        </Button>
      )}
    </section>
  )
}

/** Saved, unchanged and failed side by side, never as a fraction. */
function RunResult({
  run,
  cutoffPeriod,
}: {
  run: OpeningStockRunResult
  cutoffPeriod: string | null
}) {
  const saved = run.counts?.opened ?? []
  const first = saved.filter((row) => row.outcome === 'initial').length
  const corrections = saved.length - first
  const unchanged = (run.counts?.excluded ?? []).filter(
    (skip) => skip.reason === 'unchanged'
  ).length
  const countCosts = [...saved, ...(run.counts?.excluded ?? [])].filter(
    (row) => row.standardCostChange?.action === 'set'
  ).length
  const firstCosts = run.firstCosts + countCosts
  const failed = [
    ...(run.counts?.failed ?? []).map((skip) => ({ partId: skip.partId, detail: skip.detail })),
    ...run.costFailures,
  ]
  const parts = [
    first > 0 && plural(first, 'first count', 'first counts'),
    corrections > 0 && plural(corrections, 'correction', 'corrections'),
    firstCosts > 0 && plural(firstCosts, 'first cost', 'first costs'),
    unchanged > 0 && `${unchanged.toLocaleString('en-US')} unchanged`,
    failed.length > 0 && `${failed.length.toLocaleString('en-US')} failed`,
  ].filter(Boolean)
  return (
    <div className='flex flex-col gap-1 text-muted-foreground text-xs'>
      <p>
        Saved: {parts.length > 0 ? parts.join(' · ') : 'nothing'}.
        {cutoffPeriod && saved.length > 0 && (
          <>
            {' '}
            <Link className='underline' href={OPENING_DIFFERENCE_HREF}>
              Compare with your books
            </Link>
            .
          </>
        )}
      </p>
      {failed.length > 0 && (
        <ul className='flex flex-col gap-0.5'>
          {failed.slice(0, 5).map((skip) => (
            <li key={skip.partId} className='text-destructive'>
              {skip.detail}
            </li>
          ))}
          {failed.length > 5 && <li>…and {failed.length - 5} more.</li>}
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
