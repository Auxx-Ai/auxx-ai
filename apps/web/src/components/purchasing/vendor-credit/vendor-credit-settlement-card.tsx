// apps/web/src/components/purchasing/vendor-credit/vendor-credit-settlement-card.tsx
'use client'

// The vendor credit drawer's "Settlement" card, registered as
// `vendor_credit:settlement` (71 §5 U7). What happened to the credit after
// issue: applied to a bill, held (the balance), or refunded by the supplier.
// The buy-side mirror of `credit-memo-settlement-card.tsx`.

import type { RecordId } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { format } from 'date-fns'
import { ArrowLeftRight, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { paymentMethodLabel } from '~/components/money/ui/invoice/payment-method-options'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { ApplyVendorCreditDialog } from './apply-vendor-credit-dialog'
import { RefundVendorCreditDialog } from './refund-vendor-credit-dialog'

export function VendorCreditSettlementCard({ recordId }: DrawerTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [applyOpen, setApplyOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const utils = api.useUtils()
  const settlementQuery = api.purchasing.vendorCredit.settlement.useQuery({
    vendorCreditRecordId: recordId,
  })
  const settlement = settlementQuery.data

  const invalidate = () => {
    void utils.purchasing.vendorCredit.settlement.invalidate({ vendorCreditRecordId: recordId })
  }

  const unapply = api.purchasing.vendorCredit.unapplyFromBill.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error unapplying credit', description: error.message }),
  })

  const handleUnapply = async (applicationRecordId: RecordId) => {
    const confirmed = await confirm({
      title: 'Unapply this credit?',
      description: 'The bill balance goes back up by this amount and the credit is held again.',
      confirmText: 'Unapply',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) unapply.mutate({ applicationRecordId })
  }

  if (settlementQuery.isLoading || !settlement) {
    return <EmptySection loading title='Loading settlement' />
  }

  const {
    status,
    vendorInstanceId,
    totalMinor,
    amountAppliedMinor,
    amountRefundedMinor,
    balanceMinor,
    applications,
    refunds,
  } = settlement
  // Apply and refund are second steps on an ISSUED credit with balance left.
  const canSettle = status === 'issued' && balanceMinor > 0
  const vendorRecordId = vendorInstanceId ? toRecordId('company', vendorInstanceId) : null
  const hasRows = applications.length > 0 || refunds.length > 0

  return (
    <div className='flex flex-col gap-2'>
      {canSettle && (
        <DrawerCardActions>
          {vendorRecordId && (
            <Button variant='ghost' size='xs' onClick={() => setApplyOpen(true)}>
              <ArrowLeftRight />
              Apply to bill
            </Button>
          )}
          <Button variant='ghost' size='xs' onClick={() => setRefundOpen(true)}>
            <RotateCcw />
            Record refund
          </Button>
        </DrawerCardActions>
      )}

      <div className='grid grid-cols-4 gap-2 px-3 py-1 text-xs'>
        {[
          { label: 'Total', value: totalMinor, emphasis: false },
          { label: 'Applied', value: amountAppliedMinor, emphasis: false },
          { label: 'Refunded', value: amountRefundedMinor, emphasis: false },
          { label: 'Balance', value: balanceMinor, emphasis: true },
        ].map((cell) => (
          <div key={cell.label} className='flex flex-col'>
            <span className='text-muted-foreground'>{cell.label}</span>
            <span
              className={
                cell.emphasis ? 'font-medium text-foreground tabular-nums' : 'tabular-nums'
              }>
              {formatCurrency(cell.value, currencyCode)}
            </span>
          </div>
        ))}
      </div>

      {!hasRows && (
        <EmptySection
          orientation='horizontal'
          icon={<ArrowLeftRight className='size-4' />}
          title={
            status === 'draft'
              ? 'Issue the credit to apply or refund it'
              : 'Not applied or refunded yet'
          }
        />
      )}

      {applications.length > 0 && (
        <TreeRowList
          items={applications}
          getKey={(application) => application.applicationInstanceId}
          renderRow={(application) => (
            <TreeRow
              rowClassName='hover:bg-primary-100'
              icon={<ArrowLeftRight className='size-4' />}
              title={
                application.vendorBillInstanceId ? (
                  <RecordBadge
                    recordId={toRecordId('vendor_bill', application.vendorBillInstanceId)}
                    variant='link'
                    size='sm'
                    openInStack
                  />
                ) : (
                  <span className='truncate text-sm'>{application.vendorBillNumber}</span>
                )
              }
              secondary={
                application.appliedAt ? (
                  <span className='tabular-nums'>
                    {format(new Date(application.appliedAt), 'MMM d, yyyy')}
                  </span>
                ) : undefined
              }
              actions={
                <div className='flex items-center gap-3 text-muted-foreground text-xs'>
                  <span className='shrink-0 text-foreground text-sm tabular-nums'>
                    {application.operation === 'unapply' ? 'Restored ' : ''}
                    {formatCurrency(application.amountMinor, currencyCode)}
                  </span>
                  {status !== 'void' && application.operation !== 'unapply' && (
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Unapply credit'
                      disabled={unapply.isPending}
                      onClick={() =>
                        void handleUnapply(
                          toRecordId('vendor_credit_application', application.applicationInstanceId)
                        )
                      }>
                      <Undo2 />
                    </TreeRowButton>
                  )}
                </div>
              }
            />
          )}
        />
      )}

      {refunds.length > 0 && (
        <TreeRowList
          items={refunds}
          getKey={(refund) => refund.moneyTransactionId}
          renderRow={(refund) => (
            <TreeRow
              rowClassName='hover:bg-primary-100'
              icon={<RotateCcw className='size-4' />}
              title={
                <span className='truncate text-sm'>
                  {paymentMethodLabel(refund.method ?? 'other')}
                </span>
              }
              secondary={
                <span className='flex items-center gap-1.5 text-xs'>
                  <span className='text-muted-foreground tabular-nums'>{refund.effectiveDate}</span>
                  {refund.reference && (
                    <span className='truncate text-muted-foreground'>· {refund.reference}</span>
                  )}
                </span>
              }
              actions={
                <span className='shrink-0 text-foreground text-sm tabular-nums'>
                  {formatCurrency(refund.amountMinor, currencyCode)}
                </span>
              }
            />
          )}
        />
      )}

      {vendorRecordId && (
        <ApplyVendorCreditDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          vendorCreditRecordId={recordId}
          vendorRecordId={vendorRecordId}
          balance={balanceMinor}
          currencyCode={currencyCode}
          onApplied={invalidate}
        />
      )}
      <RefundVendorCreditDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        vendorCreditRecordId={recordId}
        balance={balanceMinor}
        currencyCode={currencyCode}
        onRefunded={invalidate}
      />
      <ConfirmDialog />
    </div>
  )
}
