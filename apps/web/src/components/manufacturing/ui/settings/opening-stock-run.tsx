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
import { CheckCircle2, PanelRightClose, PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { booksStartDate } from '~/components/accounting/books-start'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { OpeningStockRunResult } from '../../hooks/use-opening-stock'

/** The explicit, repeatable books-versus-parts screen (111 Q19/Q23). */
export const OPENING_DIFFERENCE_HREF = '/app/accounting/settings/opening?s=inventory'

export interface OpeningStockRunSummaryCounts {
  firstCounts: number
  /** Counts on parts counted before: the difference is written on the count day. */
  adjustments: number
  /** Counts on parts with no cost yet: valued once one is set. */
  pending: number
  /** Counts on parts whose kind step 1 still flags (plans/mrp/22 F3). */
  kindWarnings: number
  /** Made parts in the run whose sales no build covers yet. */
  unbuilt: { title: string; unbuiltSales: number }[]
}

interface OpeningStockRunProps {
  entryCount: number
  summary: OpeningStockRunSummaryCounts
  /** `YYYY-MM`, or `null` when nobody has set one. */
  cutoffPeriod: string | null
  occurredAt: string
  onOccurredAtChange: (next: string) => void
  canOpenStock: boolean
  isRunning: boolean
  onRun: () => Promise<OpeningStockRunResult | null>
  /** Throws away every typed count not saved yet. */
  onClearDrafts: () => void
  /** Desktop only: hide the pane; absent in the mobile drawer, which has its own close. */
  onCollapse?: () => void
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** `40 first counts · 3 corrections`, dropping the zeros. */
export function runSummaryLine(summary: OpeningStockRunSummaryCounts): string {
  return [
    summary.firstCounts > 0 && plural(summary.firstCounts, 'first count', 'first counts'),
    summary.adjustments > 0 && plural(summary.adjustments, 'correction', 'corrections'),
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

/** "today", or "on 26 Sep 2026", for a calendar-day ISO. */
function countDayLabel(day: string): string {
  const key = day.slice(0, 10)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (key === today) return 'today'
  const date = new Date(`${key}T00:00:00`)
  return `on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export function OpeningStockRun({
  entryCount,
  summary,
  cutoffPeriod,
  occurredAt,
  onOccurredAtChange,
  canOpenStock,
  isRunning,
  onRun,
  onClearDrafts,
  onCollapse,
}: OpeningStockRunProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [lastRun, setLastRun] = useState<OpeningStockRunResult | null>(null)
  const [editingDate, setEditingDate] = useState(false)
  const line = runSummaryLine(summary)
  const warning = unbuiltWarning(summary.unbuilt)
  const kindLine =
    summary.kindWarnings > 0
      ? `${plural(summary.kindWarnings, 'part has', 'parts have')} a kind Check parts still flags; ${summary.kindWarnings === 1 ? 'its count is' : 'their counts are'} filed under the kind ${summary.kindWarnings === 1 ? 'it has' : 'they have'} now.`
      : null

  const handleRun = async () => {
    const confirmed = await confirm({
      title: `Save ${plural(entryCount, 'part', 'parts')}?`,
      description: [
        `${line}.`,
        "Counts can't be edited later; a wrong one is fixed by counting again.",
        kindLine,
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
            <div className='flex items-center justify-between gap-2'>
              <h3 className='font-medium text-foreground text-sm'>Count date</h3>
              {onCollapse && (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='Hide this panel'
                  onClick={onCollapse}>
                  <PanelRightClose />
                </Button>
              )}
            </div>
            {editingDate ? (
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                value={occurredAt}
                onChange={(value) => {
                  if (typeof value === 'string' && value) onOccurredAtChange(value)
                }}
                disabled={isRunning}
              />
            ) : (
              <div className='flex items-center gap-1 text-sm'>
                <span>Counted {countDayLabel(occurredAt)}</span>
                <Button
                  variant='ghost'
                  size='xs'
                  disabled={isRunning}
                  onClick={() => setEditingDate(true)}>
                  Change
                </Button>
              </div>
            )}
            <p className='text-muted-foreground text-xs'>
              The day you looked at the shelf, for every part in this save.{' '}
              {cutoffPeriod
                ? `Counts before ${booksStartDate(cutoffPeriod)} post nothing; later ones post the difference to Inventory Count Variance.`
                : 'Nothing posts to the books until accounting is set up; the count still sets your stock.'}
            </p>
          </section>

          <Separator />

          <section className='flex flex-col gap-1.5'>
            <h3 className='font-medium text-foreground text-sm'>What gets saved</h3>
            {entryCount === 0 ? (
              <p className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
                Nothing to save yet. Type a count against a part on the left.
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
                {kindLine && <p>{kindLine}</p>}
                {warning && <p>{warning}</p>}
                <p>
                  Typed counts stay in this browser until you save.{' '}
                  <Button
                    variant='link'
                    size='xs'
                    className='h-auto p-0 text-xs'
                    disabled={isRunning}
                    onClick={onClearDrafts}>
                    Clear them
                  </Button>
                </p>
              </div>
            )}
          </section>

          <Separator />

          <DoneCounting cutoffPeriod={cutoffPeriod} />
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

/** "15 of 231 counted. The 216 others keep …", out of the stocked parts that moved. */
export function doneCountingLine(counts: {
  movedPartCount: number
  countedPartCount: number
  uncostedPartCount: number
}): string {
  const others = counts.movedPartCount - counts.countedPartCount
  return [
    `${counts.countedPartCount.toLocaleString('en-US')} of ${counts.movedPartCount.toLocaleString('en-US')} counted.`,
    others > 0 &&
      `The ${others.toLocaleString('en-US')} ${others === 1 ? 'other keeps its' : 'others keep their'} current numbers; you can count them any time.`,
    counts.uncostedPartCount > 0 &&
      `${counts.uncostedPartCount.toLocaleString('en-US')} of the ${counts.movedPartCount.toLocaleString('en-US')} ${counts.uncostedPartCount === 1 ? 'has' : 'have'} no cost.`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Q2: one org flag ends the first count; parts left uncounted keep their numbers. */
function DoneCounting({ cutoffPeriod }: { cutoffPeriod: string | null }) {
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
  const setDone = (value: boolean) => setFlag.mutate({ flag: 'countingDone', value })

  return (
    <section className='flex flex-col gap-1.5'>
      <h3 className='font-medium text-foreground text-sm'>Done counting</h3>
      {status.data && (
        <p className='text-muted-foreground text-xs'>{doneCountingLine(status.data)}</p>
      )}
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
  const first = run.opened.filter((row) => row.outcome === 'initial').length
  const corrections = run.opened.length - first
  const unchanged = run.excluded.filter((skip) => skip.reason === 'unchanged').length
  const failed = run.failed
  const parts = [
    first > 0 && plural(first, 'first count', 'first counts'),
    corrections > 0 && plural(corrections, 'correction', 'corrections'),
    unchanged > 0 && `${unchanged.toLocaleString('en-US')} unchanged`,
    failed.length > 0 && `${failed.length.toLocaleString('en-US')} failed`,
  ].filter(Boolean)
  return (
    <div className='flex flex-col gap-1 text-muted-foreground text-xs'>
      <p>
        Saved: {parts.length > 0 ? parts.join(' · ') : 'nothing'}.
        {cutoffPeriod && run.opened.length > 0 && (
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

/** `2026-06-30` from whatever ISO shape the date input handed back. */
export function formatDay(iso: string): string {
  return normalizeCalendarDayIso(iso)?.slice(0, 10) ?? iso
}
