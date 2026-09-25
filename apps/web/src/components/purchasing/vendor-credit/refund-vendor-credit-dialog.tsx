// apps/web/src/components/purchasing/vendor-credit/refund-vendor-credit-dialog.tsx
'use client'

// The supplier paying a vendor credit back — `refund-credit-dialog.tsx` with
// the parties swapped (71 §5 U7). The endpoint select says "Refunded to"
// because the money ARRIVES here rather than leaving, and it defaults to the
// first bank account rather than undeposited funds: a supplier's refund lands
// in an account, not in a drawer.

import { FieldType } from '@auxx/database/enums'
import { toCalendarDayIso } from '@auxx/lib/field-values/client'
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

interface RefundVendorCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendorCreditRecordId: RecordId
  /** The credit's current balance in integer minor units, the prefill and the cap. */
  balance: number
  currencyCode: string
  onRefunded?: () => void
}

/** Today as the DATE input's own value: the viewer's day at UTC midnight, never the UTC day. */
function todayIso(): string {
  return toCalendarDayIso(new Date())
}

export function RefundVendorCreditDialog({
  open,
  onOpenChange,
  vendorCreditRecordId,
  balance,
  currencyCode,
  onRefunded,
}: RefundVendorCreditDialogProps) {
  const [amount, setAmount] = useState<number | null>(balance)
  const [date, setDate] = useState<string>(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('bank')
  const [reference, setReference] = useState('')
  const [refundedTo, setRefundedTo] = useState<string>(UNDEPOSITED_VALUE)

  const { data: destinations } = api.money.paymentDestinations.useQuery(undefined, {
    enabled: open,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setAmount(balance)
    setDate(todayIso())
    setMethod('bank')
    setReference('')
    setRefundedTo(UNDEPOSITED_VALUE)
  }, [open])

  // A supplier's refund arrives somewhere; default to the first bank account
  // rather than undeposited funds, which is a customer-cash idea.
  useEffect(() => {
    if (!open || refundedTo !== UNDEPOSITED_VALUE) return
    const first = destinations?.bankAccounts?.[0]
    if (first) setRefundedTo(`bank:${first.id}`)
  }, [open, destinations, refundedTo])

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

  const refund = api.purchasing.vendorCredit.refund.useMutation({
    onError: (error) => toastError({ title: 'Error recording refund', description: error.message }),
  })

  const canSave = !!amount && amount > 0 && amount <= balance

  const handleSubmit = async () => {
    if (!canSave || !amount) return
    try {
      await refund.mutateAsync({
        commandKey: refundCommandKey([
          vendorCreditRecordId,
          amount,
          method,
          refundedTo,
          reference,
          date,
        ]),
        vendorCreditRecordId,
        amount,
        method,
        ...cashEndpointValueOf(refundedTo),
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
          <DialogTitle>Record supplier refund</DialogTitle>
          <DialogDescription>
            The supplier has paid some or all of this credit back. The refund is recorded and posted
            to the ledger.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='refund-vendor-credit-form'
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
              onChange={(val) => setMethod(((val as string[])[0] as PaymentMethod) ?? 'bank')}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Refunded to' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: cashEndpointOptions(destinations) }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={refundedTo}
              onChange={(val) => setRefundedTo((val as string[])[0] ?? UNDEPOSITED_VALUE)}
              disabled={refund.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Reference' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={reference}
              onChange={(val) => setReference(val as string)}
              placeholder='Check #, ACH id, ...'
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
            loadingText='Recording...'
            disabled={!canSave}
            data-dialog-submit>
            Record refund <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
