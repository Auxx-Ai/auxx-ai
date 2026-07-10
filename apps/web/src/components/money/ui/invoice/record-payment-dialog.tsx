// apps/web/src/components/money/ui/invoice/record-payment-dialog.tsx
'use client'

// Record-payment dialog (money MI1 build spec §J.3, the 01-ui #11 lock) — the
// `add-binding-dialog.tsx` FieldPanel recipe applied to a single-page form. Amount is
// prefilled with the invoice's current balance; all money fields are integer cents at the
// edge (the `FieldType.CURRENCY` convention — `FieldInputAdapter` already speaks cents, no
// manual conversion needed here unlike the line builder's raw `CurrencyInput` cell).

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
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from './payment-method-options'

interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceRecordId: RecordId
  /** Current invoice balance in integer cents — the amount prefill. */
  balance: number
  currencyCode: string
  onRecorded?: () => void
}

function todayIso(): string {
  return new Date().toISOString()
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceRecordId,
  balance,
  currencyCode,
  onRecorded,
}: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  // Reset the draft to a fresh prefill every time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDate(todayIso())
    setMethod('cash')
    setReference('')
    setNote('')
  }, [open])

  const recordPayment = api.money.recordPayment.useMutation({
    onError: (error) =>
      toastError({ title: 'Error recording payment', description: error.message }),
  })

  const canSave = !!amount && amount > 0 && amount <= balance

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    try {
      await recordPayment.mutateAsync({
        invoiceRecordId,
        amount,
        date: date.split('T')[0]!,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      })
      onRecorded?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Log a cash, check, card, or bank payment.</DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='record-payment-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={recordPayment.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Date' type={BaseType.DATE} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={date}
              onChange={(val) => setDate(val as string)}
              disabled={recordPayment.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Method' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: [...PAYMENT_METHOD_OPTIONS] }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={method}
              onChange={(val) => setMethod(((val as string[])[0] as PaymentMethod) ?? 'cash')}
              disabled={recordPayment.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reference}
              onChange={(val) => setReference(val as string)}
              placeholder='Check #, last 4, …'
              disabled={recordPayment.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Note' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={note}
              onChange={(val) => setNote(val as string)}
              fieldOptions={{ multiline: true }}
              disabled={recordPayment.isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={recordPayment.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={recordPayment.isPending}
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
