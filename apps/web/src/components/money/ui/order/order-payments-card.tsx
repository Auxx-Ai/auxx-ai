// apps/web/src/components/money/ui/order/order-payments-card.tsx
'use client'

import type { OrderMoneyTransaction } from '@auxx/lib/accounting/money/customer-money/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useAccess } from '~/providers/capabilities-provider'
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
  const [openPostingId, setOpenPostingId] = useState<string | null>(null)
  const { can } = useAccess()
  const utils = api.useUtils()
  const postReceipt = api.money.postCustomerReceipt.useMutation({
    onSuccess: async (result) => {
      if ('reason' in result && result.reason)
        toastError({ title: 'Payment accounting needs attention', description: result.reason })
      await utils.money.orderMoneyTransactions.invalidate({ orderId: entityInstanceId })
    },
    onError: (error) => toastError({ title: 'Could not post payment', description: error.message }),
  })
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
            onToggleOpen={
              transaction.accounting?.glPostingId
                ? () => setOpenPostingId(transaction.accounting!.glPostingId!)
                : undefined
            }
            icon={
              transaction.purpose === 'customer_refund' ? (
                <ArrowUpRight className='size-4' />
              ) : (
                <ArrowDownLeft className='size-4' />
              )
            }
            title={`${!transaction.hasMoneyTransaction ? 'Observation' : transaction.purpose === 'customer_refund' ? 'Refund' : transaction.purpose === 'customer_receipt' ? 'Payment' : 'Transaction'} · ${amountLabel(transaction)}`}
            description={
              transaction.accounting?.reason ??
              transaction.reason ??
              [
                transaction.accounting?.effectiveDate ?? transaction.occurredOn,
                transaction.reportingProvider,
              ]
                .filter(Boolean)
                .join(' · ')
            }
            secondary={
              <Badge
                variant={
                  transaction.accounting?.state === 'blocked' || transaction.status !== 'accepted'
                    ? 'amber'
                    : 'outline'
                }
                size='xs'>
                {transaction.status === 'accepted'
                  ? transaction.accounting?.state === 'accepted'
                    ? 'Posted'
                    : transaction.accounting?.state === 'blocked'
                      ? 'Accounting blocked'
                      : transaction.accounting?.state === 'pending'
                        ? 'Awaiting posting'
                        : transaction.hasMoneyTransaction
                          ? 'Recorded'
                          : 'Observed'
                  : transaction.status === 'pending'
                    ? 'Pending'
                    : transaction.status === 'blocked'
                      ? 'Needs attention'
                      : 'Not recorded'}
              </Badge>
            }
            actions={
              can(PermissionKey.ledgerControl) &&
              transaction.hasMoneyTransaction &&
              transaction.status === 'accepted' &&
              transaction.purpose === 'customer_receipt' &&
              transaction.accounting?.state !== 'accepted' ? (
                <Button
                  variant='ghost'
                  size='sm'
                  loading={
                    postReceipt.isPending &&
                    postReceipt.variables?.moneyTransactionId === transaction.id
                  }
                  disabled={postReceipt.isPending}
                  onClick={() => postReceipt.mutate({ moneyTransactionId: transaction.id })}>
                  {transaction.accounting?.state === 'blocked' ? 'Retry posting' : 'Post payment'}
                </Button>
              ) : undefined
            }
          />
        )}
      />
      <PostingLinesDialog
        postingId={openPostingId}
        onOpenChange={(open) => !open && setOpenPostingId(null)}
        currencyCode='USD'
      />
    </>
  )
}
