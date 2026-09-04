// apps/web/src/components/money/ui/invoice/write-off-dialog.tsx
'use client'

// Write-off dialog (plans/accounting/HANDOFF.md slot 2K; ui-plan.md §3
// "Write-offs") — the `record-payment-dialog.tsx` FieldPanel recipe, widened
// with a live `EntryJournal`/`EntryBlockers` preview the way the JE drawer
// shows one before Post. Amount defaults to the invoice's whole balance; the
// expense account defaults to the `bad_debt_expense` role's mapped account but
// can be overridden to any expense account in the chart.

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
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import type { LedgerBlocker } from '~/components/accounting/ui/ledger/entry-blockers'
import { EntryBlockers } from '~/components/accounting/ui/ledger/entry-blockers'
import { EntryJournal } from '~/components/accounting/ui/ledger/entry-journal'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

/** The one role a write-off's debit leg defaults to. See `build-write-off-entry.ts`. */
const BAD_DEBT_EXPENSE_ROLE = 'bad_debt_expense'

const POSTED_STATUSES = new Set(['posted', 'already_posted', 'not_connected', 'disabled'])

interface WriteOffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceRecordId: RecordId
  /**
   * Current invoice balance in integer minor units - the prefill until
   * `money.writeOffState` answers with what is actually still outstanding.
   */
  balanceMinor: number
  currencyCode: string
  onWrittenOff?: () => void
}

/**
 * Write off an invoice's balance (or part of it) to bad debt.
 *
 * The preview (`money.previewWriteOff`) is a plain `useQuery`, not debounced:
 * a write-off is typed once and reviewed, not dragged like a slider, and the
 * lib read is a handful of indexed lookups — the same cost profile
 * `ledger.preview` already accepts un-debounced elsewhere in this module.
 */
export function WriteOffDialog({
  open,
  onOpenChange,
  invoiceRecordId,
  balanceMinor,
  currencyCode,
  onWrittenOff,
}: WriteOffDialogProps) {
  const [amountMinor, setAmountMinor] = useState<number | null>(balanceMinor)
  const [reason, setReason] = useState('')
  const [expenseAccountCode, setExpenseAccountCode] = useState<string | null>(null)

  // 🛑 The bound is what is still OUTSTANDING, never the invoice's mirrored
  // balance. A partial write-off leaves that mirror reading high, because
  // `syncInvoicePaymentState` re-derives it as `total - amountPaid` and knows
  // nothing about bad debt, so prefilling from it would offer to write the
  // first tranche off a second time, and the server would refuse the submit.
  const stateQuery = api.money.writeOffState.useQuery({ invoiceRecordId }, { enabled: open })
  const outstandingMinor = stateQuery.data?.outstandingMinor ?? balanceMinor

  // Reset the draft to a fresh prefill every time the dialog opens, and again
  // when the outstanding figure arrives.
  useEffect(() => {
    if (!open) return
    setAmountMinor(outstandingMinor)
    setReason('')
    setExpenseAccountCode(null)
  }, [open, outstandingMinor])

  const roleMapQuery = api.ledger.roleMap.useQuery(undefined, { enabled: open })
  const badDebtDefaultCode = useMemo(
    () =>
      roleMapQuery.data?.find((row) => row.role === BAD_DEBT_EXPENSE_ROLE)?.account?.code ?? null,
    [roleMapQuery.data]
  )
  // The picker shows the explicit override once the bookkeeper makes one;
  // otherwise it shows the role's own default, purely for display — the
  // request itself omits `expenseAccountCode` until there IS an override, so
  // the entry keeps naming the ROLE (decision G8) rather than freezing today's
  // code onto every ordinary write-off.
  const displayedAccountCode = expenseAccountCode ?? badDebtDefaultCode

  const previewQuery = api.money.previewWriteOff.useQuery(
    {
      invoiceRecordId,
      amountMinor: amountMinor ?? undefined,
      expenseAccountCode: expenseAccountCode ?? undefined,
    },
    {
      enabled: open && !!amountMinor && amountMinor > 0 && amountMinor <= outstandingMinor,
      staleTime: 0,
    }
  )

  const writeOff = api.money.writeOffInvoice.useMutation({
    onError: (error) =>
      toastError({ title: 'Error writing off invoice', description: error.message }),
  })

  const preview = previewQuery.data
  const blockers: LedgerBlocker[] = []
  if (preview?.blockedBy) blockers.push(preview.blockedBy)

  const canSave =
    !!amountMinor &&
    amountMinor > 0 &&
    amountMinor <= outstandingMinor &&
    reason.trim().length > 0 &&
    !!preview &&
    !preview.blockedBy

  const handleSubmit = async () => {
    if (!canSave || !amountMinor) return
    try {
      const result = await writeOff.mutateAsync({
        invoiceRecordId,
        amountMinor,
        reason: reason.trim(),
        expenseAccountCode: expenseAccountCode ?? undefined,
      })
      if (!POSTED_STATUSES.has(result.status)) {
        // A refusal `postEntry` returns rather than throws (a period locked
        // between preview and submit, say) — the invoice was left untouched.
        toastError({
          title: 'Write-off refused',
          description: result.error ?? 'The entry was not posted.',
        })
        return
      }
      onWrittenOff?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Write off invoice</DialogTitle>
          <DialogDescription>
            Move some or all of this invoice&apos;s balance to bad debt expense. This posts a
            journal entry and cannot be undone by editing — only by a reversal.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='write-off-form'
          defaultLabelWidth={130}
          className='p-0'>
          <FieldPanelRow title='Amount' type={BaseType.CURRENCY} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={amountMinor}
              onChange={(val) => setAmountMinor(val as number | null)}
              disabled={writeOff.isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Reason' type={BaseType.STRING} showIcon isRequired>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Customer bankrupt, uncollectible after 180 days, …'
              disabled={writeOff.isPending}
              rows={2}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Expense account' type={BaseType.STRING} showIcon>
            <GlAccountPicker
              value={displayedAccountCode}
              onChange={(code) => setExpenseAccountCode(code)}
              filterTypes={['expense']}
              placeholder={roleMapQuery.isLoading ? 'Loading…' : 'Bad Debt Expense (default)'}
              disabled={writeOff.isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        {preview && <EntryJournal lines={preview.lines} currencyCode={currencyCode} />}

        {blockers.length > 0 && <EntryBlockers blockers={blockers} />}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={writeOff.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={writeOff.isPending}
            loadingText='Writing off...'
            disabled={!canSave}
            data-dialog-submit>
            Write off <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
