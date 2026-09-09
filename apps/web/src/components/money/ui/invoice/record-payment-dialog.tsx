// apps/web/src/components/money/ui/invoice/record-payment-dialog.tsx
'use client'

// Record-payment dialog (money MI1 build spec §J.3, the 01-ui #11 lock) — the
// `add-binding-dialog.tsx` FieldPanel recipe applied to a single-page form. Amount is
// prefilled with the invoice's current balance; all money fields are integer cents at the
// edge (the `FieldType.CURRENCY` convention — `FieldInputAdapter` already speaks cents, no
// manual conversion needed here unlike the line builder's raw `CurrencyInput` cell).
//
// When the invoice's contact has credit available (issued credit memos with balance,
// plans/accounting/tasks/10-credit-memos.md §6.1), an `Apply credit` section comes first:
// on by default, prefilled to min(credit, balance). Confirm applies the credit oldest memo
// first (one `creditMemo.applyCredit` per planned memo, the `planCreditApplication` shape), then
// records a payment only for whatever remainder is greater than zero. The deposit
// application already reads this way to the user.

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
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
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from './payment-method-options'

interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceRecordId: RecordId
  /** The invoice's contact: the party whose credit memos may be applied first. Omit (an
   * invoice with no contact) and the dialog is the plain payment form. */
  contactRecordId?: RecordId
  /** Current invoice balance in integer cents — the amount prefill. */
  balance: number
  currencyCode: string
  onRecorded?: () => void
}

/** One issued memo with credit on it, as `creditMemo.contactCredit` lists them. */
interface CreditMemoWithBalance {
  creditMemoRecordId: RecordId
  balance: number
  issuedAt: string | null
}

/**
 * Oldest issued memo first, each capped at min(memo balance, what is left to apply): the
 * `planCreditApplication` shape from `money/credit-memos` (§5.2), kept here in its client
 * form so the dialog needs no server module.
 */
function planApplications(
  memos: readonly CreditMemoWithBalance[],
  amount: number
): Array<{ creditMemoRecordId: RecordId; amount: number }> {
  const ordered = [...memos].sort((a, b) => {
    if (a.issuedAt === b.issuedAt) return 0
    if (a.issuedAt === null) return 1
    if (b.issuedAt === null) return -1
    return a.issuedAt < b.issuedAt ? -1 : 1
  })
  const planned: Array<{ creditMemoRecordId: RecordId; amount: number }> = []
  let remaining = Math.floor(amount)
  for (const memo of ordered) {
    if (remaining <= 0) break
    const available = Math.floor(memo.balance)
    if (available <= 0) continue
    const step = Math.min(available, remaining)
    planned.push({ creditMemoRecordId: memo.creditMemoRecordId, amount: step })
    remaining -= step
  }
  return planned
}

function todayIso(): string {
  return new Date().toISOString()
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceRecordId,
  contactRecordId,
  balance,
  currencyCode,
  onRecorded,
}: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [applyCredit, setApplyCredit] = useState(true)
  const [creditAmount, setCreditAmount] = useState<number | null>(null)

  const { data: credit } = api.creditMemo.contactCredit.useQuery(
    { contactRecordId: contactRecordId as RecordId },
    { enabled: open && Boolean(contactRecordId) }
  )
  const creditAvailable = contactRecordId ? (credit?.available ?? 0) : 0
  const memos = useMemo<CreditMemoWithBalance[]>(
    () =>
      (credit?.memos ?? []).map((memo) => ({
        creditMemoRecordId: memo.creditMemoRecordId,
        balance: memo.balance,
        issuedAt: memo.issuedAt,
      })),
    [credit]
  )
  const maxCredit = Math.min(creditAvailable, balance)

  // Reset the draft to a fresh prefill every time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDate(todayIso())
    setMethod('cash')
    setReference('')
    setNote('')
    setApplyCredit(true)
    setCreditAmount(null)
  }, [open])

  // The credit lookup lands after the dialog opens: prefill the credit section once it
  // does, and keep the payment amount as "whatever the credit does not cover".
  useEffect(() => {
    if (!open) return
    setCreditAmount(maxCredit > 0 ? maxCredit : null)
  }, [open, maxCredit])

  const creditApplied = applyCredit && maxCredit > 0 ? (creditAmount ?? 0) : 0
  const remainder = Math.max(0, balance - creditApplied)

  // Follow the credit figure with the payment prefill; the user may still edit it after.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the payment prefill tracks the credit figure only.
  useEffect(() => {
    if (!open) return
    setAmount(remainder)
  }, [remainder])

  const applyCreditMemo = api.creditMemo.applyCredit.useMutation({
    onError: (error) => toastError({ title: 'Error applying credit', description: error.message }),
  })
  const recordPayment = api.money.recordPayment.useMutation({
    onError: (error) =>
      toastError({ title: 'Error recording payment', description: error.message }),
  })
  const isPending = applyCreditMemo.isPending || recordPayment.isPending

  const creditValid = creditApplied >= 0 && creditApplied <= maxCredit
  const paymentAmount = amount ?? 0
  const paymentValid = paymentAmount >= 0 && paymentAmount <= remainder
  const canSave = creditValid && paymentValid && creditApplied + paymentAmount > 0

  const handleSubmit = async () => {
    if (!canSave) return
    try {
      for (const step of planApplications(memos, creditApplied)) {
        await applyCreditMemo.mutateAsync({
          creditMemoRecordId: step.creditMemoRecordId,
          invoiceRecordId,
          amount: step.amount,
        })
      }
      if (paymentAmount > 0) {
        await recordPayment.mutateAsync({
          invoiceRecordId,
          amount: paymentAmount,
          date: date.split('T')[0]!,
          method,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        })
      }
      onRecorded?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const showCredit = maxCredit > 0
  const showPayment = !showCredit || !applyCredit || remainder > 0
  const submitLabel = paymentAmount > 0 || !showCredit ? 'Record payment' : 'Apply credit'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {showCredit
              ? `${formatCurrency(creditAvailable, currencyCode)} of credit is available for this customer.`
              : 'Log a cash, check, card, or bank payment.'}
          </DialogDescription>
        </DialogHeader>

        {showCredit && (
          <FieldPanel
            orientation='responsive'
            breakpoint='md'
            resizeId='record-payment-form'
            defaultLabelWidth={110}
            className='p-0'>
            <FieldPanelRow title='Apply credit' type={BaseType.BOOLEAN} showIcon>
              <div className='flex h-8 items-center gap-2 text-sm'>
                <Checkbox
                  checked={applyCredit}
                  onCheckedChange={(checked) => setApplyCredit(checked === true)}
                  disabled={isPending}
                />
                <span className='text-muted-foreground'>Use credit before recording a payment</span>
              </div>
            </FieldPanelRow>
            {applyCredit && (
              <FieldPanelRow title='Credit' type={BaseType.CURRENCY} showIcon isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.CURRENCY}
                  fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                  value={creditAmount}
                  onChange={(val) => setCreditAmount(val as number | null)}
                  disabled={isPending}
                />
              </FieldPanelRow>
            )}
          </FieldPanel>
        )}

        {showPayment && (
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
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Date' type={BaseType.DATE} showIcon isRequired>
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
                onChange={(val) => setMethod(((val as string[])[0] as PaymentMethod) ?? 'cash')}
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={reference}
                onChange={(val) => setReference(val as string)}
                placeholder='Check #, last 4, …'
                disabled={isPending}
              />
            </FieldPanelRow>

            <FieldPanelRow title='Note' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={note}
                onChange={(val) => setNote(val as string)}
                fieldOptions={{ multiline: true }}
                disabled={isPending}
              />
            </FieldPanelRow>
          </FieldPanel>
        )}

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
            loadingText={applyCreditMemo.isPending ? 'Applying credit...' : 'Recording...'}
            disabled={!canSave}
            data-dialog-submit>
            {submitLabel} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
