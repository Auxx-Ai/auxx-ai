// apps/web/src/components/manufacturing/builds/backflush-run-panel.tsx
'use client'

import type { BackflushRun } from '@auxx/lib/inventory/builds/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Progress } from '@auxx/ui/components/progress'
import { CheckCircle2, ListFilter, Loader2 } from 'lucide-react'
import { useOpenBatchRun } from './use-open-batch-run'

/** A backflush run is live until it completes or fails. */
export function isBackflushRunLive(run: BackflushRun | null | undefined): boolean {
  return run?.status === 'PENDING' || run?.status === 'IN_PROGRESS'
}

export function BackflushRunPanel({ run }: { run: BackflushRun }) {
  const openBatchRun = useOpenBatchRun()
  const percent =
    run.totalDays > 0 ? Math.min(100, Math.round((run.processedDays / run.totalDays) * 100)) : 0

  return (
    <div className='flex flex-col gap-3' data-testid='backflush-run'>
      {isBackflushRunLive(run) && (
        <>
          <div className='flex items-center gap-2 text-muted-foreground text-sm'>
            <Loader2 className='size-4 animate-spin' />
            <span>
              {run.status === 'PENDING'
                ? 'Queued on the worker…'
                : `${run.processedDays.toLocaleString()} of ${run.totalDays.toLocaleString()} days walked`}
            </span>
          </div>
          <Progress value={percent} />
        </>
      )}

      {run.status === 'COMPLETED' && (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <CheckCircle2 className='size-4 text-emerald-600' />
          <span>Finished: {run.totalDays.toLocaleString()} days walked.</span>
        </div>
      )}

      {run.status === 'FAILED' && (
        <Alert variant='destructive'>
          <AlertDescription>
            The run stopped after {run.processedDays.toLocaleString()} of{' '}
            {run.totalDays.toLocaleString()} days: {run.error ?? 'unknown error'}. Builds already
            written stay in run {run.batchRun}; running the range again continues from where the
            ledger is.
          </AlertDescription>
        </Alert>
      )}

      <p className='text-sm' data-testid='backflush-run-counts'>
        <span className='font-medium'>{run.written.toLocaleString()}</span>{' '}
        {run.written === 1 ? 'build' : 'builds'} written
        {run.failed > 0 && (
          <>
            , <span className='font-medium text-destructive'>{run.failed.toLocaleString()}</span>{' '}
            failed
          </>
        )}{' '}
        ({run.from} to {run.to}).
      </p>

      {run.failures.length > 0 && (
        <ul className='max-h-32 overflow-y-auto rounded-md border p-2 text-muted-foreground text-xs'>
          {run.failures.map((failure, index) => (
            <li key={`${failure.day}-${index}`}>
              {failure.day}
              {failure.partName ? ` · ${failure.partName}` : ''}: {failure.reason}
            </li>
          ))}
        </ul>
      )}

      {run.status !== 'PENDING' && (
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='blue' size='xs'>
            Run {run.batchRun}
          </Badge>
          {run.written > 0 && (
            <Button
              variant='outline'
              size='xs'
              disabled={!openBatchRun}
              onClick={() => openBatchRun?.(run.batchRun)}>
              <ListFilter />
              Show the builds (undo from any build's run card)
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
