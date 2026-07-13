// apps/web/src/components/money/hooks/use-work-order-invoices.ts

// Work-order billing tab build spec §D.1/§D.4 (plans/dispatch/money/10-work-order-billing-tab.md)
// — resolves a job's linked invoices via the `work_order_invoices` inverse relationship, the
// same read `WorkOrderInvoicesCard` (work-order-related-cards.tsx) already uses. Shared by the
// billing tab's summary strip, invoices block, and record-payment candidate list so all three
// read one relationship fetch instead of three.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

/**
 * Per-invoice money/status snapshot reported up by each invoice row (`InvoiceBillingRow`) once
 * its own `useSystemValues` read resolves — the "per-invoice child row feeds a parent-held map"
 * shape called for in the build spec (no batch field-value hook exists yet, see §D.1).
 */
export interface InvoiceBillingValues {
  recordId: RecordId
  status: string | undefined
  total: number
  amountPaid: number
  balance: number
  issuedAt: string | undefined
  /** `EntityInstance.displayName` — the invoice number (e.g. "INV-0001"). */
  displayName: string
}

/** Resolve a work order's linked invoice recordIds via `work_order_invoices`. */
export function useWorkOrderInvoices(recordId: RecordId): {
  invoiceRecordIds: RecordId[]
  isLoading: boolean
} {
  const { values, isLoading } = useSystemValues(recordId, ['work_order_invoices'], {
    autoFetch: true,
  })

  return { invoiceRecordIds: extractRelationshipRecordIds(values.work_order_invoices), isLoading }
}
