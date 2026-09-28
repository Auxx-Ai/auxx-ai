// apps/web/src/components/manufacturing/builds/undo-backflush-panel.tsx
'use client'

import type { UndoBackflushRun } from '@auxx/lib/inventory/builds/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Progress } from '@auxx/ui/components/progress'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2, Loader2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useUndoBackflushRunRealtime } from './use-undo-backflush-run-realtime'

/** An undo run is live until it completes or fails. */
export function isUndoBackflushRunLive(run: UndoBackflushRun | null | undefined): boolean {
  return run?.status === 'PENDING' || run?.status === 'IN_PROGRESS'
}

/**
 * Follow one undo run: the one `setRunId` names, or a live one found on open that `adopt`
 * accepts. Calls `onFinished` once when the followed run completes or fails.
 */
export function useUndoBackflushRun(options: {
  /** Off for a viewer without the ledger permission, whom the read would refuse. */
  enabled?: boolean
  adopt?: (run: UndoBackflushRun) => boolean
  onFinished?: (run: UndoBackflushRun) => void
}) {
  const [runId, setRunId] = useState<string | null>(null)
  const query = api.builds.getUndoBackflushRun.useQuery(runId ? { runId } : {}, {
    enabled: options.enabled ?? true,
    refetchInterval: (q) => (isUndoBackflushRunLive(q.state.data) ? 3000 : false),
  })
  const { adopt, onFinished } = options

  useEffect(() => {
    const data = query.data
    if (!runId && data && isUndoBackflushRunLive(data) && (adopt?.(data) ?? true)) {
      setRunId(data.runId)
    }
  }, [runId, query.data, adopt])
  useUndoBackflushRunRealtime(runId)

  const run = runId && query.data?.runId === runId ? query.data : null
  const finishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!run || isUndoBackflushRunLive(run) || finishedRef.current === run.runId) return
    finishedRef.current = run.runId
    onFinished?.(run)
  }, [run, onFinished])

  return { runId, setRunId, run, isPending: query.isPending }
}

/** Progress and outcome of one undo run. */
export function UndoBackflushRunProgress({ run }: { run: UndoBackflushRun }) {
  const percent = run.total > 0 ? Math.min(100, Math.round((run.processed / run.total) * 100)) : 0

  return (
    <div className='flex flex-col gap-2' data-testid='undo-backflush-run'>
      {isUndoBackflushRunLive(run) && (
        <>
          <div className='flex items-center gap-2 text-muted-foreground text-sm'>
            <Loader2 className='size-4 animate-spin' />
            <span>
              {run.status === 'PENDING'
                ? 'Queued on the worker…'
                : `${Math.min(run.processed, run.total).toLocaleString()} of ${run.total.toLocaleString()} builds undone`}
            </span>
          </div>
          <Progress value={percent} />
        </>
      )}

      {run.status === 'COMPLETED' && (
        <div className='flex items-center gap-2 text-sm'>
          <CheckCircle2 className='size-4 text-emerald-600' />
          <span>
            Done: {run.reversed.toLocaleString()} reversed
            {run.cancelled > 0 && `, ${run.cancelled.toLocaleString()} cancelled`}
            {run.failed > 0 && `, ${run.failed.toLocaleString()} failed`}.
          </span>
        </div>
      )}

      {run.status === 'FAILED' && (
        <Alert variant='destructive'>
          <AlertDescription>
            The undo stopped after {run.processed.toLocaleString()} of {run.total.toLocaleString()}{' '}
            builds: {run.error ?? 'unknown error'}. Builds already undone stay undone; starting
            again picks up the rest.
          </AlertDescription>
        </Alert>
      )}

      {run.failures.length > 0 && (
        <ul className='max-h-32 overflow-y-auto rounded-md border p-2 text-muted-foreground text-xs'>
          {run.failures.map((failure) => (
            <li key={failure.buildId}>
              Run {failure.runNumber}: {failure.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface UndoBackflushPanelProps {
  /** Called from "Record past builds" once the undo finished; the host shows the backflush. */
  onDone?: () => void
}

/** Undo every past build backflush recorded, then hand back to record them again (17 §5.2). */
export function UndoBackflushPanel({ onDone }: UndoBackflushPanelProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const drift = api.builds.backflushKindDrift.useQuery()
  const { run, runId, setRunId, isPending } = useUndoBackflushRun({
    adopt: (live) => live.scope === 'backflush',
    onFinished: () => {
      void utils.builds.backflushKindDrift.invalidate()
      void utils.builds.previewBackflush.invalidate()
    },
  })
  const start = api.builds.startUndoBackflush.useMutation({
    onError: (error) =>
      toastError({ title: 'Undoing past builds did not start', description: error.message }),
  })

  const driftCount = drift.data?.partCount ?? 0

  const handleUndo = async () => {
    const confirmed = await confirm({
      title: 'Undo every past build?',
      description:
        'Every build recorded by backflush is reversed with movements dated today, then you ' +
        'record them again. Nothing is deleted, and closed months stay exactly as posted.',
      confirmText: 'Undo past builds',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const started = await start.mutateAsync({})
      setRunId(started.runId)
    } catch {
      // Surfaced by the mutation's onError.
    }
  }

  if (runId && !run) return <Skeleton className='h-16 w-full' />

  return (
    <div className='flex flex-col gap-3' data-testid='undo-backflush-panel'>
      <ConfirmDialog />
      <p className='text-sm'>
        Undo every past build recorded by backflush, then record them again.
      </p>
      {driftCount > 0 && (
        <p className='text-sm text-muted-foreground' data-testid='undo-backflush-drift'>
          Past builds were recorded before{' '}
          {driftCount === 1 ? "1 part's kind" : `${driftCount} parts' kinds`} changed.
        </p>
      )}

      {run ? (
        <>
          <UndoBackflushRunProgress run={run} />
          {run.status === 'COMPLETED' && (
            <div>
              <Button size='sm' onClick={() => onDone?.()}>
                Record past builds
              </Button>
            </div>
          )}
          {run.status === 'FAILED' && (
            <div>
              <Button
                variant='outline'
                size='sm'
                loading={start.isPending}
                loadingText='Starting…'
                onClick={handleUndo}>
                <Undo2 />
                Try again
              </Button>
            </div>
          )}
        </>
      ) : (
        <div>
          <Button
            variant='outline'
            size='sm'
            className='text-destructive'
            disabled={isPending}
            loading={start.isPending}
            loadingText='Starting…'
            onClick={handleUndo}>
            <Undo2 />
            Undo past builds
          </Button>
        </div>
      )}
    </div>
  )
}
