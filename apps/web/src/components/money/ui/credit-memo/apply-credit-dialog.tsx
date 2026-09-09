// apps/web/src/components/money/ui/credit-memo/apply-credit-dialog.tsx
'use client'

// Apply-credit dialog (plans/accounting/tasks/10-credit-memos.md §6.2), the
// `record-payment-dialog.tsx` FieldPanel recipe: pick one of the contact's open
// invoices (`creditMemo.openInvoices`, the `OpenInvoiceRow` shape from
// `money/credit-memos/client.ts`), amount prefilled to min(invoice open balance,
// memo balance). An application moves no money (§3.3): it is one
// `credit_memo_application` row, and the invoice's balance learns to subtract it.

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
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface ApplyCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  creditMemoRecordId: RecordId
  /** The memo's contact, whose open invoices are the only ones offered. */
  contactRecordId: RecordId
  /** The memo's current balance in integer minor units, the cap on the amount. */
  balance: number
  currencyCode: string
  onApplied?: () => void
}

export function ApplyCreditDialog({
  open,
  onOpenChange,
  creditMemoRecordId,
  contactRecordId,
  balance,
  currencyCode,
  onApplied,
}: ApplyCreditDialogProps) {
  const [invoiceInstanceId, setInvoiceInstanceId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)

  const invoicesQuery = api.creditMemo.openInvoices.useQuery({ contactRecordId }, { enabled: open })
  const invoices = invoicesQuery.data ?? []

  const selected = useMemo(
    () => invoices.find((invoice) => invoice.invoiceInstanceId === invoiceInstanceId) ?? null,
    [invoices, invoiceInstanceId]
  )
  // The most that can go against the picked invoice: neither side may go negative.
  const cap = selected ? Math.min(selected.balanceMinor, balance) : balance

  // Reset the draft every time the dialog opens; preselect the only open
  // invoice when there is exactly one, the common case from the invoice
  // drawer's own Credit action.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens or the list arrives.
  useEffect(() => {
    if (!open) return
    const only = invoices.length === 1 ? invoices[0] : null
    setInvoiceInstanceId(only?.invoiceInstanceId ?? null)
    setAmount(only ? Math.min(only.balanceMinor, balance) : null)
  }, [open, invoices.length])

  const applyCredit = api.creditMemo.applyCredit.useMutation({
    onError: (error) => toastError({ title: 'Error applying credit', description: error.message }),
  })

  const canSave = !!invoiceInstanceId && !!amount && amount > 0 && amount <= cap

  const handleSubmit = async () => {
    if (!canSave || !invoiceInstanceId || !amount) return
    try {
      await applyCredit.mutateAsync({
        creditMemoRecordId,
        invoiceRecordId: toRecordId('invoice', invoiceInstanceId),
        amount,
      })
      onApplied?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const invoiceOptions = invoices.map((invoice) => ({
    value: invoice.invoiceInstanceId,
    label: `${invoice.number} (${formatCurrency(invoice.balanceMinor, currencyCode)} open)`,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Apply credit to invoice</DialogTitle>
          <DialogDescription>
            Reduce an open invoice&apos;s balance by this credit. No money moves.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='apply-credit-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Invoice' type={BaseType.ENUM} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: invoiceOptions }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              placeholder={
                invoicesQuery.isLoading
                  ? 'Loading open invoices...'
                  : invoices.length === 0
                    ? 'No open invoices for this contact'
                    : 'Pick an invoice'
              }
              value={invoiceInstanceId}
              onChange={(val) => {
                const next = (val as string[])[0] ?? null
                setInvoiceInstanceId(next)
                const invoice = invoices.find((row) => row.invoiceInstanceId === next)
                setAmount(invoice ? Math.min(invoice.balanceMinor, balance) : null)
              }}
              disabled={applyCredit.isPending || invoices.length === 0}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amount}
              onChange={(val) => setAmount(val as number | null)}
              disabled={applyCredit.isPending || !invoiceInstanceId}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={applyCredit.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={applyCredit.isPending}
            loadingText='Applying...'
            disabled={!canSave}
            data-dialog-submit>
            Apply credit <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
