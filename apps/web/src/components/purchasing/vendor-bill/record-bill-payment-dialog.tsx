// apps/web/src/components/purchasing/vendor-bill/record-bill-payment-dialog.tsx
'use client'

// Paying a vendor bill — the `record-payment-dialog.tsx` recipe with the sides
// flipped. It records a `vendor_payment` movement and posts `Dr A/P / Cr <the
// endpoint>`; the bill's `amount_paid` / `paid_at` / `status` follow as a
// projection (task 71 D7), never as a hand-written field.

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  cashEndpointOptions,
  cashEndpointValueOf,
  UNDEPOSITED_VALUE,
} from '~/components/money/ui/cash-endpoint-select'
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from '~/components/money/ui/invoice/payment-method-options'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface RecordBillPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  billRecordId: RecordId
  /** Bill total, integer minor units. */
  total: number
  /** Already settled before this payment, integer minor units. */
  amountPaid: number
  /** Already cancelled by a vendor credit or an earlier discount, integer minor units. */
  amountSettledOtherwise?: number
  currencyCode: string
  onSaved?: () => void
}

function todayIso(): string {
  return new Date().toISOString()
}

export function RecordBillPaymentDialog({
  open,
  onOpenChange,
  billRecordId,
  total,
  amountPaid,
  amountSettledOtherwise = 0,
  currencyCode,
  onSaved,
}: RecordBillPaymentDialogProps) {
  const balance = total - amountPaid - amountSettledOtherwise
  const [amount, setAmount] = useState<number | null>(balance)
  const [discount, setDiscount] = useState<number | null>(null)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('bank')
  const [reference, setReference] = useState('')
  const [paidFrom, setPaidFrom] = useState<string>(UNDEPOSITED_VALUE)

  const { data: destinations } = api.money.paymentDestinations.useQuery(undefined, {
    enabled: open,
  })

  const commandKey = useRef<string | null>(null)
  // Undeposited funds is not a sensible default for money going OUT: the first
  // bank account is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDiscount(null)
    setDate(todayIso())
    setMethod('bank')
    setReference('')
    commandKey.current = crypto.randomUUID()
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the default follows the first account once it lands.
  useEffect(() => {
    if (!open) return
    const first = destinations?.bankAccounts[0]
    setPaidFrom(first ? `bank:${first.id}` : UNDEPOSITED_VALUE)
  }, [open, destinations])

  const utils = api.useUtils()
  const recordBillPayment = api.money.recordBillPayment.useMutation({
    onError: (error) =>
      toastError({ title: 'Error recording payment', description: error.message }),
  })

  const discountTaken = discount ?? 0
  // The vendor is relieved of the money AND the discount, so the two together
  // are what the balance caps — the server refuses the same sum.
  const canSave = !!amount && amount > 0 && discountTaken >= 0 && amount + discountTaken <= balance

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    try {
      await recordBillPayment.mutateAsync({
        vendorBillRecordId: billRecordId,
        amount,
        discount: discountTaken || undefined,
        date: date.split('T')[0]!,
        method,
        ...cashEndpointValueOf(paidFrom),
        reference: reference.trim() || undefined,
        commandKey: commandKey.current ?? crypto.randomUUID(),
      })
      await utils.money.billPayments.invalidate({ vendorBillRecordId: billRecordId })
      onSaved?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const isPending = recordBillPayment.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Pay some or all of this bill. The payment is recorded and posted to the ledger.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='record-bill-payment-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Discount taken' type={BaseType.CURRENCY} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={discount}
              onChange={(val) => setDiscount(val as number | null)}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Paid on' type={BaseType.DATE} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={date}
              onChange={(val) => setDate(val as string)}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Method' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: [...PAYMENT_METHOD_OPTIONS] }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={method}
              onChange={(val) => setMethod(((val as string[])[0] as PaymentMethod) ?? 'bank')}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Paid from' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: cashEndpointOptions(destinations) }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={paidFrom}
              onChange={(val) => setPaidFrom((val as string[])[0] ?? UNDEPOSITED_VALUE)}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reference}
              onChange={(val) => setReference(val as string)}
              placeholder='Check no. / ACH trace'
              disabled={isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Recording...'
            disabled={!canSave}
            data-dialog-submit>
            Record payment <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
