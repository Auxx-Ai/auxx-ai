// apps/web/src/components/money/ui/order/order-payments-card.tsx
'use client'

import type { OrderMoneyTransaction } from '@auxx/lib/money/customer-money/client'
import { Badge } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { api } from '~/trpc/react'

function amountLabel(transaction: OrderMoneyTransaction): string {
  const { amountMinor, currency, currencyExponent } = transaction
  if (amountMinor === null || currency === null || currencyExponent === null)
    return 'Amount unavailable'
  const digits = amountMinor.padStart(currencyExponent + 1, '0')
  const whole = currencyExponent ? digits.slice(0, -currencyExponent) : digits
  const fraction = currencyExponent ? `.${digits.slice(-currencyExponent)}` : ''
  return `${currency} ${BigInt(whole).toLocaleString()}${fraction}`
}

/** Actual imported receipts and refunds, including source records awaiting resolution. */
export function OrderPaymentsCard({ entityInstanceId }: DrawerTabProps) {
  const query = api.money.orderMoneyTransactions.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const coverage = api.money.orderMoneyCoverage.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  if (query.error) return <EmptyRow label={query.error.message} />
  if (!query.isPending && !query.data?.length)
    return (
      <EmptyRow
        label={
          coverage.isPending
            ? 'Checking payment import'
            : coverage.error
              ? 'Payment import status unavailable'
              : !coverage.data?.sourceAvailable
                ? 'Payments have not been fetched for this order'
                : !coverage.data.complete
                  ? 'Payment import is incomplete'
                  : 'No imported payments or refunds recorded'
        }
      />
    )
  return (
    <>
      {coverage.error && <EmptyRow label='Payment import status unavailable' />}
      {coverage.data && !coverage.data.complete && (
        <p className='px-3 py-2 text-muted-foreground text-xs'>
          Payment import is incomplete. Some transactions may still need attention.
        </p>
      )}
      <TreeRowList
        items={query.data ?? []}
        loading={query.isPending}
        skeletonCount={2}
        getKey={(transaction) => transaction.id}
        renderRow={(transaction) => (
          <TreeRow
            icon={
              transaction.purpose === 'customer_refund' ? (
                <ArrowUpRight className='size-4' />
              ) : (
                <ArrowDownLeft className='size-4' />
              )
            }
            title={`${!transaction.hasMoneyTransaction ? 'Observation' : transaction.purpose === 'customer_refund' ? 'Refund' : transaction.purpose === 'customer_receipt' ? 'Payment' : 'Transaction'} · ${amountLabel(transaction)}`}
            description={
              transaction.reason ??
              [transaction.occurredOn, transaction.reportingProvider].filter(Boolean).join(' · ')
            }
            secondary={
              <Badge variant={transaction.status === 'accepted' ? 'outline' : 'amber'} size='xs'>
                {transaction.status === 'accepted'
                  ? transaction.hasMoneyTransaction
                    ? 'Recorded'
                    : 'Observed'
                  : transaction.status === 'pending'
                    ? 'Pending'
                    : transaction.status === 'blocked'
                      ? 'Needs attention'
                      : 'Not recorded'}
              </Badge>
            }
          />
        )}
      />
    </>
  )
}
