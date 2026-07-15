// apps/web/src/components/sequences/ui/detail/sequence-delay-pill.tsx

'use client'

import {
  SEQUENCE_ANCHOR_LABELS,
  SEQUENCE_ANCHORABLE_SUBJECT_KINDS,
} from '@auxx/lib/sequences/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

type TimingMode = 'relative' | 'anchor'

interface SequenceDelayPillProps {
  sequenceId: string
  /** The step this delay/anchor precedes (timing lives on the downstream step). */
  stepId: string
  delayDays: number
  delayHours: number
  timingMode: TimingMode
  anchorOffsetDays: number
  anchorTimeOfDay: string | null
  /** Null for manual sequences — gates whether the "Anchored" mode is offered at all
   * (client-notifications plan §4.7). */
  subjectKind: 'visit' | 'work_order' | 'invoice' | null
}

/** "Wait 2 days 4 hours" (or "No delay" when both are zero). */
function formatDelay(days: number, hours: number): string {
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  return parts.length > 0 ? `Wait ${parts.join(' ')}` : 'No delay'
}

/** `'HH:MM'` → `'9:00 AM'` for the pill's compact trigger label. */
function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "2 days before at 9:00 AM" / "Same day at 7:30 AM" / "3 days after". */
function formatAnchor(offsetDays: number, timeOfDay: string | null, anchorLabel: string): string {
  const when =
    offsetDays === 0
      ? `Same day as ${anchorLabel}`
      : `${Math.abs(offsetDays)} ${Math.abs(offsetDays) === 1 ? 'day' : 'days'} ${
          offsetDays < 0 ? 'before' : 'after'
        } ${anchorLabel}`
  return timeOfDay ? `${when} at ${formatTimeOfDay(timeOfDay)}` : when
}

/**
 * The connector between two step cards: a vertical line with a clickable
 * timing pill in the middle. On subject sequences whose subject kind can
 * actually be anchored (`visit`/`invoice` — `work_order` has no anchor date
 * in v1, plan §4.2), the popover offers a Relative/Anchored mode toggle;
 * manual and work_order-subject sequences only ever see the relative
 * days/hours editor. The new timing commits on popover close (or Enter),
 * same as the original relative-only delay editor.
 */
export function SequenceDelayPill({
  sequenceId,
  stepId,
  delayDays,
  delayHours,
  timingMode,
  anchorOffsetDays,
  anchorTimeOfDay,
  subjectKind,
}: SequenceDelayPillProps) {
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(String(delayDays))
  const [hours, setHours] = useState(String(delayHours))
  const [mode, setMode] = useState<TimingMode>(timingMode)
  const [beforeAfter, setBeforeAfter] = useState<'before' | 'after'>(
    anchorOffsetDays < 0 ? 'before' : 'after'
  )
  const [magnitude, setMagnitude] = useState(String(Math.abs(anchorOffsetDays)))
  const [timeOfDay, setTimeOfDay] = useState(anchorTimeOfDay ?? '09:00')

  const canAnchor =
    subjectKind !== null &&
    (SEQUENCE_ANCHORABLE_SUBJECT_KINDS as readonly string[]).includes(subjectKind)
  const anchorLabel = canAnchor ? SEQUENCE_ANCHOR_LABELS[subjectKind as 'visit' | 'invoice'] : null

  const updateStep = api.sequence.updateStep.useMutation({
    onSuccess: () => utils.sequence.get.invalidate({ id: sequenceId }),
    onError: (error) =>
      toastError({ title: 'Failed to update timing', description: error.message }),
  })

  const commit = () => {
    if (mode === 'anchor' && canAnchor) {
      const nextMagnitude = Math.max(0, Number.parseInt(magnitude, 10) || 0)
      const nextOffsetDays = beforeAfter === 'before' ? -nextMagnitude : nextMagnitude
      const changed =
        timingMode !== 'anchor' ||
        nextOffsetDays !== anchorOffsetDays ||
        timeOfDay !== (anchorTimeOfDay ?? '')
      if (changed) {
        updateStep.mutate({
          stepId,
          fields: {
            timingMode: 'anchor',
            anchorOffsetDays: nextOffsetDays,
            anchorTimeOfDay: timeOfDay || null,
          },
        })
      }
      return
    }

    const nextDays = Math.max(0, Number.parseInt(days, 10) || 0)
    const nextHours = Math.max(0, Number.parseInt(hours, 10) || 0)
    const changed = timingMode !== 'relative' || nextDays !== delayDays || nextHours !== delayHours
    if (changed) {
      updateStep.mutate({
        stepId,
        fields: { timingMode: 'relative', delayDays: nextDays, delayHours: nextHours },
      })
    }
  }

  const triggerLabel =
    timingMode === 'anchor' && canAnchor && anchorLabel
      ? formatAnchor(anchorOffsetDays, anchorTimeOfDay, anchorLabel)
      : formatDelay(delayDays, delayHours)

  return (
    <div className='flex flex-col items-center'>
      <div className='h-4 w-px bg-border' />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            // Re-seed from props on open so a stale draft doesn't linger.
            setDays(String(delayDays))
            setHours(String(delayHours))
            setMode(timingMode)
            setBeforeAfter(anchorOffsetDays < 0 ? 'before' : 'after')
            setMagnitude(String(Math.abs(anchorOffsetDays)))
            setTimeOfDay(anchorTimeOfDay ?? '09:00')
          } else {
            commit()
          }
          setOpen(next)
        }}>
        <PopoverTrigger asChild>
          <Button variant='outline' size='xs' className='rounded-full text-muted-foreground'>
            <Clock />
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-64 p-3' align='center'>
          <div className='flex flex-col gap-3'>
            {canAnchor && (
              <div className='flex gap-1 rounded-lg border p-0.5'>
                <Button
                  type='button'
                  variant={mode === 'relative' ? 'default' : 'ghost'}
                  size='xs'
                  className='flex-1'
                  onClick={() => setMode('relative')}>
                  Relative
                </Button>
                <Button
                  type='button'
                  variant={mode === 'anchor' ? 'default' : 'ghost'}
                  size='xs'
                  className='flex-1'
                  onClick={() => setMode('anchor')}>
                  Anchored
                </Button>
              </div>
            )}

            {mode === 'anchor' && canAnchor ? (
              <>
                <div className='flex items-end gap-2'>
                  <div className='flex-1'>
                    <label
                      className='mb-1 block text-xs text-muted-foreground'
                      htmlFor={`anchor-magnitude-${stepId}`}>
                      Days
                    </label>
                    <Input
                      id={`anchor-magnitude-${stepId}`}
                      type='number'
                      min={0}
                      value={magnitude}
                      onChange={(e) => setMagnitude(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOpen(false)
                      }}
                    />
                  </div>
                  <Select
                    value={beforeAfter}
                    onValueChange={(v) => setBeforeAfter(v as 'before' | 'after')}>
                    <SelectTrigger size='sm' className='w-28'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='before'>before</SelectItem>
                      <SelectItem value='after'>after</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className='text-xs text-muted-foreground'>{anchorLabel}</p>
                <div>
                  <label
                    className='mb-1 block text-xs text-muted-foreground'
                    htmlFor={`anchor-time-${stepId}`}>
                    Time of day
                  </label>
                  <Input
                    id={`anchor-time-${stepId}`}
                    type='time'
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpen(false)
                    }}
                  />
                </div>
              </>
            ) : (
              <div className='flex items-end gap-2'>
                <div className='flex-1'>
                  <label
                    className='mb-1 block text-xs text-muted-foreground'
                    htmlFor={`delay-days-${stepId}`}>
                    Days
                  </label>
                  <Input
                    id={`delay-days-${stepId}`}
                    type='number'
                    min={0}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpen(false)
                    }}
                  />
                </div>
                <div className='flex-1'>
                  <label
                    className='mb-1 block text-xs text-muted-foreground'
                    htmlFor={`delay-hours-${stepId}`}>
                    Hours
                  </label>
                  <Input
                    id={`delay-hours-${stepId}`}
                    type='number'
                    min={0}
                    max={23}
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpen(false)
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <div className='h-4 w-px bg-border' />
    </div>
  )
}
