// apps/web/src/components/dispatch/ui/job-schedule/work-order-communications-tab.tsx
'use client'

// WorkOrderCommunicationsTab — registered as `work_order:communications` (client-notifications
// plan §4.8/Phase 4). The job's outbound-message timeline: booking confirmations, visit
// reminders, en-route notices, follow-ups, invoice reminders, and manual quote/invoice sends —
// anything that wrote an `EntitySignal` linked to this job, one of its visits, or a linked
// invoice/quote. Follows `WorkOrderBillingTab`'s `variant` handling.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { getInstanceId } from '@auxx/types/resource'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import type { DetailViewTabProps } from '~/components/detail-view'
import { useWorkOrderInvoices } from '~/components/money/hooks/use-work-order-invoices'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { CommunicationsList } from '~/components/signals/ui/communications-list'
import { api } from '~/trpc/react'

export function WorkOrderCommunicationsTab({
  recordId,
  entityInstanceId,
  variant = 'tab',
}: DetailViewTabProps) {
  const isSection = variant === 'section'

  const { data: visits } = api.dispatch.listVisits.useQuery({ workOrderRecordId: recordId })
  const { invoiceRecordIds } = useWorkOrderInvoices(recordId)
  const { values } = useSystemValues(recordId, ['work_order_quote'], { autoFetch: true })
  const quoteRecordIds = extractRelationshipRecordIds(values.work_order_quote)

  const recordKeys = useMemo(() => {
    const keys = [`work_order:${entityInstanceId}`]
    for (const visit of visits ?? []) keys.push(`visit:${visit.id}`)
    for (const invoiceRecordId of invoiceRecordIds) {
      keys.push(`invoice:${getInstanceId(invoiceRecordId)}`)
    }
    for (const quoteRecordId of quoteRecordIds) {
      keys.push(`quote:${getInstanceId(quoteRecordId)}`)
    }
    return keys
  }, [entityInstanceId, visits, invoiceRecordIds, quoteRecordIds])

  return (
    // Section variant: `pe-3` matches the Line-items section's right inset so the
    // list clears its own scrollbar and shares the page column's right edge.
    <div
      className={cn(
        isSection ? 'max-h-[70vh] overflow-auto pe-3' : 'flex h-full min-h-0 flex-col'
      )}>
      <CommunicationsList recordKeys={recordKeys} />
    </div>
  )
}

export default WorkOrderCommunicationsTab
