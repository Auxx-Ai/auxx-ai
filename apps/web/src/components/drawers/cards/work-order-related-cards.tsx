// apps/web/src/components/drawers/cards/work-order-related-cards.tsx
'use client'

// Work-order drawer overview blocks — the service_request precedent (uniform
// TreeRow blocks) applied to a job's Schedule (visits) and Invoices. The Schedule
// block's per-visit Schedule/Reschedule button reuses `SchedulePopover` (the header
// ScheduleWorkOrderAction); the Invoices block's "Create invoice" row opens the
// gather dialog (the header CreateInvoiceAction). Scheduling is admin-only, matching
// both the header action and the server-side `dispatchAdminProcedure` gate.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { CalendarClock, Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { SchedulePopover } from '~/components/dispatch/ui/schedule-popover'
import { GatherInvoiceDialog } from '~/components/money/ui/invoice/gather-invoice-dialog'
import { useRecordDrill } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

const VISIT_STATUS: Record<string, { label: string; variant: Variant }> = {
  scheduled: { label: 'Scheduled', variant: 'blue' },
  en_route: { label: 'En route', variant: 'amber' },
  on_site: { label: 'On site', variant: 'purple' },
  done: { label: 'Done', variant: 'green' },
  canceled: { label: 'Canceled', variant: 'red' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule block (visits + per-visit Schedule/Reschedule)
// ─────────────────────────────────────────────────────────────────────────────

export function WorkOrderScheduleCard({ recordId }: DrawerTabProps) {
  const { isAdminOrOwner } = useUser()
  const utils = api.useUtils()
  const drill = useRecordDrill()
  const { data: visits, isLoading } = api.dispatch.listVisits.useQuery({
    workOrderRecordId: recordId,
  })

  const refresh = () => void utils.dispatch.listVisits.invalidate({ workOrderRecordId: recordId })

  if (isLoading) return <RowSkeleton />
  if (!visits?.length) return <EmptyRow label='No visits yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {visits.map((visit) => {
        const status = VISIT_STATUS[visit.status]
        const startTime = visit.startTime ? new Date(visit.startTime) : undefined
        const isTerminal = visit.status === 'done' || visit.status === 'canceled'

        return (
          <TreeRow
            key={visit.id}
            icon={<CalendarClock className='size-4' />}
            title={
              <span className='truncate text-sm'>
                {startTime ? format(startTime, 'EEE, MMM d · p') : 'Not scheduled'}
              </span>
            }
            secondary={
              status ? (
                <Badge variant={status.variant} size='xs'>
                  {status.label}
                </Badge>
              ) : undefined
            }
            onDrill={() => drill.open('visits', visit.id)}
            actions={
              isAdminOrOwner && !isTerminal ? (
                <SchedulePopover
                  trigger={
                    <TreeRowButton persistent>
                      <CalendarClock />
                    </TreeRowButton>
                  }
                  visitId={visit.id}
                  initialStartTime={startTime}
                  initialEndTime={visit.endTime ? new Date(visit.endTime) : undefined}
                  initialAssigneeUserId={visit.assigneeUserId}
                  workOrderRecordId={recordId}
                  recurrenceRuleId={visit.recurrenceRuleId}
                  onScheduled={refresh}
                  onUnscheduled={refresh}
                />
              ) : undefined
            }
          />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoices block (+ header-parity "Create invoice")
// ─────────────────────────────────────────────────────────────────────────────

export function WorkOrderInvoicesCard({ recordId }: DrawerTabProps) {
  const [gatherOpen, setGatherOpen] = useState(false)

  const { values, isLoading } = useSystemValues(recordId, ['work_order_invoices'], {
    autoFetch: true,
  })
  const invoiceRecordIds = extractRelationshipRecordIds(values.work_order_invoices)

  if (isLoading) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {invoiceRecordIds.map((id) => (
        <RelatedRecordRow key={id} recordId={id} statusAttr='invoice_status' />
      ))}

      {/* Always available — the gather dialog owns the "no uninvoiced lines" empty state. */}
      <TreeRow
        icon={
          invoiceRecordIds.length > 0 ? <Plus className='size-4' /> : <Receipt className='size-4' />
        }
        title={<span className='text-sm text-muted-foreground'>Create invoice</span>}
        onToggleOpen={() => setGatherOpen(true)}
      />

      <GatherInvoiceDialog
        open={gatherOpen}
        onOpenChange={setGatherOpen}
        workOrderRecordId={recordId}
      />
    </div>
  )
}
