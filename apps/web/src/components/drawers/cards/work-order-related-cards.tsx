// apps/web/src/components/drawers/cards/work-order-related-cards.tsx
'use client'

// Work-order drawer overview blocks — the service_request precedent (uniform
// TreeRow blocks) applied to a job's Schedule (visits) and Invoices. The Schedule
// block's per-visit Schedule/Reschedule button reuses `SchedulePopover` (the header
// ScheduleWorkOrderAction); the Invoices block's "Create invoice" row opens the
// gather dialog (the header CreateInvoiceAction). Scheduling is admin-only, matching
// both the header action and the server-side `dispatchAdminProcedure` gate.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { ScheduleVisitRow } from '~/components/dispatch/ui/job-schedule/schedule-visit-row'
import { useJobVisits } from '~/components/dispatch/ui/job-schedule/use-job-visits'
import { GatherInvoiceDialog } from '~/components/money/ui/invoice/gather-invoice-dialog'
import { useRecordDrill } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

// ─────────────────────────────────────────────────────────────────────────────
// Schedule block (visits + per-visit Reschedule/Cancel)
// ─────────────────────────────────────────────────────────────────────────────

export function WorkOrderScheduleCard({ recordId }: DrawerTabProps) {
  const drill = useRecordDrill()
  const { visits, isLoading, canEdit, mutations, existingVisits, refresh } = useJobVisits(recordId)

  if (isLoading && visits.length === 0) return <RowSkeleton />
  if (!visits.length) return <EmptyRow label='No visits yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {visits.map((visit) => (
        <ScheduleVisitRow
          key={visit.id}
          visit={visit}
          canEdit={canEdit}
          mutations={mutations}
          existingVisits={existingVisits}
          workOrderRecordId={recordId}
          onRefresh={refresh}
          onOpen={() => drill.open('visits', visit.id)}
        />
      ))}
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
