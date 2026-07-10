// apps/web/src/components/money/ui/invoice/invoice-payments-card.tsx
'use client'

// Invoice drawer's "Payments" tab card — registered as 'invoice:payments' (money MI1 build
// spec §J.1). Lists the `PaymentTransaction` ledger rows (`money.listPayments` — reads the
// ledger, not the `payment` entity mirrors, so future Stripe rows show with zero UI change),
// admin-gated delete (decision 8), and the "Record payment" footer action (§J.3).

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useAdminGate } from '~/components/global/admin-gate'
import { EmptyState } from '~/components/global/empty-state'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { paymentMethodLabel } from './payment-method-options'
import { RecordPaymentDialog } from './record-payment-dialog'

const INVOICE_ATTRS = ['invoice_status', 'invoice_balance'] as const

export function InvoicePaymentsCard({ recordId }: DrawerTabProps) {
  const { allowed: isAdmin } = useAdminGate()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { values } = useSystemValues(recordId, [...INVOICE_ATTRS], { autoFetch: true })
  const status = (values.invoice_status as string | undefined) ?? 'draft'
  const balance = (values.invoice_balance as number | null | undefined) ?? 0

  const utils = api.useUtils()
  const { data: payments, isLoading } = api.money.listPayments.useQuery({
    invoiceRecordId: recordId,
  })

  const deletePayment = api.money.deletePayment.useMutation({
    onSuccess: () => {
      void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
    },
    onError: (error) => toastError({ title: 'Error deleting payment', description: error.message }),
  })

  const handleDelete = async (transactionId: string) => {
    const confirmed = await confirm({
      title: 'Delete this payment?',
      description: 'Invoice balance will be recalculated.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deletePayment.mutate({ transactionId })
  }

  const canRecordPayment = status !== 'void' && balance > 0

  return (
    <div className='flex flex-col gap-2'>
      {isLoading ? (
        <div className='space-y-1.5'>
          <Skeleton className='h-8 w-full' />
          <Skeleton className='h-8 w-full' />
        </div>
      ) : !payments?.length ? (
        <EmptyState title='No payments recorded' description='Record a payment to get started.' />
      ) : (
        <div className='flex flex-col divide-y divide-primary-200/50 dark:divide-[#1e2227]'>
          {payments.map((payment) => (
            <div key={payment.id} className='group flex items-center gap-2 py-1.5 text-sm'>
              <span className='w-24 shrink-0 tabular-nums text-muted-foreground'>
                {format(new Date(payment.date), 'MMM d, yyyy')}
              </span>
              <span className='w-28 shrink-0 truncate text-muted-foreground'>
                {paymentMethodLabel(payment.method ?? 'other')}
              </span>
              <span className='min-w-0 flex-1 truncate text-muted-foreground text-xs'>
                {payment.reference ?? ''}
              </span>
              <span className='shrink-0 tabular-nums'>
                {formatCurrency(payment.amount, currencyCode)}
              </span>
              {isAdmin && (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='shrink-0 text-destructive/70 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100'
                  loading={deletePayment.isPending}
                  onClick={() => handleDelete(payment.id)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canRecordPayment && (
        <Button
          variant='outline'
          size='sm'
          className='self-start'
          onClick={() => setDialogOpen(true)}>
          Record payment
        </Button>
      )}

      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoiceRecordId={recordId}
        balance={balance}
        currencyCode={currencyCode}
        onRecorded={() => {
          void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
        }}
      />

      <ConfirmDialog />
    </div>
  )
}
