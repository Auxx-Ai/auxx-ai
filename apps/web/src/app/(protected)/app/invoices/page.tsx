// apps/web/src/app/(protected)/app/invoices/page.tsx
'use client'

import { BatchInvoiceAction } from '~/components/money/billing/batch-invoice-action'
import { RecordsView } from '~/components/records'

/**
 * Invoices page — renders the shared RecordsView for the invoices resource.
 * Drawer-only (no `[invoiceId]/` detail route, money MI1 build spec §J.6).
 */
export default function InvoicesPage() {
  return (
    <RecordsView slug='invoices' basePath='/app/invoices' pageActions={<BatchInvoiceAction />} />
  )
}
