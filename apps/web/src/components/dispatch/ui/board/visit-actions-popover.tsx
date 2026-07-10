// apps/web/src/components/dispatch/ui/board/visit-actions-popover.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ArrowLeft, CalendarClock, ExternalLink, Send } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { SchedulePopoverContent } from '../schedule-popover'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { DispatchVisitEvent } from './types'
import { VISIT_STATUS_LABELS } from './types'
import { nextVisitStatus } from './utils'

interface VisitActionsPopoverContentProps {
  event: DispatchVisitEvent
  canEdit: boolean
  mutations: ReturnType<typeof useBoardMutations>
  existingVisits: ExistingVisitForOverlap[]
  onClose: () => void
}

/**
 * The board chip's click popover (07 §D.2): status advance/cancel, Dispatch/notify, a
 * reschedule mode that swaps in `SchedulePopoverContent` scoped to this visit, and an
 * "Open record" link. Members (`canEdit=false`) see the info + open-record link only.
 */
export function VisitActionsPopoverContent({
  event,
  canEdit,
  mutations,
  existingVisits,
  onClose,
}: VisitActionsPopoverContentProps) {
  const [mode, setMode] = useState<'actions' | 'reschedule'>('actions')
  const [confirm, ConfirmDialog] = useConfirm()

  if (mode === 'reschedule') {
    return (
      <div className='w-72'>
        <div className='flex items-center gap-1 border-b p-2'>
          <Button variant='ghost' size='icon' className='size-6' onClick={() => setMode('actions')}>
            <ArrowLeft />
          </Button>
          <span className='text-sm font-medium'>Reschedule</span>
        </div>
        <SchedulePopoverContent
          visitId={event.id}
          initialStartTime={event.start}
          initialEndTime={event.end}
          initialAssigneeUserId={event.assigneeUserId}
          existingVisits={existingVisits}
          onScheduled={onClose}
          onUnscheduled={onClose}
        />
      </div>
    )
  }

  const next = nextVisitStatus(event.status)
  const canCancel = event.status !== 'canceled' && event.status !== 'done'

  const handleDispatch = async () => {
    if (event.dispatchedAt) {
      const confirmed = await confirm({
        title: 'Re-dispatch this visit?',
        description: `This notifies ${event.workOrder?.contactDisplayName ? 'the worker' : 'the assignee'} again.`,
        confirmText: 'Re-dispatch',
      })
      if (!confirmed) return
    }
    mutations.dispatchVisit.mutate({ visitId: event.id })
  }

  return (
    <div className='w-72 space-y-2 p-3'>
      <div>
        <div className='truncate text-sm font-medium'>{event.title}</div>
        {event.workOrder?.contactDisplayName && (
          <div className='text-muted-foreground truncate text-xs'>
            {event.workOrder.contactDisplayName}
          </div>
        )}
        <div className='text-muted-foreground text-xs'>{VISIT_STATUS_LABELS[event.status]}</div>
      </div>

      {canEdit && (
        <div className='flex flex-col gap-1.5 pt-1'>
          {next && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => mutations.setVisitStatus.mutate({ visitId: event.id, status: next })}
              loading={mutations.setVisitStatus.isPending}>
              Advance to {VISIT_STATUS_LABELS[next]}
            </Button>
          )}
          {canCancel && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() =>
                mutations.setVisitStatus.mutate({ visitId: event.id, status: 'canceled' })
              }
              loading={mutations.setVisitStatus.isPending}>
              Cancel visit
            </Button>
          )}
          <Button
            size='sm'
            variant='outline'
            onClick={handleDispatch}
            loading={mutations.dispatchVisit.isPending}
            disabled={!event.assigneeUserId}>
            <Send /> {event.dispatchedAt ? 'Re-dispatch' : 'Dispatch'}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setMode('reschedule')}>
            <CalendarClock /> Reschedule
          </Button>
        </div>
      )}

      <Button asChild size='sm' variant='ghost' className='w-full justify-start'>
        <Link href='/app/work-orders'>
          <ExternalLink /> Open record
        </Link>
      </Button>

      <ConfirmDialog />
    </div>
  )
}
