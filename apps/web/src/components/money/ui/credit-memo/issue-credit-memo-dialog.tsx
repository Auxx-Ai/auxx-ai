// apps/web/src/components/money/ui/credit-memo/issue-credit-memo-dialog.tsx
'use client'

// Issue confirmation (plans/accounting/tasks/10-credit-memos.md §6.2): the
// write-off dialog's recipe, narrowed. Issuing posts `Dr 4090 / Dr tax /
// Cr 1100` dated `issuedAt` and freezes the lines, so the entry is shown before
// the click through the same `EntryJournal` / `EntryBlockers` the write-off
// dialog uses, from `creditMemo.previewIssue`, which persists nothing.

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
import type { LedgerBlocker } from '~/components/accounting/ui/ledger/entry-blockers'
import { EntryBlockers } from '~/components/accounting/ui/ledger/entry-blockers'
import { EntryJournal } from '~/components/accounting/ui/ledger/entry-journal'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'

interface IssueCreditMemoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  creditMemoRecordId: RecordId
  /**
   * The memo's own `credit_memo_issued_at`, when one is set. A channel draft
   * carries the refund's `created_at` at the provider and that date must not
   * be replaced with today's (§2.1): the dialog prefills it and leaves it.
   */
  issuedAt: string | null
  currencyCode: string
  onIssued?: () => void
}

function todayIso(): string {
  return new Date().toISOString()
}

export function IssueCreditMemoDialog({
  open,
  onOpenChange,
  creditMemoRecordId,
  issuedAt,
  currencyCode,
  onIssued,
}: IssueCreditMemoDialogProps) {
  const [date, setDate] = useState<string>(issuedAt ?? todayIso())

  // Reset the date to a fresh prefill every time the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setDate(issuedAt ?? todayIso())
  }, [open])

  // A plain `useQuery`, not debounced: the date is picked once and reviewed,
  // and the preview is the entry builder over a handful of indexed reads.
  const previewQuery = api.creditMemo.previewIssue.useQuery(
    { creditMemoRecordId, issuedAt: date },
    { enabled: open, staleTime: 0 }
  )

  const issue = api.creditMemo.issue.useMutation({
    onError: (error) =>
      toastError({ title: 'Error issuing credit memo', description: error.message }),
  })

  const preview = previewQuery.data
  const blockers: LedgerBlocker[] = []
  if (preview?.blockedBy) blockers.push(preview.blockedBy)

  const canSave = !!date && !!preview && !preview.blockedBy

  const handleSubmit = async () => {
    if (!canSave) return
    try {
      await issue.mutateAsync({ creditMemoRecordId, issuedAt: date })
      onIssued?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Issue credit memo</DialogTitle>
          <DialogDescription>
            Posts the credit against receivable and freezes the lines. An issued memo is corrected
            by voiding and re-issuing, never by editing.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='issue-credit-memo-form'
          defaultLabelWidth={110}
          className='p-0'>
          <FieldPanelRow title='Issue date' type={BaseType.DATE} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.DATE}
              value={date}
              onChange={(val) => setDate(val as string)}
              disabled={issue.isPending}
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
            disabled={issue.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={issue.isPending}
            loadingText='Issuing...'
            disabled={!canSave}
            data-dialog-submit>
            Issue <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
