// apps/web/src/components/dispatch/ui/route-planner/apply-times-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { createDateWithTime } from '~/components/pickers/date-time-picker/utils'
import { useRoutePlannerMutations, visitDurationMinutes } from './hooks/use-route-planner-mutations'
import type { PlannerDayWindow, PlannerVisit, PlannerWorker, RouteGeometry } from './types'

export interface ApplyTimesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worker: PlannerWorker
  /** The worker's ordered day stops — caller (the sidebar's `routes-group.tsx`) has already excluded
   * `'done'`/`'canceled'` visits (they never get a new time from the planner). */
  stops: PlannerVisit[]
  geometry: RouteGeometry | undefined
  date: PlannerDayWindow
}

interface PreviewRow {
  visit: PlannerVisit
  durationMinutes: number
  isDefaultDuration: boolean
  startTime: Date
  endTime: Date
}

/** Same chain the server runs (build contract item 12) — `departure_0 = firstDeparture`;
 * `arrival_i = departure_{i-1} + legSeconds_i`; `startTime_i = arrival_i`;
 * `endTime_i = startTime_i + durationMinutes_i`; `departure_i = endTime_i`. Mirrored here purely
 * for the read-only preview; the actual write recomputes it server-side from the same
 * Directions cache (`applyRouteTimes`, `packages/lib/src/dispatch/route-planner/apply-times.ts`). */
function buildPreview(
  firstDeparture: Date,
  stops: PlannerVisit[],
  geometry: RouteGeometry | undefined
): PreviewRow[] {
  const legSecondsByVisitId = new Map(
    (geometry?.legs ?? []).map((leg) => [leg.toVisitId, leg.seconds])
  )
  let departure = firstDeparture
  const rows: PreviewRow[] = []
  for (const visit of stops) {
    const legSeconds = legSecondsByVisitId.get(visit.id) ?? 0
    const startTime = new Date(departure.getTime() + legSeconds * 1000)
    const durationMinutes = visitDurationMinutes(visit)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)
    rows.push({
      visit,
      durationMinutes,
      isDefaultDuration: !(visit.startTime && visit.endTime),
      startTime,
      endTime,
    })
    departure = endTime
  }
  return rows
}

function parseClockValue(clock: string): [number, number] {
  const [h, m] = clock.split(':').map(Number)
  return [Number.isFinite(h) ? (h as number) : 8, Number.isFinite(m) ? (m as number) : 0]
}

/**
 * "Apply times to schedule" (design doc §E/§F, decision #1/#9; seam contract's
 * `ApplyTimesDialog`) — the only planner surface that writes `startTime`/`endTime`. Single-page
 * `Dialog` + `FieldPanel` (no `DialogNav` — this is a one-step confirm, not a multi-page flow).
 */
export function ApplyTimesDialog({
  open,
  onOpenChange,
  worker,
  stops,
  geometry,
  date,
}: ApplyTimesDialogProps) {
  const { applyRouteTimes } = useRoutePlannerMutations(date)
  const [firstDepartureClock, setFirstDepartureClock] = useState(
    worker.availabilityStart ?? '08:00'
  )

  // Re-seed the default first-departure every time the dialog opens (worker availability may
  // have changed since the last open).
  useEffect(() => {
    if (open) setFirstDepartureClock(worker.availabilityStart ?? '08:00')
  }, [open, worker.availabilityStart])

  const activeStops = useMemo(
    () => stops.filter((v) => v.status !== 'done' && v.status !== 'canceled'),
    [stops]
  )

  const firstDeparture = useMemo(() => {
    const [hours, minutes] = parseClockValue(firstDepartureClock)
    return createDateWithTime(date.from, hours, minutes)
  }, [firstDepartureClock, date.from])

  const preview = useMemo(
    () => buildPreview(firstDeparture, activeStops, geometry),
    [firstDeparture, activeStops, geometry]
  )

  const handleConfirm = () => {
    if (activeStops.length === 0) return
    applyRouteTimes.mutate(
      {
        assigneeUserId: worker.userId,
        dateKey: date.dateKey,
        firstDeparture,
        stops: activeStops.map((v) => ({
          visitId: v.id,
          durationMinutes: visitDurationMinutes(v),
        })),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) =>
          toastError({ title: 'Error applying times', description: error.message }),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Apply times to schedule</DialogTitle>
          <DialogDescription>
            Writes each stop's start/end time from the current route order and drive-time estimate —
            the plan itself (stop order) doesn't change.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel className='p-0' breakpoint='md'>
          <FieldPanelRow title='First departure' description='Defaults to worker availability'>
            <Input
              type='time'
              value={firstDepartureClock}
              onChange={(e) => setFirstDepartureClock(e.target.value)}
              className='w-32'
            />
          </FieldPanelRow>
        </FieldPanel>

        <div className='max-h-72 space-y-1 overflow-y-auto rounded-md border p-2'>
          {preview.length === 0 ? (
            <p className='text-muted-foreground px-1 py-2 text-xs'>No active stops to apply.</p>
          ) : (
            preview.map((row, index) => (
              <div key={row.visit.id} className='flex items-center gap-2 text-xs'>
                <span className='text-muted-foreground w-5 shrink-0'>{index + 1}.</span>
                <span className='min-w-0 flex-1 truncate'>Stop {index + 1}</span>
                <span className='shrink-0'>
                  {format(row.startTime, 'p')}–{format(row.endTime, 'p')}
                </span>
                {row.isDefaultDuration && (
                  <span className='text-muted-foreground shrink-0'>(1h default)</span>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            loading={applyRouteTimes.isPending}
            disabled={activeStops.length === 0}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
