// apps/web/src/components/dispatch/ui/schedule-work-order-action.tsx
'use client'

// Work-order drawer header action (dispatch M2 build spec §F.4, the
// create-quote-action/create-invoice-action precedent): mounts the schedule
// control (#7, `SchedulePopover`) targeting the job's next/only visit.
// Admin-only client-side (`dispatch-board.tsx`'s `isAdminOrOwner` pattern) —
// scheduling mutations are admin-gated server-side too (`dispatchAdminProcedure`).
// `<div><Tooltip><Button/></Tooltip></div>` as the popover trigger is the
// `workflow-versions-popover.tsx` precedent for nesting a Tooltip inside a
// `PopoverTrigger asChild` without breaking either's ref forwarding.

import { Button } from '@auxx/ui/components/button'
import { CalendarClock } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import type { DrawerActionProps } from '../../drawers/drawer-action-registry'
import { SchedulePopover } from './schedule-popover'

export function ScheduleWorkOrderAction({ recordId }: DrawerActionProps) {
  const { isAdminOrOwner } = useUser()
  const utils = api.useUtils()
  const { data: visits, isLoading } = api.dispatch.listVisits.useQuery(
    { workOrderRecordId: recordId },
    { enabled: isAdminOrOwner }
  )

  if (!isAdminOrOwner || isLoading) return null

  // Oldest-scheduled-first with unscheduled last (§B.6) — the first non-terminal
  // row is the one dispatchers act on; v1 is one-off (exactly one visit per job).
  const visit = visits?.find((v) => v.status !== 'canceled' && v.status !== 'done') ?? visits?.[0]
  if (!visit) return null

  const refresh = () => void utils.dispatch.listVisits.invalidate({ workOrderRecordId: recordId })

  return (
    <SchedulePopover
      trigger={
        <div>
          <Tooltip content='Schedule' allowInteraction>
            <Button variant='ghost' size='icon-xs'>
              <CalendarClock />
            </Button>
          </Tooltip>
        </div>
      }
      visitId={visit.id}
      initialStartTime={visit.startTime ? new Date(visit.startTime) : undefined}
      initialEndTime={visit.endTime ? new Date(visit.endTime) : undefined}
      initialAssigneeUserId={visit.assigneeUserId}
      onScheduled={refresh}
      onUnscheduled={refresh}
    />
  )
}
