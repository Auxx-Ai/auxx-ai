// apps/web/src/components/manufacturing/builds/backflush-dialog.tsx
'use client'

// The D24 confirm (111 §4) and the run it starts (plans/mrp/11 §5).

import { FieldType } from '@auxx/database/enums'
import { calendarDayKey, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
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
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { BackflushRunPanel, isBackflushRunLive } from './backflush-run-panel'
import { useBackflushRunRealtime } from './use-backflush-run-realtime'

/** When no caller knows the earliest sale, the range starts this many days before yesterday. */
const DEFAULT_LOOKBACK_DAYS = 90

export interface BackflushDialogRange {
  /** The earliest sale, when the caller knows it. */
  from?: Date | null
  /** Defaults to yesterday. */
  to?: Date | null
  /** Named in the title when the confirm was opened for one part. */
  partName?: string
}

interface BackflushDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  range?: BackflushDialogRange
}

function yesterday(): Date {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return date
}

function daysBefore(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() - days)
  return out
}

export function BackflushDialog({ open, onOpenChange, range }: BackflushDialogProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // The run this dialog shows: one it started, or a live one found on open.
  const [runId, setRunId] = useState<string | null>(null)

  // Reset on every open: a dialog never carries a stale range into a fresh open.
  useEffect(() => {
    if (!open) return
    const end = range?.to ?? yesterday()
    setFrom(toCalendarDayIso(range?.from ?? daysBefore(end, DEFAULT_LOOKBACK_DAYS)))
    setTo(toCalendarDayIso(end))
    setRunId(null)
  }, [open, range?.from, range?.to])

  const run = api.builds.getBackflushRun.useQuery(runId ? { runId } : {}, {
    enabled: open,
    // Safety net under the realtime frames while the run is live.
    refetchInterval: (query) => (isBackflushRunLive(query.state.data) ? 3000 : false),
  })
  useEffect(() => {
    if (!runId && isBackflushRunLive(run.data)) setRunId(run.data?.runId ?? null)
  }, [runId, run.data])
  useBackflushRunRealtime(runId)
  const shownRun = runId && run.data?.runId === runId ? run.data : null
  const busy = !!runId || run.isPending

  // Days, not instants: the server walks them in the book zone.
  const fromDay = calendarDayKey(from)
  const toDay = calendarDayKey(to)
  const valid = !!fromDay && !!toDay && fromDay <= toDay

  const preview = api.builds.previewBackflush.useQuery(
    { from: fromDay ?? '', to: toDay ?? '' },
    { enabled: open && valid && !busy }
  )
  const runBackflush = api.builds.runBackflush.useMutation({
    onError: (error) =>
      toastError({ title: 'The backflush did not start', description: error.message }),
  })

  const parts = preview.data?.parts ?? []
  const buildCount = preview.data?.buildCount ?? 0
  const canConfirm = valid && !preview.isPending && buildCount > 0 && !busy

  const handleConfirm = async () => {
    if (!fromDay || !toDay) return
    try {
      const started = await runBackflush.mutateAsync({ from: fromDay, to: toDay })
      setRunId(started.runId)
    } catch {
      // Surfaced by the mutation's onError.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle>
            {range?.partName
              ? `Backflush past sales for ${range.partName}`
              : 'Backflush past sales'}
          </DialogTitle>
          <DialogDescription>
            For every day a made part's ledger ends below zero, one completed build for the
            shortfall, dated that day. Sales before the accounting cutover move stock and post
            nothing.
          </DialogDescription>
        </DialogHeader>

        {!runId && (
          <FieldPanel
            className='p-0'
            orientation='responsive'
            breakpoint='md'
            resizeId='backflush-dialog'
            defaultLabelWidth={120}>
            <FieldPanelRow title='From' type={BaseType.DATE} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                value={from}
                onChange={(value) => {
                  if (typeof value === 'string' && value) setFrom(value)
                }}
                disabled={runBackflush.isPending}
              />
            </FieldPanelRow>
            <FieldPanelRow title='To' type={BaseType.DATE} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                value={to}
                onChange={(value) => {
                  if (typeof value === 'string' && value) setTo(value)
                }}
                disabled={runBackflush.isPending}
              />
            </FieldPanelRow>
          </FieldPanel>
        )}

        {runId ? (
          shownRun ? (
            <BackflushRunPanel run={shownRun} />
          ) : (
            <Skeleton className='h-16 w-full' />
          )
        ) : !valid ? (
          <p className='text-muted-foreground text-xs'>
            The range must start on or before its end.
          </p>
        ) : busy || preview.isPending ? (
          <Skeleton className='h-16 w-full' />
        ) : preview.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className='flex flex-col gap-2'>
            <p className='text-sm' data-testid='backflush-summary'>
              {buildCount === 0 ? (
                'Nothing to build in this range: no made part ends a day below zero.'
              ) : (
                <>
                  Would write <span className='font-medium'>{buildCount.toLocaleString()}</span>{' '}
                  {buildCount === 1 ? 'build' : 'builds'} across{' '}
                  <span className='font-medium'>{parts.length}</span>{' '}
                  {parts.length === 1 ? 'part' : 'parts'} (
                  {(preview.data?.unitCount ?? 0).toLocaleString()} units over{' '}
                  {(preview.data?.dayCount ?? 0).toLocaleString()} days).
                </>
              )}
            </p>
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
                {preview.data?.failedDays.length}{' '}
                {preview.data?.failedDays.length === 1 ? 'day' : 'days'} could not be read and will
                be skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={runBackflush.isPending}>
            {runId ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {!runId && (
            <Button
              variant='outline'
              size='sm'
              disabled={!canConfirm}
              loading={runBackflush.isPending}
              loadingText='Starting...'
              onClick={() => void handleConfirm()}
              data-dialog-submit>
              Backflush <KbdSubmit variant='outline' size='sm' />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
