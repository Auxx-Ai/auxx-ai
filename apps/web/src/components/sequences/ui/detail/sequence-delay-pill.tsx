// apps/web/src/components/sequences/ui/detail/sequence-delay-pill.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface SequenceDelayPillProps {
  sequenceId: string
  /** The step this delay precedes (delay lives on the downstream step). */
  stepId: string
  delayDays: number
  delayHours: number
}

/** "Wait 2 days 4 hours" (or "No delay" when both are zero). */
function formatDelay(days: number, hours: number): string {
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  return parts.length > 0 ? `Wait ${parts.join(' ')}` : 'No delay'
}

/**
 * The connector between two step cards: a vertical line with a clickable delay
 * pill in the middle. Clicking opens a small popover with days/hours number
 * inputs; the new delay commits on close (or Enter).
 */
export function SequenceDelayPill({
  sequenceId,
  stepId,
  delayDays,
  delayHours,
}: SequenceDelayPillProps) {
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(String(delayDays))
  const [hours, setHours] = useState(String(delayHours))

  const updateStep = api.sequence.updateStep.useMutation({
    onSuccess: () => utils.sequence.get.invalidate({ id: sequenceId }),
    onError: (error) => toastError({ title: 'Failed to update delay', description: error.message }),
  })

  const commit = () => {
    const nextDays = Math.max(0, Number.parseInt(days, 10) || 0)
    const nextHours = Math.max(0, Number.parseInt(hours, 10) || 0)
    if (nextDays !== delayDays || nextHours !== delayHours) {
      updateStep.mutate({ stepId, fields: { delayDays: nextDays, delayHours: nextHours } })
    }
  }

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
          } else {
            commit()
          }
          setOpen(next)
        }}>
        <PopoverTrigger asChild>
          <Button variant='outline' size='xs' className='rounded-full text-muted-foreground'>
            <Clock />
            {formatDelay(delayDays, delayHours)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-56 p-3' align='center'>
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
        </PopoverContent>
      </Popover>
      <div className='h-4 w-px bg-border' />
    </div>
  )
}
