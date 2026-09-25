// apps/web/src/components/manufacturing/builds/backflush-dialog.tsx
'use client'

// The D24 confirm (111 §4): a date range, what a backflush over it would write, and the
// press that queues the run on the worker.

import { FieldType } from '@auxx/database/enums'
import { normalizeCalendarDayIso, toCalendarDayIso } from '@auxx/lib/field-values/client'
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
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

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

/** A calendar-day ISO string to the instant `previewBackflush` takes. */
function toInstant(day: string): Date | null {
  const normalized = normalizeCalendarDayIso(day)
  return normalized ? new Date(normalized) : null
}

export function BackflushDialog({ open, onOpenChange, range }: BackflushDialogProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [queued, setQueued] = useState(false)

  // Reset on every open: a dialog never carries a stale range into a fresh open.
  useEffect(() => {
    if (!open) return
    const end = range?.to ?? yesterday()
    setFrom(toCalendarDayIso(range?.from ?? daysBefore(end, DEFAULT_LOOKBACK_DAYS)))
    setTo(toCalendarDayIso(end))
    setQueued(false)
  }, [open, range?.from, range?.to])

  const fromDate = toInstant(from)
  const toDate = toInstant(to)
  const valid = !!fromDate && !!toDate && fromDate.getTime() <= toDate.getTime()

  const preview = api.builds.previewBackflush.useQuery(
    { from: fromDate ?? new Date(0), to: toDate ?? new Date(0) },
    { enabled: open && valid && !queued }
  )
  const runBackflush = api.builds.runBackflush.useMutation({
    onError: (error) =>
      toastError({ title: 'The backflush was not queued', description: error.message }),
  })

  const byPart = useMemo(() => {
    const map = new Map<string, { name: string; builds: number; units: number }>()
    for (const build of preview.data?.builds ?? []) {
      const row = map.get(build.partId) ?? {
        name: build.partName ?? build.partId,
        builds: 0,
        units: 0,
      }
      row.builds += 1
      row.units += build.quantity
      map.set(build.partId, row)
    }
    return [...map.values()].sort((a, b) => b.builds - a.builds)
  }, [preview.data])

  const buildCount = preview.data?.buildCount ?? 0
  const canConfirm = valid && !preview.isPending && buildCount > 0 && !queued

  const handleConfirm = async () => {
    if (!fromDate || !toDate) return
    try {
      await runBackflush.mutateAsync({ from: fromDate, to: toDate })
      setQueued(true)
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
              disabled={queued || runBackflush.isPending}
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
              disabled={queued || runBackflush.isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        {queued ? (
          <Alert variant='success'>
            <AlertDescription>
              Queued. The builds are written on the worker and appear on each part's movements as
              they complete.
            </AlertDescription>
          </Alert>
        ) : !valid ? (
          <p className='text-muted-foreground text-xs'>
            The range must start on or before its end.
          </p>
        ) : preview.isPending ? (
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
                  Would write <span className='font-medium'>{buildCount}</span>{' '}
                  {buildCount === 1 ? 'build' : 'builds'} across{' '}
                  <span className='font-medium'>{byPart.length}</span>{' '}
                  {byPart.length === 1 ? 'part' : 'parts'} ({preview.data?.unitCount ?? 0} units
                  over {preview.data?.days.length ?? 0} days).
                </>
              )}
            </p>
            {byPart.length > 0 && (
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
                    {byPart.map((row) => (
                      <TableRow key={row.name} className='hover:bg-transparent'>
                        <TableCell className='text-xs'>{row.name}</TableCell>
                        <TableCell className='text-right text-xs tabular-nums'>
                          {row.builds}
                        </TableCell>
                        <TableCell className='text-right text-xs tabular-nums'>
                          {row.units}
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
            {queued ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {!queued && (
            <Button
              variant='outline'
              size='sm'
              disabled={!canConfirm}
              loading={runBackflush.isPending}
              loadingText='Queuing...'
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
