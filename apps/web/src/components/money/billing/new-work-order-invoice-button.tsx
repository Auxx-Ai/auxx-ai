// apps/web/src/components/money/billing/new-work-order-invoice-button.tsx
'use client'

// Shared "New invoice" affordance for a work order — the standalone-invoice create flow
// used by BOTH the full-page Billing tab (Invoices section header) and the drawer Billing
// card (section-header action via DrawerCardActions). Owns the prefilled create dialog
// (contact + work order, from this job) and the billing-state invalidation; the caller
// supplies how the saved draft opens (page → record drill, drawer → peek stack). Returns
// null when the invoices resource isn't available, so callers can render it unconditionally.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { useMemo, useState } from 'react'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'

export interface NewWorkOrderInvoiceButtonProps {
  workOrderRecordId: RecordId
  /** Opens the freshly-created draft — page drills into it, drawer peeks it. */
  onOpenInvoice: (invoiceRecordId: RecordId) => void
}

export function NewWorkOrderInvoiceButton({
  workOrderRecordId,
  onOpenInvoice,
}: NewWorkOrderInvoiceButtonProps) {
  const [open, setOpen] = useState(false)
  const utils = api.useUtils()
  const { getResourceById } = useResources()
  const invoiceDefId = getResourceById('invoices')?.id
  const invoiceContactField = useSystemField('invoice_contact')
  const invoiceWorkOrderField = useSystemField('invoice_work_order')
  const { values: workOrderValues } = useSystemValues(workOrderRecordId, ['work_order_contact'], {
    autoFetch: true,
  })
  const presetValues = useMemo(() => {
    const presets: Record<string, unknown> = {}
    if (invoiceWorkOrderField) presets[invoiceWorkOrderField.id] = [workOrderRecordId]
    const contactRecordIds = extractRelationshipRecordIds(workOrderValues.work_order_contact)
    if (invoiceContactField && contactRecordIds.length > 0) {
      presets[invoiceContactField.id] = contactRecordIds
    }
    return presets
  }, [
    invoiceContactField,
    invoiceWorkOrderField,
    workOrderRecordId,
    workOrderValues.work_order_contact,
  ])

  if (!invoiceDefId) return null

  return (
    <>
      <Button variant='ghost' size='xs' onClick={() => setOpen(true)}>
        New invoice
      </Button>
      <RecordEditorDialog
        open={open}
        onOpenChange={setOpen}
        entityDefinitionId={invoiceDefId}
        presetValues={presetValues}
        onSaved={(instanceId) => {
          void utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
          if (instanceId) onOpenInvoice(toRecordId('invoice', instanceId))
        }}
      />
    </>
  )
}
