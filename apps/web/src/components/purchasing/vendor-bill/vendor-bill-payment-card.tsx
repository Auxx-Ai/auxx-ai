// apps/web/src/components/purchasing/vendor-bill/vendor-bill-payment-card.tsx
'use client'

// `vendor_bill:payment` — what this bill still owes, and the payments that settled
// it. The A/P twin of `invoice-payments-card.tsx`: it lists the bill's
// `MoneyApplication` rows (task 71 D7).

import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatCurrency } from '@auxx/utils/currency'
import { Banknote, CircleCheck, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  ProviderPaymentNotice,
  useProviderName,
  useProviderPayments,
} from '~/components/money/ui/provider-payment-notice'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import { RecordBillPaymentDialog } from './record-bill-payment-dialog'

const BILL_ATTRS = [
  'vendor_bill_total',
  'vendor_bill_amount_paid',
  'vendor_bill_amount_credited',
  'vendor_bill_amount_discounted',
  'vendor_bill_status',
  'vendor_bill_payment_status',
  'vendor_bill_currency',
] as const

export function VendorBillPaymentCard({ recordId }: DrawerTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { getSetting } = useSettings({})
  const { values, isLoading } = useSystemValues(recordId, [...BILL_ATTRS], { autoFetch: true })

  const currencyValue = unwrapValue(values.vendor_bill_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'

  const total = numberValue(values.vendor_bill_total)
  const amountPaid = numberValue(values.vendor_bill_amount_paid)
  const credited = numberValue(values.vendor_bill_amount_credited)
  const discounted = numberValue(values.vendor_bill_amount_discounted)
  const balance = total - amountPaid - credited - discounted

  const status = stringValue(values.vendor_bill_status)
  // The money axis (73 D1). `status` answers "is it in the books"; this answers
  // "how much of it is settled".
  const paymentStatus = stringValue(values.vendor_bill_payment_status) ?? 'unpaid'
  const { data: payments } = api.money.billPayments.useQuery({ vendorBillRecordId: recordId })
  const providerName = useProviderName()
  const { recordedMovementIds } = useProviderPayments('vendor_bill', recordId)

  // A void bill owes nothing by definition; a zero-total bill has nothing to settle
  // and would otherwise offer a payment against an amount nobody has entered yet.
  const canMarkPaid =
    status !== 'void' && status !== 'draft' && paymentStatus !== 'paid' && total > 0 && balance > 0

  if (isLoading) return <RowSkeleton />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {canMarkPaid && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setDialogOpen(true)}>
            <Plus /> Record payment
          </Button>
        </DrawerCardActions>
      )}

      <PurchasingSummaryStrip
        cells={[
          { label: 'Bill total', value: formatCurrency(total, { currencyCode }) },
          { label: 'Paid', value: formatCurrency(amountPaid, { currencyCode }) },
          ...(credited > 0
            ? [{ label: 'Credited', value: formatCurrency(credited, { currencyCode }) }]
            : []),
          ...(discounted > 0
            ? [{ label: 'Discounted', value: formatCurrency(discounted, { currencyCode }) }]
            : []),
          {
            label: 'Balance',
            value: formatCurrency(balance, { currencyCode }),
            tone: balance === 0 ? 'muted' : 'default',
          },
        ]}
      />

      <ProviderPaymentNotice kind='vendor_bill' recordId={recordId} />

      {payments?.length ? (
        payments.map((payment) => (
          <TreeRow
            key={payment.moneyTransactionId}
            rowClassName='hover:bg-primary-100'
            icon={<Banknote className='size-4' />}
            title={
              <span className='truncate text-sm'>
                {formatCurrency(payment.allocatedAmount, { currencyCode })}
              </span>
            }
            secondary={
              <span className='flex items-center gap-1.5 text-xs'>
                <span className='text-muted-foreground'>{formatDate(payment.effectiveDate)}</span>
                {payment.method && (
                  <span className='text-muted-foreground'>· {payment.method}</span>
                )}
                {payment.reference && (
                  <span className='truncate text-muted-foreground'>· {payment.reference}</span>
                )}
                {recordedMovementIds.has(payment.moneyTransactionId) && (
                  <span className='shrink-0 text-muted-foreground'>
                    · Recorded from {providerName}
                  </span>
                )}
              </span>
            }
          />
        ))
      ) : (
        <TreeRow
          rowClassName='hover:bg-primary-100'
          icon={<CircleCheck className='size-4' />}
          title={
            <span className='text-muted-foreground text-sm'>
              {paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
            </span>
          }
          secondary={
            <span className='text-xs'>
              {total > 0 ? `${formatCurrency(balance, { currencyCode })} owed` : 'No total entered'}
            </span>
          }
        />
      )}

      <RecordBillPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        billRecordId={recordId}
        total={total}
        amountPaid={amountPaid}
        amountSettledOtherwise={credited + discounted}
        currencyCode={currencyCode}
      />
    </div>
  )
}

function stringValue(value: unknown): string | null {
  const raw = unwrapValue(value)
  return typeof raw === 'string' && raw ? raw : null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
