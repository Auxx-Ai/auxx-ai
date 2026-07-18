// apps/web/src/components/money/billing/invoice-tree-row.tsx
'use client'

// Shared single-line invoice row — Receipt icon, invoice name, `status · total` secondary,
// trailing drill chevron. Rendered by both the full-page Billing tab's Invoices list and the
// drawer Billing card so the two recipes never drift. `onOpen` drills into the invoice (page
// → record drill panel, drawer → peek stack).

import { TreeRow } from '@auxx/ui/components/tree-row'
import { Receipt } from 'lucide-react'
import type { WorkOrderBillingView } from '~/components/money/billing/types'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'

type InvoiceSummary = WorkOrderBillingView['invoices'][number]

export function InvoiceTreeRow({
  invoice,
  currencyCode,
  onOpen,
}: {
  invoice: InvoiceSummary
  currencyCode: string
  onOpen: () => void
}) {
  return (
    <TreeRow
      rowClassName='hover:bg-primary-100'
      icon={<Receipt className='size-4' />}
      title={<span className='text-sm'>{invoice.displayName}</span>}
      secondary={
        <span className='text-xs'>
          {invoice.status} · {formatCurrency(invoice.total, currencyCode)}
        </span>
      }
      onDrill={onOpen}
    />
  )
}
