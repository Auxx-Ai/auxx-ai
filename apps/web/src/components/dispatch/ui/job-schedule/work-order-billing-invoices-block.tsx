// apps/web/src/components/dispatch/ui/job-schedule/work-order-billing-invoices-block.tsx
'use client'

// Billing tab §D block 4 (plans/dispatch/money/10-work-order-billing-tab.md) — one TreeRow per
// invoice (number/status/issued date/total/balance) + the drawer's "Create invoice" TreeRow
// pattern, copied verbatim from `WorkOrderInvoicesCard` (work-order-related-cards.tsx). Extends
// `RelatedRecordRow`'s composition (record icon + displayName + status Badge) with the money
// columns the plan calls for, since `RelatedRecordRow` itself is deliberately bare. Each row
// reports its own resolved values up to the billing tab via `onInvoiceValues` — the summary
// strip and the §C record-payment candidate list are built from that map (no batch field-value
// hook exists yet; see `use-work-order-invoices.ts`).

import { getDefinitionId, getInstanceId, type RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { ExternalLink, Plus, Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { RowSkeleton } from '~/components/drawers/cards/related-record-row'
import type { InvoiceBillingValues } from '~/components/money/hooks/use-work-order-invoices'
import { GatherInvoiceDialog } from '~/components/money/ui/invoice/gather-invoice-dialog'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useRecord, useResource } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordIcon } from '~/components/resources/ui/record-icon'

const INVOICE_ATTRS = [
  'invoice_status',
  'invoice_total',
  'invoice_amount_paid',
  'invoice_balance',
  'invoice_issued_at',
] as const

export interface WorkOrderBillingInvoicesBlockProps {
  workOrderRecordId: RecordId
  invoiceRecordIds: RecordId[]
  isLoading: boolean
  currencyCode: string
  onInvoiceValues: (invoiceRecordId: RecordId, values: InvoiceBillingValues) => void
}

/** Invoices block — registered rows + "Create invoice" (billing tab §D block 4). */
export function WorkOrderBillingInvoicesBlock({
  workOrderRecordId,
  invoiceRecordIds,
  isLoading,
  currencyCode,
  onInvoiceValues,
}: WorkOrderBillingInvoicesBlockProps) {
  const [gatherOpen, setGatherOpen] = useState(false)

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {isLoading ? (
        <RowSkeleton />
      ) : (
        invoiceRecordIds.map((id) => (
          <InvoiceBillingRow
            key={id}
            recordId={id}
            currencyCode={currencyCode}
            onValues={onInvoiceValues}
          />
        ))
      )}

      {/* Always available — the gather dialog owns the "no uninvoiced lines" empty state. */}
      <TreeRow
        icon={
          invoiceRecordIds.length > 0 ? <Plus className='size-4' /> : <Receipt className='size-4' />
        }
        title={<span className='text-sm text-muted-foreground'>Create invoice</span>}
        onToggleOpen={() => setGatherOpen(true)}
      />

      <GatherInvoiceDialog
        open={gatherOpen}
        onOpenChange={setGatherOpen}
        workOrderRecordId={workOrderRecordId}
      />
    </div>
  )
}

/** One invoice row: number + status badge + issued date + total + balance, opens the drawer. */
function InvoiceBillingRow({
  recordId,
  currencyCode,
  onValues,
}: {
  recordId: RecordId
  currencyCode: string
  onValues: (recordId: RecordId, values: InvoiceBillingValues) => void
}) {
  const router = useRouter()
  const { record } = useRecord({ recordId, enabled: true })
  const { resource } = useResource(getDefinitionId(recordId))
  const { values, isLoading } = useSystemValues(recordId, [...INVOICE_ATTRS], { autoFetch: true })
  const statusField = useSystemField('invoice_status')

  const status = values.invoice_status as string | undefined
  const total = (values.invoice_total as number | null | undefined) ?? 0
  const amountPaid = (values.invoice_amount_paid as number | null | undefined) ?? 0
  const balance = (values.invoice_balance as number | null | undefined) ?? 0
  const issuedAt = values.invoice_issued_at as string | undefined
  const displayName = record?.displayName ?? 'Untitled'
  const statusOption = statusField?.options?.options?.find((o) => o.value === status)

  // Report this row's resolved values up once loaded — feeds the summary strip's sums and the
  // §C record-payment candidate list (both live on the parent billing tab).
  const reportValues = useCallback(() => {
    onValues(recordId, { recordId, status, total, amountPaid, balance, issuedAt, displayName })
  }, [recordId, status, total, amountPaid, balance, issuedAt, displayName, onValues])

  useEffect(() => {
    if (isLoading) return
    reportValues()
  }, [isLoading, reportValues])

  const href = `/app/invoices?id=${getInstanceId(recordId)}`

  return (
    <TreeRow
      icon={
        <RecordIcon
          avatarUrl={record?.avatarUrl}
          iconId={resource?.icon || 'receipt-text'}
          color={resource?.color || 'gray'}
          size='xs'
        />
      }
      title={<span className='truncate text-sm'>{displayName}</span>}
      secondary={
        status ? (
          <Badge variant={(statusOption?.color as Variant) ?? 'secondary'} size='xs'>
            {statusOption?.label ?? status}
          </Badge>
        ) : undefined
      }
      onToggleOpen={() => router.push(href)}
      actions={
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          {issuedAt && (
            <span className='tabular-nums'>{format(new Date(issuedAt), 'MMM d, yyyy')}</span>
          )}
          <span className='w-16 shrink-0 text-right tabular-nums'>
            {formatCurrency(total, currencyCode)}
          </span>
          <span
            className={`w-16 shrink-0 text-right tabular-nums ${balance > 0 ? 'font-medium text-foreground' : ''}`}>
            {formatCurrency(balance, currencyCode)}
          </span>
          <TreeRowButton persistent tooltipText='Open' onClick={() => router.push(href)}>
            <ExternalLink />
          </TreeRowButton>
        </div>
      }
    />
  )
}
