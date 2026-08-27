// apps/web/src/components/purchasing/vendor-bill/mark-bill-paid-dialog.tsx
'use client'

// Mark-a-vendor-bill-paid dialog — the `record-payment-dialog.tsx` FieldPanel recipe
// applied to the bill's own six payment fields (plans/purchasing/01-build-plan.md
// §5.3, decision P12).
//
// 🛑 It writes FIELDS, it does not create a payment record. `vendor_payment` and
// `vendor_payment_allocation` ship inert under P13 and `108-purchasing.test.ts` fails
// if any file in packages/lib so much as names them, so a payment object is not
// available to write and must not be improvised here.
//
// 🛑 It also does not POST. P12 says a ledger-mode org (no accounting provider)
// relieves A/P with `Dr 2000 / Cr 1000` when a bill is marked paid — but
// `post-entry.ts` is phase 7 and does not exist, so nothing here can fire it. The
// six fields are `creatable: true` and a human can already type them in the Details
// panel today; this dialog is that same write made convenient, and carries the same
// gap. See plans/purchasing/02-handoff.md §4.7.

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
import { useSaveSystemValues } from '~/components/resources/hooks'
import { BaseType } from '~/components/workflow/types'

interface MarkBillPaidDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  billRecordId: RecordId
  /** Bill total, integer minor units — the ceiling a payment settles against. */
  total: number
  /** Already settled before this payment, integer minor units. */
  amountPaid: number
  currencyCode: string
  onSaved?: () => void
}

function todayIso(): string {
  return new Date().toISOString()
}

export function MarkBillPaidDialog({
  open,
  onOpenChange,
  billRecordId,
  total,
  amountPaid,
  currencyCode,
  onSaved,
}: MarkBillPaidDialogProps) {
  const balance = total - amountPaid
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')

  const { save, isPending } = useSaveSystemValues(billRecordId)

  // Reset to a fresh prefill every time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDate(todayIso())
    setMethod('')
    setReference('')
  }, [open])

  const canSave = !!amount && amount > 0

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    const nextAmountPaid = amountPaid + amount
    const ok = await save({
      vendor_bill_paid_at: date,
      vendor_bill_amount_paid: nextAmountPaid,
      vendor_bill_payment_method: method.trim() || null,
      vendor_bill_payment_reference: reference.trim() || null,
      // P12: `manual` is a HUMAN confirming the payment. Never `rule` — that value
      // is reserved for a presumption, and the two must stay distinguishable.
      vendor_bill_paid_source: 'manual',
      // A fully settled bill becomes `paid`; a partial one becomes
      // `partially_paid`. Neither may be left reading `matched`: a bill with
      // $400 of $1,000 settled would otherwise be indistinguishable from one
      // nobody has paid a cent of, with the remaining balance visible only on
      // this card. Same discipline as `paidSource` — never let a partial fact
      // render as a complete one.
      ...(total > 0
        ? { vendor_bill_status: nextAmountPaid >= total ? 'paid' : 'partially_paid' }
        : {}),
    })
    if (!ok) {
      toastError({
        title: 'Error recording payment',
        description: 'The bill could not be updated.',
      })
      return
    }
    onSaved?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Mark paid</DialogTitle>
          <DialogDescription>
            Record what was paid against this bill. This does not post to the ledger.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='mark-bill-paid-form'
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

          <FieldPanelRow title='Paid on' type={BaseType.DATE} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.DATETIME}
              value={date}
              onChange={(val) => setDate(val as string)}
              disabled={isPending}
            />
          </FieldPanelRow>

          {/* Free text, not a select: `vendor_bill_payment_method` is FieldType.TEXT
              because the values have not settled yet (see the field's own note). */}
          <FieldPanelRow title='Method' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={method}
              onChange={(val) => setMethod(val as string)}
              placeholder='Check, ACH, card'
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
            loadingText='Saving...'
            disabled={!canSave}
            data-dialog-submit>
            Mark paid <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
