// apps/web/src/components/evals/ui/eval-suite-diff-card.tsx
'use client'

import type { SuiteDiffEntry, SuiteDiffSummary } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import { Spinner } from '@auxx/ui/components/spinner'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, GitCompareArrows } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

/**
 * Verdict-diff card (phase 5D.3): bucket chips headline + expandable per-case
 * rows. Rendered wherever a suite has a comparable baseline — suite detail,
 * iteration history. The judge-noise caption keeps single response-criteria
 * flips honest. Gating lives in `utils/loop-logic.ts` (`canShowSuiteDiff`).
 */

const BUCKET_LABELS: Record<string, { label: string; className: string }> = {
  fixed: { label: 'fixed', className: 'text-green-600' },
  regressed: { label: 'regressed', className: 'text-red-600' },
  still_failing: { label: 'still failing', className: 'text-amber-600' },
  still_passing: { label: 'still passing', className: 'text-muted-foreground' },
}

interface EvalSuiteDiffCardProps {
  baselineSuiteRunId: string
  candidateSuiteRunId: string
  /** Drill a per-case row's run into the run-detail view. */
  onOpenRun?: (runId: string) => void
  className?: string
}

export function EvalSuiteDiffCard({
  baselineSuiteRunId,
  candidateSuiteRunId,
  onOpenRun,
  className,
}: EvalSuiteDiffCardProps) {
  const [expanded, setExpanded] = useState(false)
  const diffQuery = api.eval.compareSuiteRuns.useQuery({
    baselineSuiteRunId,
    candidateSuiteRunId,
  })

  if (diffQuery.isLoading) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border p-2.5 text-xs', className)}>
        <Spinner className='size-3.5 text-muted-foreground' />
        <span className='text-muted-foreground'>Comparing suite runs…</span>
      </div>
    )
  }
  const diff = diffQuery.data
  if (!diff) return null

  const sideEntries = diff.entries.filter(
    (e) => e.bucket === 'uncompared' || e.bucket === 'incomparable'
  )
  const mainEntries = diff.entries.filter(
    (e) => e.bucket !== 'uncompared' && e.bucket !== 'incomparable'
  )

  return (
    <div className={cn('rounded-lg border text-xs', className)}>
      <button
        type='button'
        className='flex w-full items-center gap-2 p-2.5 text-left'
        onClick={() => setExpanded((e) => !e)}>
        <GitCompareArrows className='size-3.5 shrink-0 text-muted-foreground' />
        <span className='flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5'>
          <DiffHeadline diff={diff} />
        </span>
        {expanded ? (
          <ChevronDown className='size-3.5 text-muted-foreground' />
        ) : (
          <ChevronRight className='size-3.5 text-muted-foreground' />
        )}
      </button>

      {diff.judgeOnlyFlips > 0 && (
        <p className='border-t px-2.5 py-1.5 text-[11px] text-muted-foreground'>
          {diff.judgeOnlyFlips} change{diff.judgeOnlyFlips === 1 ? ' is' : 's are'} judge-graded
          only — may be noise; re-run to confirm.
        </p>
      )}

      {expanded && (
        <div className='border-t'>
          {mainEntries.map((entry) => (
            <DiffEntryRow key={entryKey(entry)} entry={entry} onOpenRun={onOpenRun} />
          ))}
          {sideEntries.length > 0 && (
            <div className='border-t bg-muted/30 px-2.5 py-1.5'>
              <p className='mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                Not compared
              </p>
              {sideEntries.map((entry) => (
                <p key={entryKey(entry)} className='text-[11px] text-muted-foreground'>
                  {entry.caseName || 'Deleted case'} —{' '}
                  {entry.bucket === 'uncompared'
                    ? 'present in one suite only'
                    : 'errored or cancelled'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function entryKey(entry: SuiteDiffEntry): string {
  return entry.caseId || entry.baseline?.runId || entry.candidate?.runId || entry.caseName
}

function DiffHeadline({ diff }: { diff: SuiteDiffSummary }) {
  const parts = (['fixed', 'regressed', 'still_failing'] as const)
    .map((bucket) => ({ bucket, count: diff.counts[bucket] }))
    .filter(({ bucket, count }) => count > 0 || bucket !== 'still_failing')
  return (
    <>
      {parts.map(({ bucket, count }) => (
        <span
          key={bucket}
          className={cn(
            'font-medium',
            count > 0 ? BUCKET_LABELS[bucket]?.className : 'text-muted-foreground'
          )}>
          {count} {BUCKET_LABELS[bucket]?.label}
        </span>
      ))}
      {diff.passRateDelta != null && (
        <span className='text-muted-foreground'>
          ({diff.passRateDelta >= 0 ? '+' : ''}
          {Math.round(diff.passRateDelta * 100)}% pass rate)
        </span>
      )}
    </>
  )
}

function DiffEntryRow({
  entry,
  onOpenRun,
}: {
  entry: SuiteDiffEntry
  onOpenRun?: (runId: string) => void
}) {
  const bucket = BUCKET_LABELS[entry.bucket]
  const targetRunId = entry.candidate?.runId ?? entry.baseline?.runId
  return (
    <div className='flex items-start gap-2 border-b px-2.5 py-1.5 last:border-b-0'>
      <span className={cn('w-20 shrink-0 font-medium', bucket?.className)}>{bucket?.label}</span>
      <div className='min-w-0 flex-1'>
        {targetRunId && onOpenRun ? (
          <button
            type='button'
            className='truncate text-left font-medium text-foreground underline-offset-2 hover:underline'
            onClick={() => onOpenRun(targetRunId)}>
            {entry.caseName || 'Deleted case'}
          </button>
        ) : (
          <span className='truncate font-medium'>{entry.caseName || 'Deleted case'}</span>
        )}
        {entry.assertionFlips?.map((flip) => (
          <p key={flip.assertionId} className='text-[11px] text-muted-foreground'>
            {flip.type}: {flip.from} → {flip.to}
          </p>
        ))}
        {entry.flipDriver === 'judge' && (
          <p className='text-[11px] italic text-muted-foreground'>judge-graded flip</p>
        )}
      </div>
      {entry.baseline && entry.candidate && onOpenRun && (
        <Button
          variant='ghost'
          size='xs'
          className='shrink-0 text-muted-foreground'
          onClick={() => onOpenRun(entry.baseline!.runId)}>
          baseline
        </Button>
      )}
    </div>
  )
}
