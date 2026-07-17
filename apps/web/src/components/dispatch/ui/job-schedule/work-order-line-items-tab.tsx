// apps/web/src/components/dispatch/ui/job-schedule/work-order-line-items-tab.tsx
'use client'

import { TuckedLabel } from '@auxx/ui/components/tucked-label'
import { cn } from '@auxx/ui/lib/utils'
import type { DetailViewTabProps } from '~/components/detail-view'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

/**
 * WorkOrderLineItemsTab — registered as `work_order:line-items` (dispatch M2
 * build spec §F.2). Wraps the document-agnostic `LineBuilder` (money MQ1
 * build spec §H.1, which already accepts `documentType: 'work_order'` —
 * filters lines via `line_item:workOrder` and has no billing block since
 * `hasBilling` is quote/invoice-only) — this is the job's per-cycle line set
 * ("what every visit bills", 04-ui.md §6 Line items section / money 01-ui
 * #13): the header reads "Billed each visit" when the job is recurring
 * (`work_order_job_type`). The billing schedule row (money MI2 build spec
 * §K.1) moved to the `billing` section — see `work-order-billing-tab.tsx`
 * (money plan 10 §D block 3).
 */
export function WorkOrderLineItemsTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { values } = useSystemValues(recordId, ['work_order_job_type'], { autoFetch: true })
  const jobType = (values.work_order_job_type as string | undefined) ?? 'one_off'
  const isSection = variant === 'section'

  return (
    <div className={cn('flex flex-col ', isSection ? ' pe-3' : 'h-full min-h-0')}>
      {/* No inset — the label bar shares both edges with the builder frame below
          (the frame overlaps its bottom via the label's -mb-3 tuck). */}
      {jobType === 'recurring' && <TuckedLabel>Billed each visit</TuckedLabel>}
      {/* `-ms-3 ps-3`: bleed the scroll container's clip edge 12px into the
          section's own padding, then pad it back — the builder frame stays
          visually aligned while the row drag grips (absolutely positioned
          10px OUTSIDE the frame, GripSlot's `-left-2.5`) stay inside the
          clip box instead of being cut off by `overflow-auto`. */}
      <div
        className={cn(
          'flex flex-col',
          isSection ? '-ms-3 max-h-[60vh] overflow-auto ps-3' : 'min-h-0 flex-1'
        )}>
        <LineBuilder documentRecordId={recordId} documentType='work_order' />
      </div>
    </div>
  )
}

export default WorkOrderLineItemsTab
