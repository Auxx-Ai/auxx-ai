// apps/web/src/components/dispatch/ui/job-schedule/work-order-line-items-tab.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { DetailViewTabProps } from '~/components/detail-view'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { BillingScheduleRow } from './billing-schedule-row'

/**
 * WorkOrderLineItemsTab — registered as `work_order:line-items` (dispatch M2
 * build spec §F.2). Wraps the document-agnostic `LineBuilder` (money MQ1
 * build spec §H.1, which already accepts `documentType: 'work_order'` —
 * filters lines via `line_item:workOrder` and has no billing block since
 * `hasBilling` is quote/invoice-only) — this is the job's per-cycle line set
 * ("what every visit bills", 04-ui.md §6 Line items section / money 01-ui
 * #13): the header reads "Billed each visit" when the job is recurring
 * (`work_order_job_type`). The Billing row (money MI2 build spec §K.1) sits
 * above it — the reserved slot for how/when invoice drafts get generated.
 */
export function WorkOrderLineItemsTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { values } = useSystemValues(
    recordId,
    ['work_order_job_type', 'work_order_invoice_timing'],
    { autoFetch: true }
  )
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const invoiceTiming =
    (values.work_order_invoice_timing as string | undefined) ?? 'per_visit_completed'
  const isSection = variant === 'section'

  return (
    <div className={cn('flex flex-col', isSection ? '' : 'h-full min-h-0')}>
      <BillingScheduleRow workOrderRecordId={recordId} invoiceTiming={invoiceTiming} />
      {jobType === 'recurring' && (
        <div className='px-4 pt-1 pb-1 text-xs font-medium text-muted-foreground'>
          Billed each visit
        </div>
      )}
      <div
        className={cn(
          'flex flex-col px-4 pb-4',
          isSection ? 'max-h-[60vh] overflow-auto' : 'min-h-0 flex-1'
        )}>
        <LineBuilder documentRecordId={recordId} documentType='work_order' />
      </div>
    </div>
  )
}

export default WorkOrderLineItemsTab
