// apps/web/src/components/money/ui/credit-memo/refund-credit-dialog.tsx
'use client'

// Refund-credit dialog (plans/accounting/tasks/10-credit-memos.md §6.2), the
// `record-payment-dialog.tsx` FieldPanel recipe with a rail choice on top. The
// money leg of a native memo is a `PaymentTransaction` of `kind: 'refund'`
// (§5.3): back onto the original Stripe charge when the linked invoice has a
// succeeded one (partial allowed), else recorded by hand with a method,
// reference and date. Amount prefilled to the memo's balance.

import { FieldType } from '@auxx/database/enums'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
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
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { Banknote, CreditCard } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from '~/components/money/ui/invoice/payment-method-options'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useSystemValues } from '~/components/resources/hooks'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

type Rail = 'manual' | 'stripe'

const CREDIT_MEMO_ATTRS = ['credit_memo_invoice'] as const

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
  const [rail, setRail] = useState<Rail>('manual')
  const [chargeTransactionId, setChargeTransactionId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')

  // The Stripe rail exists only where the linked invoice took a Stripe charge
  // that succeeded. Read the link off the memo, then that invoice's ledger.
  const { values } = useSystemValues(creditMemoRecordId, [...CREDIT_MEMO_ATTRS], {
    autoFetch: true,
    enabled: open,
  })
  const invoiceRecordId = extractRelationshipRecordIds(values.credit_memo_invoice)[0] ?? null
  const paymentsQuery = api.money.listPayments.useQuery(
    { invoiceRecordId: invoiceRecordId as RecordId },
    { enabled: open && !!invoiceRecordId }
  )
  const stripeCharges = useMemo(
    () =>
      (paymentsQuery.data ?? []).filter(
        (payment) =>
          payment.provider === 'stripe' &&
          payment.kind === 'charge' &&
          payment.status === 'succeeded'
      ),
    [paymentsQuery.data]
  )
  const hasStripeCharge = stripeCharges.length > 0
  const selectedCharge =
    stripeCharges.find((charge) => charge.id === chargeTransactionId) ?? stripeCharges[0] ?? null

  // Reset the draft every time the dialog opens; default to the original
  // charge when there is one, since that is where the money came from.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens or the charges arrive.
  useEffect(() => {
    if (!open) return
    setRail(hasStripeCharge ? 'stripe' : 'manual')
    setChargeTransactionId(stripeCharges[0]?.id ?? null)
    setAmount(balance)
    setDate(todayIso())
    setMethod('cash')
    setReference('')
  }, [open, hasStripeCharge])

  const refund = api.creditMemo.refund.useMutation({
    onError: (error) => toastError({ title: 'Error refunding credit', description: error.message }),
  })

  // A Stripe refund cannot exceed the charge it goes back onto.
  const cap =
    rail === 'stripe' && selectedCharge ? Math.min(balance, selectedCharge.amount) : balance
  const canSave = !!amount && amount > 0 && amount <= cap && (rail === 'manual' || !!selectedCharge)

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    try {
      await refund.mutateAsync(
        rail === 'stripe'
          ? {
              creditMemoRecordId,
              amount,
              rail,
              chargeTransactionId: selectedCharge?.id,
            }
          : {
              creditMemoRecordId,
              amount,
              rail,
              method,
              reference: reference.trim() || undefined,
              date: date.split('T')[0]!,
            }
      )
      onRefunded?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const chargeOptions = stripeCharges.map((charge) => ({
    value: charge.id,
    label: `${formatCurrency(charge.amount, currencyCode)} on ${format(new Date(charge.date), 'MMM d, yyyy')}`,
  }))

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

        <RadioGroup value={rail} onValueChange={(next) => setRail(next as Rail)}>
          <RadioGroupItemCard
            value='stripe'
            icon={<CreditCard />}
            label='Original card payment'
            description={
              hasStripeCharge
                ? 'Refund onto the Stripe charge the linked invoice was paid with.'
                : 'The linked invoice has no succeeded Stripe charge to refund onto.'
            }
            disabled={!hasStripeCharge || refund.isPending}
          />
          <RadioGroupItemCard
            value='manual'
            icon={<Banknote />}
            label='Manual'
            description='Record a refund you paid by cash, check, card or bank transfer.'
            disabled={refund.isPending}
          />
        </RadioGroup>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='refund-credit-form'
          defaultLabelWidth={110}
          className='p-0'>
          {rail === 'stripe' && stripeCharges.length > 1 && (
            <FieldPanelRow title='Charge' type={BaseType.ENUM} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: chargeOptions }}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
                value={selectedCharge?.id ?? null}
                onChange={(val) => setChargeTransactionId((val as string[])[0] ?? null)}
                disabled={refund.isPending}
              />
            </FieldPanelRow>
          )}

          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          {rail === 'manual' && (
            <>
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

              <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={reference}
                  onChange={(val) => setReference(val as string)}
                  placeholder='Check #, last 4, ...'
                  disabled={refund.isPending}
                />
              </FieldPanelRow>
            </>
          )}
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
