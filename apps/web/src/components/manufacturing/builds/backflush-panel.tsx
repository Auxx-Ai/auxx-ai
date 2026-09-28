// apps/web/src/components/manufacturing/builds/backflush-panel.tsx
'use client'

import type { BackflushPlanSummary } from '@auxx/lib/inventory/builds/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import Link from 'next/link'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { stockSetupHref } from '~/components/manufacturing/stock-setup/stock-setup-href'
import { api } from '~/trpc/react'
import { BackflushRunPanel, isBackflushRunLive } from './backflush-run-panel'
import { useBackflushRunRealtime } from './use-backflush-run-realtime'

type KindConflict = BackflushPlanSummary['kindConflicts'][number]

/** What the host needs to draw its own confirm (the dialog puts it in its footer). */
export interface BackflushPanelControls {
  runId: string | null
  canConfirm: boolean
  isStarting: boolean
  confirm: () => Promise<void>
}

interface BackflushPanelProps {
  /** Off while a host dialog is closed, so nothing is read in the background. */
  enabled?: boolean
  /** Draws the confirm; absent, the panel draws its own button under the preview. */
  actions?: (controls: BackflushPanelControls) => ReactNode
  /** Called once when the followed run completes or fails. */
  onFinished?: () => void
}

/** A day key as "16 Jul 2021"; UTC so the day never shifts in the viewer's zone. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function conflictLine(conflict: KindConflict): string {
  if (conflict.reason === 'component_with_bom') {
    return 'Has its own parts list, but marked Component.'
  }
  const names = conflict.usedIn.map((p) => p.partName ?? p.partId)
  const usedIn =
    names.length > 3
      ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      : names.join(', ')
  return `Used inside ${usedIn || 'another part'}, but marked Finished Good.`
}

/** Preview and run of an org-wide backflush over the server's range (plans/mrp/17 §5.2). */
export function BackflushPanel({ enabled = true, actions, onFinished }: BackflushPanelProps) {
  const utils = api.useUtils()
  // The run shown: one this panel started, or a live one found on open.
  const [runId, setRunId] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) setRunId(null)
  }, [enabled])

  const run = api.builds.getBackflushRun.useQuery(runId ? { runId } : {}, {
    enabled,
    // Safety net under the realtime frames while the run is live.
    refetchInterval: (query) => (isBackflushRunLive(query.state.data) ? 3000 : false),
  })
  useEffect(() => {
    if (!runId && isBackflushRunLive(run.data)) setRunId(run.data?.runId ?? null)
  }, [runId, run.data])
  useBackflushRunRealtime(runId)
  const shownRun = runId && run.data?.runId === runId ? run.data : null
  const busy = !!runId || run.isPending

  const finishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!shownRun || isBackflushRunLive(shownRun) || finishedRef.current === shownRun.runId) return
    finishedRef.current = shownRun.runId
    void utils.builds.previewBackflush.invalidate()
    void utils.builds.hasBackflushBuilds.invalidate()
    onFinished?.()
  }, [shownRun, onFinished, utils])

  // A full-history replay: never refetched in the background.
  const preview = api.builds.previewBackflush.useQuery(
    {},
    { enabled: enabled && !busy, staleTime: 60_000, refetchOnWindowFocus: false }
  )
  const runBackflush = api.builds.runBackflush.useMutation({
    onError: (error) =>
      toastError({ title: 'Recording past builds did not start', description: error.message }),
  })

  const parts = preview.data?.parts ?? []
  const buildCount = preview.data?.buildCount ?? 0
  const conflicts = preview.data?.kindConflicts ?? []
  const canConfirm = !preview.isPending && buildCount > 0 && conflicts.length === 0 && !busy

  const confirm = async () => {
    try {
      const started = await runBackflush.mutateAsync({})
      setRunId(started.runId)
    } catch {
      // Surfaced by the mutation's onError.
    }
  }
  const controls: BackflushPanelControls = {
    runId,
    canConfirm,
    isStarting: runBackflush.isPending,
    confirm,
  }

  const body = runId ? (
    shownRun ? (
      <BackflushRunPanel run={shownRun} />
    ) : (
      <Skeleton className='h-16 w-full' />
    )
  ) : busy || preview.isPending ? (
    <Skeleton className='h-16 w-full' />
  ) : preview.isError ? (
    <Alert variant='destructive'>
      <AlertDescription>{preview.error.message}</AlertDescription>
    </Alert>
  ) : (
    <div className='flex flex-col gap-2'>
      {conflicts.length > 0 && (
        <Alert variant='destructive' data-testid='backflush-kind-conflicts'>
          <AlertDescription>
            <p>
              {conflicts.length === 1
                ? "1 part's kind doesn't match its parts list."
                : `${conflicts.length} parts' kinds don't match their parts lists.`}{' '}
              Fix these in{' '}
              <Link href={stockSetupHref('kinds')} className='underline'>
                Check parts
              </Link>{' '}
              first.
            </p>
            <ul className='mt-1 flex flex-col gap-0.5'>
              {conflicts.slice(0, 10).map((conflict) => (
                <li key={conflict.partId}>
                  <span className='font-medium'>{conflict.partName ?? conflict.partId}</span>:{' '}
                  {conflictLine(conflict)}
                </li>
              ))}
              {conflicts.length > 10 && <li>…and {conflicts.length - 10} more.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <p className='text-sm' data-testid='backflush-summary'>
        {buildCount === 0 ? (
          'All past sales are covered: no made part ends a day below zero.'
        ) : (
          <>
            We'll record <span className='font-medium'>{buildCount.toLocaleString()}</span>{' '}
            {buildCount === 1 ? 'build' : 'builds'} for{' '}
            <span className='font-medium'>{parts.length.toLocaleString()}</span>{' '}
            {parts.length === 1 ? 'product' : 'products'}
            {preview.data ? ` from ${formatDay(preview.data.range.from)} to yesterday` : ''}, so
            their parts are used up on the right days.
          </>
        )}
      </p>
      {buildCount > 0 && (
        <p className='text-muted-foreground text-xs'>Uses today's parts list for every past day.</p>
      )}
      {parts.length > 0 && (
        <div className='max-h-56 overflow-y-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='text-muted-foreground'>Part</TableHead>
                <TableHead className='text-right text-muted-foreground'>Builds</TableHead>
                <TableHead className='text-right text-muted-foreground'>Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((row) => (
                <TableRow key={row.partId} className='hover:bg-transparent'>
                  <TableCell className='text-xs'>{row.partName ?? row.partId}</TableCell>
                  <TableCell className='text-right text-xs tabular-nums'>
                    {row.builds.toLocaleString()}
                  </TableCell>
                  <TableCell className='text-right text-xs tabular-nums'>
                    {row.units.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {(preview.data?.failedDays.length ?? 0) > 0 && (
        <p className='text-muted-foreground text-xs'>
          {preview.data?.failedDays.length} {preview.data?.failedDays.length === 1 ? 'day' : 'days'}{' '}
          could not be read and will be skipped.
        </p>
      )}
    </div>
  )

  return (
    <div className='flex flex-col gap-3'>
      {body}
      {actions
        ? actions(controls)
        : !runId && (
            <div className='flex justify-end'>
              <Button
                variant='outline'
                size='sm'
                disabled={!canConfirm}
                loading={runBackflush.isPending}
                loadingText='Starting...'
                onClick={() => void confirm()}>
                Record past builds
              </Button>
            </div>
          )}
    </div>
  )
}
