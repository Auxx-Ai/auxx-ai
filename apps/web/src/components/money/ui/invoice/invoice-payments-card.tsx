// apps/web/src/components/money/ui/invoice/invoice-payments-card.tsx
'use client'

// Invoice drawer's "Payments" tab card — registered as 'invoice:payments' (money MI1 build
// spec §J.1; money MP1 build spec §K adds the provider-aware per-row action). Thin wrapper:
// owns the queries/mutations/confirms and the "Record payment" footer action, and renders the
// shared `PaymentsList` (money plan 10 §B) for the row markup.

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useAdminGate } from '~/components/global/admin-gate'
import { PaymentsList } from '~/components/money/ui/payments/payments-list'
import { useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { RecordPaymentDialog } from './record-payment-dialog'
import { WriteOffDialog } from './write-off-dialog'

const INVOICE_ATTRS = ['invoice_status', 'invoice_balance'] as const

export function InvoicePaymentsCard({ recordId }: DrawerTabProps) {
  const { allowed: isAdmin } = useAdminGate()
  const { can } = useAccess()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [writeOffOpen, setWriteOffOpen] = useState(false)

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

  const refundTransaction = api.money.refundTransaction.useMutation({
    onSuccess: () => {
      void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
    },
    onError: (error) =>
      toastError({ title: 'Error refunding payment', description: error.message }),
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

  const handleRefund = async (transactionId: string) => {
    const confirmed = await confirm({
      title: 'Refund this payment in full?',
      description: 'The platform fee is refunded too.',
      confirmText: 'Refund',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) refundTransaction.mutate({ transactionId })
  }

  const canRecordPayment = status !== 'void' && balance > 0
  // A write-off is a ledger post (HANDOFF slot 2K): gated on `ledger.post`,
  // and only while there is a balance left to write off.
  const canWriteOff = canRecordPayment && can('ledger.post')

  return (
    <div className='flex flex-col gap-2'>
      {canRecordPayment && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setDialogOpen(true)}>
            <Plus />
            Record payment
          </Button>
          {canWriteOff && (
            <Button variant='ghost' size='xs' onClick={() => setWriteOffOpen(true)}>
              Write off
            </Button>
          )}
        </DrawerCardActions>
      )}

      <PaymentsList
        payments={payments}
        isLoading={isLoading}
        currencyCode={currencyCode}
        isAdmin={isAdmin}
        onDelete={handleDelete}
        onRefund={handleRefund}
        deletePending={deletePayment.isPending}
        refundPending={refundTransaction.isPending}
      />

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

      <WriteOffDialog
        open={writeOffOpen}
        onOpenChange={setWriteOffOpen}
        invoiceRecordId={recordId}
        balanceMinor={balance}
        currencyCode={currencyCode}
        onWrittenOff={() => {
          void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
        }}
      />

      <ConfirmDialog />
    </div>
  )
}
