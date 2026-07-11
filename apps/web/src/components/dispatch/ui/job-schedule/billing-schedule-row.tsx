// apps/web/src/components/dispatch/ui/job-schedule/billing-schedule-row.tsx
'use client'

import type { RecurrencePattern } from '@auxx/lib/recurrence/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CalendarClock } from 'lucide-react'
import { useState } from 'react'
import type { RecordId } from '~/components/resources'
import { api } from '~/trpc/react'
import { BillingScheduleEditor } from './billing-schedule-editor'

/** Static explainer copy for the two non-editable automated timings (money MI2 build spec §K.1). */
const INVOICE_TIMING_EXPLAINER: Record<string, string> = {
  per_visit_completed: 'Invoice drafts are created after each completed visit.',
  on_completion: 'An invoice draft is created when the job completes.',
  as_needed: 'Invoices are created manually.',
}

export interface BillingScheduleRowProps {
  workOrderRecordId: RecordId
  /** `work_order_invoice_timing` value. */
  invoiceTiming: string
}

/**
 * Job view Billing row (money MI2 build spec §K.1) — the reserved slot above the line-items
 * builder. `custom_schedule` shows the recurrence summary + an editor popover (§K.2); the other
 * automated timings get one quiet explainer line; `as_needed` explains billing stays manual.
 * Kept as a single row, not a card, so it doesn't compete with the line items below it.
 */
export function BillingScheduleRow({ workOrderRecordId, invoiceTiming }: BillingScheduleRowProps) {
  const [open, setOpen] = useState(false)
  const scheduleQuery = api.money.getInvoiceSchedule.useQuery(
    { workOrderRecordId },
    { enabled: invoiceTiming === 'custom_schedule' }
  )

  if (invoiceTiming !== 'custom_schedule') {
    const explainer = INVOICE_TIMING_EXPLAINER[invoiceTiming]
    if (!explainer) return null
    return (
      <div className='flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs text-muted-foreground'>
        <CalendarClock className='size-3.5' />
        {explainer}
      </div>
    )
  }

  const rule = scheduleQuery.data

  return (
    <div className='flex items-center justify-between gap-2 px-4 pt-3 pb-1'>
      <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
        <CalendarClock className='size-3.5' />
        {rule ? rule.summary : 'No billing schedule yet'}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='xs'>
            {rule ? 'Edit schedule' : 'Add billing schedule'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='end'>
          <BillingScheduleEditor
            workOrderRecordId={workOrderRecordId}
            existingPattern={rule ? (rule.pattern as unknown as RecurrencePattern) : null}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
