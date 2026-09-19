// apps/web/src/components/money/ui/credit-memo/refund-credit-dialog.tsx
'use client'

// Refund-credit dialog (plans/accounting/tasks/done/10-credit-memos.md §6.2), the
// `record-payment-dialog.tsx` FieldPanel recipe. Recorded by hand with a method,
// reference, date and the endpoint the money left by — prefilled from the newest
// receipt on the memo's invoice. Amount prefilled to the memo's balance.
//
// The Stripe rail (refunding straight onto the linked invoice's original charge)
// went with the legacy `PaymentTransaction` lane it refunded (accounting migration
// step 0) — refunding a customer is manual-only until a native Stripe refund door
// is rebuilt on the money model.

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
  cashEndpointValueFor,
  cashEndpointValueOf,
  UNDEPOSITED_VALUE,
} from '~/components/money/ui/cash-endpoint-select'
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from '~/components/money/ui/invoice/payment-method-options'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface RefundCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  creditMemoRecordId: RecordId
  /** The memo's current balance in integer minor units, the prefill and the cap. */
  balance: number
  currencyCode: string
  onRefunded?: () => void
}

function todayIso(): string {
  return new Date().toISOString()
}

export function RefundCreditDialog({
  open,
  onOpenChange,
  creditMemoRecordId,
  balance,
  currencyCode,
  onRefunded,
}: RefundCreditDialogProps) {
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [refundedFrom, setRefundedFrom] = useState<string>(UNDEPOSITED_VALUE)

  const { data: destinations } = api.money.paymentDestinations.useQuery(undefined, {
    enabled: open,
  })
  const { data: prefill } = api.creditMemo.refundEndpoint.useQuery(
    { creditMemoRecordId },
    { enabled: open }
  )

  // Reset the draft every time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDate(todayIso())
    setMethod('cash')
    setReference('')
    setRefundedFrom(UNDEPOSITED_VALUE)
  }, [open])

  // The receipt this refund settles lands after the dialog opens; it is a prefill
  // the person may change, not a constraint.
  useEffect(() => {
    if (!open || !prefill) return
    setRefundedFrom(cashEndpointValueFor(prefill))
  }, [open, prefill])

  const refundKeys = useRef(new Map<string, string>())
  useEffect(() => {
    if (!open) refundKeys.current.clear()
  }, [open])
  const refundCommandKey = (payload: unknown) => {
    const signature = JSON.stringify(payload)
    const previous = refundKeys.current.get(signature)
    if (previous) return previous
    const key = crypto.randomUUID()
    refundKeys.current.set(signature, key)
    return key
  }

  const refund = api.creditMemo.refund.useMutation({
    onError: (error) => toastError({ title: 'Error refunding credit', description: error.message }),
  })

  const canSave = !!amount && amount > 0 && amount <= balance

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    try {
      await refund.mutateAsync({
        commandKey: refundCommandKey([
          creditMemoRecordId,
          amount,
          method,
          refundedFrom,
          reference,
          date,
        ]),
        creditMemoRecordId,
        amount,
        method,
        ...cashEndpointValueOf(refundedFrom),
        reference: reference.trim() || undefined,
        date: date.split('T')[0]!,
      })
      onRefunded?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Refund credit</DialogTitle>
          <DialogDescription>
            Pay some or all of this credit back. The refund is recorded as a payment and posted to
            the ledger.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='refund-credit-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Date' type={BaseType.DATE} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={date}
              onChange={(val) => setDate(val as string)}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Method' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: [...PAYMENT_METHOD_OPTIONS] }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={method}
              onChange={(val) => setMethod(((val as string[])[0] as PaymentMethod) ?? 'cash')}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Refunded from' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: cashEndpointOptions(destinations) }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={refundedFrom}
              onChange={(val) => setRefundedFrom((val as string[])[0] ?? UNDEPOSITED_VALUE)}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reference}
              onChange={(val) => setReference(val as string)}
              placeholder='Check #, last 4, ...'
              disabled={refund.isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={refund.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={refund.isPending}
            loadingText='Refunding...'
            disabled={!canSave}
            data-dialog-submit>
            Refund <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
