// apps/web/src/components/drawers/cards/credit-memo-row.tsx
'use client'

// One credit memo as a related-record TreeRow: number, status badge, and the money
// figures the host card asks for. Shared by the invoice drawer's Credits card and the
// order drawer's Credit memos card (plans/accounting/tasks/10-credit-memos.md §6.1), so
// the two lists read the same memo the same way.

import { getDefinitionId, getInstanceId, type RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { ExternalLink, ReceiptText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { unwrap } from './related-record-row'

const MEMO_ATTRS = [
  'credit_memo_number',
  'credit_memo_status',
  'credit_memo_issued_at',
  'credit_memo_total',
  'credit_memo_balance',
] as const

/**
 * The credit memos records view opens a record by `?id=` (records-view.tsx), the same
 * convention `service_request` rows use: `credit_memo` has no detail page of its own.
 */
export function creditMemoHref(recordId: RecordId): string {
  return `/app/credit-memos?id=${getInstanceId(recordId)}`
}

export function CreditMemoRow({
  recordId,
  currencyCode,
  showIssuedAt = false,
  showBalance = false,
}: {
  recordId: RecordId
  currencyCode: string
  /** Print the issue date after the status, the order card's shape. */
  showIssuedAt?: boolean
  /** Print what is still unapplied next to the total, the invoice card's shape. */
  showBalance?: boolean
}) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const { values } = useSystemValues(recordId, [...MEMO_ATTRS], { autoFetch: true })
  const statusField = useSystemField('credit_memo_status', getDefinitionId(recordId))

  const number = (values.credit_memo_number as string | null | undefined) ?? 'Credit memo'
  const status = unwrap(values.credit_memo_status) as string | undefined
  const issuedAt = values.credit_memo_issued_at as string | null | undefined
  const total = values.credit_memo_total as number | null | undefined
  const balance = values.credit_memo_balance as number | null | undefined
  const statusOption = statusField?.options?.options?.find((o) => o.value === status)

  const href = creditMemoHref(recordId)
  const handleOpen = openRecord ? () => openRecord(recordId) : () => router.push(href)

  return (
    <TreeRow
      rowClassName='hover:bg-primary-100'
      onDrill={handleOpen}
      icon={<ReceiptText className='size-4 text-muted-foreground' />}
      title={<span className='truncate text-sm'>{number}</span>}
      secondary={
        <span className='flex items-center gap-2'>
          {status ? (
            <Badge variant={(statusOption?.color as Variant) ?? 'secondary'} size='xs'>
              {statusOption?.label ?? status}
            </Badge>
          ) : null}
          {showIssuedAt && issuedAt ? (
            <span className='text-xs text-muted-foreground'>
              {format(new Date(issuedAt), 'MMM d, yyyy')}
            </span>
          ) : null}
          <span className='text-sm tabular-nums'>{formatCurrency(total ?? 0, currencyCode)}</span>
          {showBalance && balance !== null && balance !== undefined ? (
            <span className='text-xs tabular-nums text-muted-foreground'>
              {formatCurrency(balance, currencyCode)} left
            </span>
          ) : null}
        </span>
      }
      actions={
        <TreeRowButton persistent tooltipText='Open' onClick={() => router.push(href)}>
          <ExternalLink />
        </TreeRowButton>
      }
    />
  )
}
