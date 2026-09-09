// apps/web/src/components/money/ui/invoice/invoice-payments-card.tsx
'use client'

// Invoice drawer's "Payments" tab card — registered as 'invoice:payments' (money MI1 build
// spec §J.1; money MP1 build spec §K adds the provider-aware per-row action). Thin wrapper:
// owns the queries/mutations/confirms and the "Record payment" footer action, and renders the
// shared `PaymentsList` (money plan 10 §B) for the row markup.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useAdminGate } from '~/components/global/admin-gate'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { PaymentsList } from '~/components/money/ui/payments/payments-list'
import { useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { RecordPaymentDialog } from './record-payment-dialog'
import { WriteOffDialog } from './write-off-dialog'

// `invoice_contact` feeds the record-payment dialog's credit lookup, and
// `invoice_amount_credited` is the credit already netted out of `invoice_balance`
// (plans/accounting/tasks/10-credit-memos.md §2.3), shown so the balance adds up.
const INVOICE_ATTRS = [
  'invoice_status',
  'invoice_balance',
  'invoice_amount_credited',
  'invoice_contact',
] as const

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
  const amountCredited = (values.invoice_amount_credited as number | null | undefined) ?? 0
  const contactRecordId = extractRelationshipRecordIds(values.invoice_contact)[0]

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

      {amountCredited > 0 && (
        <div className='flex flex-col gap-0.5 px-2 text-xs text-muted-foreground'>
          <div className='flex justify-between'>
            <span>Credit applied</span>
            <span className='tabular-nums'>-{formatCurrency(amountCredited, currencyCode)}</span>
          </div>
          <div className='flex justify-between font-medium text-foreground'>
            <span>Balance due</span>
            <span className='tabular-nums'>{formatCurrency(balance, currencyCode)}</span>
          </div>
        </div>
      )}

      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoiceRecordId={recordId}
        contactRecordId={contactRecordId}
        balance={balance}
        currencyCode={currencyCode}
        onRecorded={() => {
          void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
          if (contactRecordId) {
            void utils.creditMemo.contactCredit.invalidate({ contactRecordId })
          }
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
