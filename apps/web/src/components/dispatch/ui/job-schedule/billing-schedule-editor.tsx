// apps/web/src/components/dispatch/ui/job-schedule/billing-schedule-editor.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import { type RecurrencePattern, recurrencePatternSchema } from '@auxx/lib/recurrence/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import type { RecordId } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { RecurrencePatternFields } from '../recurrence/recurrence-pattern-fields'
import { defaultCustomPattern, scalarSetting } from '../recurrence/recurrence-utils'

export interface BillingScheduleEditorProps {
  workOrderRecordId: RecordId
  /** The existing rule's pattern, or `null` for a fresh schedule (money MI2 build spec §K.2). */
  existingPattern: RecurrencePattern | null
  onClose: () => void
}

/**
 * Billing schedule editor (money MI2 build spec §K.2) — reuses M2c's `RecurrencePatternFields`
 * (pattern + end condition only, no time/duration/assignee — those stay null for
 * `invoice_drafts` rules) inside a popover from the job view's Billing row. Save writes
 * `money.setInvoiceSchedule` (whole-rule edit, §F.1 — timezone is re-detected from the browser
 * on every save, the `schedule-popover.tsx` convention); Remove clears the rule (existing
 * drafts are kept) behind `useConfirm`.
 */
export function BillingScheduleEditor({
  workOrderRecordId,
  existingPattern,
  onClose,
}: BillingScheduleEditorProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartIndex = weekStartToIndex(weekStart)

  const [pattern, setPattern] = useState<RecurrencePattern>(
    existingPattern ?? defaultCustomPattern(undefined)
  )
  const patternValid = recurrencePatternSchema.safeParse(pattern).success

  // Also invalidate the composed billing read (work-order invoice flow plan §4.7) so the
  // Billing tab's "Automation" summary reflects the new/removed schedule immediately, without
  // waiting for the `work_order_billing_revision` realtime round-trip.
  const invalidate = () => {
    void utils.money.getInvoiceSchedule.invalidate({ workOrderRecordId })
    void utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
  }

  const setSchedule = api.money.setInvoiceSchedule.useMutation({
    onError: (error) =>
      toastError({ title: 'Error saving billing schedule', description: error.message }),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })
  const clearSchedule = api.money.clearInvoiceSchedule.useMutation({
    onError: (error) =>
      toastError({ title: 'Error removing billing schedule', description: error.message }),
    onSuccess: () => {
      invalidate()
      onClose()
    },
  })

  const handleSave = () => {
    if (!patternValid) return
    setSchedule.mutate({ workOrderRecordId, pattern, timezone: detectTimezone() })
  }

  const handleRemove = async () => {
    const confirmed = await confirm({
      title: 'Stop generating scheduled invoices?',
      description: 'Existing drafts are kept.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    clearSchedule.mutate({ workOrderRecordId })
  }

  return (
    <div className='w-80 space-y-3 p-3'>
      <RecurrencePatternFields
        value={pattern}
        onChange={setPattern}
        weekStartIndex={weekStartIndex}
      />
      {!patternValid && (
        <p className='px-0.5 text-xs text-destructive'>
          Pick at least one weekday, or fix the end condition, to save this pattern.
        </p>
      )}
      <div className='flex items-center justify-between gap-2'>
        {existingPattern ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={handleRemove}
            loading={clearSchedule.isPending}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <Button
          size='sm'
          onClick={handleSave}
          loading={setSchedule.isPending}
          disabled={!patternValid}>
          Save
        </Button>
      </div>
      <ConfirmDialog />
    </div>
  )
}
