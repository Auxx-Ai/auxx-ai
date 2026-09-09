// apps/web/src/components/money/ui/invoice/invoice-credits-card.tsx
'use client'

// Invoice drawer's "Credits" card, registered as 'invoice:credits' and mounted beside
// Payments (plans/accounting/tasks/10-credit-memos.md §6.1). Two read-only lists off the
// invoice's own inverse fields: the memos raised AGAINST this invoice
// (`invoice_credit_memos`, number / status / total / balance) and the credit applied TO it
// (`invoice_credit_applications`, memo number / amount / applied at). The two are different
// facts: a memo raised from this invoice may have been applied to another one, and credit
// from a memo raised elsewhere may have reduced this balance.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { format } from 'date-fns'
import { ArrowLeftRight } from 'lucide-react'
import { CreditMemoRow } from '~/components/drawers/cards/credit-memo-row'
import {
  EmptyRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'

const INVOICE_ATTRS = ['invoice_credit_memos', 'invoice_credit_applications'] as const

export function InvoiceCreditsCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { values, isLoading } = useSystemValues(recordId, [...INVOICE_ATTRS], {
    autoFetch: true,
  })
  const memoRecordIds = extractRelationshipRecordIds(values.invoice_credit_memos)
  const applicationRecordIds = extractRelationshipRecordIds(values.invoice_credit_applications)

  if (isLoading) return <RowSkeleton />
  if (memoRecordIds.length === 0 && applicationRecordIds.length === 0) {
    return <EmptyRow label='No credits yet' />
  }

  return (
    <div className='flex flex-col gap-3'>
      {memoRecordIds.length > 0 && (
        <div>
          <p className='px-1 pb-1 text-[11px] text-muted-foreground'>Credit memos</p>
          <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
            {memoRecordIds.map((id) => (
              <CreditMemoRow key={id} recordId={id} currencyCode={currencyCode} showBalance />
            ))}
          </div>
        </div>
      )}
      {applicationRecordIds.length > 0 && (
        <div>
          <p className='px-1 pb-1 text-[11px] text-muted-foreground'>Credit applied</p>
          <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
            {applicationRecordIds.map((id) => (
              <CreditApplicationRow key={id} recordId={id} currencyCode={currencyCode} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const APPLICATION_ATTRS = [
  'credit_memo_application_credit_memo',
  'credit_memo_application_amount',
  'credit_memo_application_applied_at',
] as const

/** One `credit_memo_application` row: the memo it drew on, the amount, and when. */
function CreditApplicationRow({
  recordId,
  currencyCode,
}: {
  recordId: RecordId
  currencyCode: string
}) {
  const openRecord = useOpenRecord()
  const { values } = useSystemValues(recordId, [...APPLICATION_ATTRS], { autoFetch: true })
  const memoRecordId = extractRelationshipRecordIds(values.credit_memo_application_credit_memo)[0]
  const { values: memoValues } = useSystemValues(memoRecordId, ['credit_memo_number'], {
    autoFetch: true,
  })

  const memoNumber = (memoValues.credit_memo_number as string | null | undefined) ?? 'Credit memo'
  const amount = values.credit_memo_application_amount as number | null | undefined
  const appliedAt = values.credit_memo_application_applied_at as string | null | undefined

  return (
    <TreeRow
      rowClassName='hover:bg-primary-100'
      onDrill={memoRecordId && openRecord ? () => openRecord(memoRecordId) : undefined}
      icon={<ArrowLeftRight className='size-4 text-muted-foreground' />}
      title={<span className='truncate text-sm'>{memoNumber}</span>}
      secondary={
        <span className='flex items-center gap-2'>
          {appliedAt ? (
            <span className='text-xs text-muted-foreground'>
              {format(new Date(appliedAt), 'MMM d, yyyy')}
            </span>
          ) : null}
          <span className='text-sm tabular-nums'>{formatCurrency(amount ?? 0, currencyCode)}</span>
        </span>
      }
    />
  )
}
