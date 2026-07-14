// apps/web/src/components/dispatch/ui/route-planner/apply-times-dialog.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
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
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
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
  /** A confirmed stop (`timeConfirmedAt !== null` with existing times) — its row shows its
   * EXISTING times unchanged; the chain schedules provisional stops around it (plan 20 §4.4). */
  isAnchor: boolean
  /** Anchor only: the incoming computed arrival (previous departure + this stop's leg) is later
   * than the anchor's confirmed `startTime` — the plan can't actually make this promise. */
  conflict: boolean
  /** Anchor only: the computed arrival that produced `conflict`, for the "plan arrives X,
   * promised Y" message. */
  computedArrival: Date | null
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Mirrors the server's anchored chain (`applyRouteTimes`,
 * `packages/lib/src/dispatch/route-planner/apply-times.ts`, plan 20 §4.4): a stop with
 * `timeConfirmedAt !== null` and existing `startTime`/`endTime` is an ANCHOR — its row keeps its
 * existing times untouched and the next segment departs from its `endTime`. Every other
 * (provisional) stop chains normally: `arrival = departure + legSeconds`, `startTime = arrival`,
 * `endTime = startTime + durationMinutes`, `departure = endTime`. Read-only preview; the actual
 * write recomputes it server-side from the same Directions cache. */
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
    const isAnchor = visit.timeConfirmedAt !== null && !!visit.startTime && !!visit.endTime

    if (isAnchor) {
      const confirmedStart = toDate(visit.startTime as Date | string)
      const confirmedEnd = toDate(visit.endTime as Date | string)
      const computedArrival = new Date(departure.getTime() + legSeconds * 1000)
      rows.push({
        visit,
        durationMinutes: visitDurationMinutes(visit),
        isDefaultDuration: false,
        startTime: confirmedStart,
        endTime: confirmedEnd,
        isAnchor: true,
        conflict: computedArrival.getTime() > confirmedStart.getTime(),
        computedArrival,
      })
      departure = confirmedEnd
      continue
    }

    const startTime = new Date(departure.getTime() + legSeconds * 1000)
    const durationMinutes = visitDurationMinutes(visit)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)
    rows.push({
      visit,
      durationMinutes,
      isDefaultDuration:
        (visit.durationMinutes === null || visit.durationMinutes === undefined) &&
        !(visit.startTime && visit.endTime),
      startTime,
      endTime,
      isAnchor: false,
      conflict: false,
      computedArrival: null,
    })
    departure = endTime
  }
  return rows
}

function parseClockValue(clock: string): [number, number] {
  const [h, m] = clock.split(':').map(Number)
  return [Number.isFinite(h) ? (h as number) : 8, Number.isFinite(m) ? (m as number) : 0]
}

/** First-departure seed (plan 20 §3.2): when EVERY active stop already has a `startTime` (an
 * already-applied route), keep the day start the dispatcher previously chose — the earliest
 * `startTime` minus the first stop's leg seconds (no geometry loaded yet → just the earliest
 * `startTime`). Otherwise (a fresh or partially-applied plan) seed from the worker's availability
 * start (`HH:MM`, falling back to 08:00), stamped onto the planner day — `FieldType.TIME` stores
 * a full Date (ISO string), so the day portion has to come from `date.from`. */
function seedFirstDeparture(
  dayFrom: Date,
  availabilityStart: string | null | undefined,
  stops: PlannerVisit[],
  geometry: RouteGeometry | undefined
): Date {
  const allTimed = stops.length > 0 && stops.every((v) => v.startTime !== null)
  if (allTimed) {
    let earliestMs = Number.POSITIVE_INFINITY
    for (const visit of stops) {
      const ms = toDate(visit.startTime as Date | string).getTime()
      if (ms < earliestMs) earliestMs = ms
    }
    const firstStop = stops[0]!
    const legSeconds =
      (geometry?.legs ?? []).find((leg) => leg.toVisitId === firstStop.id)?.seconds ?? 0
    return new Date(earliestMs - legSeconds * 1000)
  }
  const [hours, minutes] = parseClockValue(availabilityStart ?? '08:00')
  return createDateWithTime(dayFrom, hours, minutes)
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

  const activeStops = useMemo(
    () => stops.filter((v) => v.status !== 'done' && v.status !== 'canceled'),
    [stops]
  )

  const [firstDeparture, setFirstDeparture] = useState(() =>
    seedFirstDeparture(date.from, worker.availabilityStart, activeStops, geometry)
  )

  // Re-seed the default first-departure every time the dialog opens (worker availability, stop
  // times, or geometry may have changed since the last open) — intentionally NOT re-seeding on
  // every activeStops/geometry change while open, so it doesn't stomp a first-departure edit the
  // dispatcher is mid-way through.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed only when the dialog opens, not on every activeStops/geometry update
  useEffect(() => {
    if (open) {
      setFirstDeparture(
        seedFirstDeparture(date.from, worker.availabilityStart, activeStops, geometry)
      )
    }
  }, [open, worker.availabilityStart, date.from])

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
        visitIds: activeStops.map((v) => v.id),
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
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Apply times to schedule</DialogTitle>
          <DialogDescription>
            Writes each stop's start/end time from the current route order and drive-time estimate —
            the plan itself (stop order) doesn't change. Stops with a confirmed time are locked and
            scheduled around.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <FieldPanel className='p-0' breakpoint='md'>
            <FieldPanelRow title='First departure' description='Defaults to worker availability'>
              <FieldInputAdapter
                fieldType={FieldType.TIME}
                value={firstDeparture.toISOString()}
                onChange={(val) => {
                  if (val) setFirstDeparture(new Date(val as string))
                }}
                disabled={applyRouteTimes.isPending}
              />
            </FieldPanelRow>
          </FieldPanel>

          <div className='max-h-72 space-y-2 overflow-y-auto rounded-2xl border py-2 px-3'>
            {preview.length === 0 ? (
              <p className='text-muted-foreground px-1 py-2 text-xs'>No active stops to apply.</p>
            ) : (
              preview.map((row, index) => (
                <div key={row.visit.id} className='space-y-0.5'>
                  <div className='flex items-center gap-2 text-xs'>
                    <span className='text-muted-foreground w-5 shrink-0'>{index + 1}.</span>
                    {/* PlannerVisit carries no joined work-order number here — keep the
                        placeholder label rather than adding a prop just for this. */}
                    <span className='min-w-0 flex-1 truncate'>Stop {index + 1}</span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1',
                        row.conflict && 'text-destructive'
                      )}>
                      {row.isAnchor ? (
                        <Lock className='size-3' />
                      ) : (
                        <span className='text-muted-foreground'>~</span>
                      )}
                      {format(row.startTime, 'p')}–{format(row.endTime, 'p')}
                    </span>
                    {row.isDefaultDuration && (
                      <span className='text-muted-foreground shrink-0'>(1h default)</span>
                    )}
                  </div>
                  {row.conflict && row.computedArrival && (
                    <p className='pl-7 text-[11px] text-destructive'>
                      plan arrives {format(row.computedArrival, 'p')}, promised{' '}
                      {format(row.startTime, 'p')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={applyRouteTimes.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleConfirm}
            variant='outline'
            size='sm'
            loading={applyRouteTimes.isPending}
            loadingText='Applying...'
            disabled={activeStops.length === 0}
            data-dialog-submit>
            Confirm <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
