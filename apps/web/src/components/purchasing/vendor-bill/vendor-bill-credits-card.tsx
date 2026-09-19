// apps/web/src/components/purchasing/vendor-bill/vendor-bill-credits-card.tsx
'use client'

// `vendor_bill:vendor-credits` — the supplier credit notes raised against this
// bill, and what each one cancelled (71 §5 U7). Read-only: a credit is issued
// and applied from its own drawer; this is the bill's side of the ledger.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/types/resource'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatCurrency } from '@auxx/utils/currency'
import { ReceiptText } from 'lucide-react'
import {
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'

const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_amount_credited',
  'vendor_bill_currency',
  'vendor_bill_vendor_credits',
] as const

export function VendorBillCreditsCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const { values, isLoading } = useSystemValues(recordId as RecordId, [...BILL_ATTRS], {
    autoFetch: true,
  })

  const currencyValue = unwrapValue(values.vendor_bill_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const total = numberValue(values.vendor_bill_total)
  const credited = numberValue(values.vendor_bill_amount_credited)
  const creditRecordIds = extractRelationshipRecordIds(values.vendor_bill_vendor_credits)

  const { data: applications } = api.purchasing.vendorCredit.listForBill.useQuery({
    vendorBillRecordId: recordId,
  })

  if (isLoading) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      <PurchasingSummaryStrip
        cells={[
          { label: 'Bill total', value: formatCurrency(total, { currencyCode }) },
          { label: 'Credited', value: formatCurrency(credited, { currencyCode }) },
          {
            label: 'Credits',
            value: String(creditRecordIds.length),
            tone: creditRecordIds.length === 0 ? 'muted' : 'default',
          },
        ]}
      />

      {creditRecordIds.length === 0 ? (
        <TreeRow
          rowClassName='hover:bg-primary-100'
          icon={<ReceiptText className='size-4' />}
          title={<span className='text-muted-foreground text-sm'>No credit notes</span>}
        />
      ) : (
        creditRecordIds.map((creditRecordId) => (
          <TreeRow
            key={creditRecordId}
            rowClassName='hover:bg-primary-100'
            icon={<ReceiptText className='size-4' />}
            title={<RecordBadge recordId={creditRecordId} variant='link' size='sm' openInStack />}
          />
        ))
      )}

      {applications?.map((application) => (
        <TreeRow
          key={application.id}
          rowClassName='hover:bg-primary-100'
          icon={<ReceiptText className='size-4' />}
          title={
            application.vendorCreditInstanceId ? (
              <RecordBadge
                recordId={toRecordId('vendor_credit', application.vendorCreditInstanceId)}
                variant='link'
                size='sm'
                openInStack
              />
            ) : (
              <span className='truncate text-sm'>Credit applied</span>
            )
          }
          secondary={
            <span className='text-muted-foreground text-xs'>
              {application.operation === 'unapply' ? 'Restored ' : 'Applied '}
              {formatCurrency(application.amountMinor, { currencyCode })}
            </span>
          }
        />
      ))}
    </div>
  )
}
