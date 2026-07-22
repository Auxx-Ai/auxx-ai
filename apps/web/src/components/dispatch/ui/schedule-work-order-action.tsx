// apps/web/src/components/dispatch/ui/schedule-work-order-action.tsx
'use client'

// Work-order drawer header action (dispatch M2 build spec §F.4, the
// create-quote-action/create-invoice-action precedent): mounts the schedule
// control (#7, `SchedulePopover`) targeting the job's next visit.
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

  // Plan 30 §G.1 — target the next upcoming non-terminal visit (startTime >= now); else the
  // first unscheduled non-terminal row; else the first non-terminal row. Never falls back to
  // an all-terminal (done/canceled) visit — the header action hides instead (recovery on an
  // all-canceled job is §A.5 Restore, not this button).
  const nonTerminal = visits?.filter((v) => v.status !== 'canceled' && v.status !== 'done') ?? []
  const now = Date.now()
  const visit =
    nonTerminal.find((v) => v.startTime && new Date(v.startTime).getTime() >= now) ??
    nonTerminal.find((v) => !v.startTime) ??
    nonTerminal[0]
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
      workOrderRecordId={recordId}
      recurrenceRuleId={visit.recurrenceRuleId}
      onScheduled={refresh}
      onUnscheduled={refresh}
    />
  )
}
