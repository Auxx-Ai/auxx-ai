// apps/web/src/components/purchasing/vendor-credit/apply-vendor-credit-dialog.tsx
'use client'

// Apply a vendor credit to one of the supplier's open bills — the buy-side
// mirror of `apply-credit-dialog.tsx` (71 §5 U7). An application moves no
// money: it is one `vendor_credit_application` row, and the bill's balance and
// payment status learn to subtract it.

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/types/resource'
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface ApplyVendorCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendorCreditRecordId: RecordId
  /** The credit's vendor, whose open bills are the only ones offered. */
  vendorRecordId: RecordId
  /** The credit's current balance in integer minor units, the cap on the amount. */
  balance: number
  currencyCode: string
  onApplied?: () => void
}

export function ApplyVendorCreditDialog({
  open,
  onOpenChange,
  vendorCreditRecordId,
  vendorRecordId,
  balance,
  currencyCode,
  onApplied,
}: ApplyVendorCreditDialogProps) {
  const [billInstanceId, setBillInstanceId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)

  const billsQuery = api.purchasing.vendorCredit.openBills.useQuery(
    { vendorRecordId },
    { enabled: open }
  )
  const bills = billsQuery.data ?? []

  const selected = useMemo(
    () => bills.find((bill) => bill.vendorBillInstanceId === billInstanceId) ?? null,
    [bills, billInstanceId]
  )
  // The most that can go against the picked bill: neither side may go negative.
  const cap = selected ? Math.min(selected.balanceMinor, balance) : balance

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init when the dialog opens or the list arrives.
  useEffect(() => {
    if (!open) return
    const only = bills.length === 1 ? bills[0]! : null
    setBillInstanceId(only?.vendorBillInstanceId ?? null)
    setAmount(only ? Math.min(only.balanceMinor, balance) : null)
  }, [open, bills.length])

  const applyKeys = useRef(new Map<string, string>())
  useEffect(() => {
    if (!open) applyKeys.current.clear()
  }, [open])
  const applyCommandKey = (payload: unknown) => {
    const signature = JSON.stringify(payload)
    const previous = applyKeys.current.get(signature)
    if (previous) return previous
    const key = crypto.randomUUID()
    applyKeys.current.set(signature, key)
    return key
  }

  const apply = api.purchasing.vendorCredit.apply.useMutation({
    onError: (error) => toastError({ title: 'Error applying credit', description: error.message }),
  })

  const canSave = !!billInstanceId && !!amount && amount > 0 && amount <= cap

  const handleSubmit = async () => {
    if (!canSave || !amount || !billInstanceId) return
    try {
      await apply.mutateAsync({
        commandKey: applyCommandKey([vendorCreditRecordId, billInstanceId, amount]),
        vendorCreditRecordId,
        vendorBillRecordId: toRecordId('vendor_bill', billInstanceId),
        amount,
      })
      onApplied?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Apply credit</DialogTitle>
          <DialogDescription>
            Put some or all of this credit against one of the supplier's open bills. No money moves;
            the bill owes less.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='apply-vendor-credit-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Bill' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{
                options: bills.map((bill) => ({
                  id: bill.vendorBillInstanceId,
                  value: bill.vendorBillInstanceId,
                  label: `${bill.number} · ${formatCurrency(bill.balanceMinor, currencyCode)} owed`,
                })),
              }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={billInstanceId}
              onChange={(val) => {
                const next = (val as string[])[0] ?? null
                setBillInstanceId(next)
                const bill = bills.find((row) => row.vendorBillInstanceId === next)
                setAmount(bill ? Math.min(bill.balanceMinor, balance) : null)
              }}
              disabled={apply.isPending || bills.length === 0}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={apply.isPending || !billInstanceId}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={apply.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={apply.isPending}
            loadingText='Applying...'
            disabled={!canSave}
            data-dialog-submit>
            Apply <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
