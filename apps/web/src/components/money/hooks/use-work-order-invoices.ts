// apps/web/src/components/money/hooks/use-work-order-invoices.ts

// Work-order billing tab build spec §D.1/§D.4 (plans/dispatch/money/10-work-order-billing-tab.md)
// — resolves a job's linked invoices via the `work_order_invoices` inverse relationship, the
// same read `WorkOrderBillingCard` (work-order-related-cards.tsx) already uses. Shared with the
// work-order communications tab so both read one relationship fetch instead of two.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

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
