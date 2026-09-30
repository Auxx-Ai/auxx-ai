// apps/web/src/components/money/ui/invoice/invoice-lines-card.tsx
'use client'

// Invoice drawer's "Line items" tab card — registered as 'invoice:lines' (money MI1 build
// spec §J.1). Shares the quote recipe (MQ1/MQ2): the document actions cluster (Send/resend
// + Download/Mark-as-sent/Edit/Void dropdown) teleported into the drawer Section header via
// `DocumentSectionActions`, the Overdue badge (§J.4), and the shared `LineBuilder` in
// `documentType='invoice'` mode (§J.2). The "Line items" section title itself is rendered by
// the drawer's `Section` wrapper (base-entity-drawer.tsx).
//
// An issued invoice is edited in place through the generic lane (74 §1.3), never by writing
// its status back to `draft`.

import type { CreateLineInput } from '@auxx/lib/accounting/documents/lines/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { type EditStamp, parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Download, FileMinus, Pencil, Save, Send, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { creditMemoHref } from '~/components/drawers/cards/credit-memo-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecordEditState, useSystemValues } from '~/components/resources/hooks'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const INVOICE_STATUS_ATTRS = ['invoice_status', 'invoice_due_date', 'invoice_contact'] as const

/** `lines.create` takes at most this many per request. */
const CREATE_CHUNK = 50

/** Statuses where the invoice can still be (re)sent — void is terminal, paid rarely resent. */
const SENDABLE_STATUSES = new Set(['draft', 'sent', 'partially_paid'])
/** Statuses the edit-in-place lane will open (74 §1.3) — the rest it refuses by name. */
const EDITABLE_STATUSES = new Set(['sent', 'partially_paid', 'paid'])
/** Statuses where an invoice can be overdue (money MI1 build spec §J.4). */
const OVERDUE_STATUSES = new Set(['sent', 'partially_paid'])
/** Statuses a credit memo can be raised against (plans/accounting/tasks/done/10-credit-memos.md
 * §6.1): the invoice must have been issued, so there is revenue to reverse. A draft is
 * edited instead, and a void or written-off invoice has nothing left to credit. */
const CREDITABLE_STATUSES = new Set(['sent', 'partially_paid', 'paid'])

export function InvoiceLinesCard({ recordId }: DrawerTabProps) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const [confirm, ConfirmDialog] = useConfirm()
  const [voidConfirm, VoidConfirmDialog] = useConfirm()

  const utils = api.useUtils()
  const updateRecord = useRecordStore((state) => state.updateRecord)
  const { values } = useSystemValues(recordId, [...INVOICE_STATUS_ATTRS], { autoFetch: true })

  const status = (values.invoice_status as string | undefined) ?? 'draft'
  const dueDate = values.invoice_due_date as string | null | undefined
  const contactRecordId = extractRelationshipRecordIds(values.invoice_contact)[0]

  // The invoice's own lines: the `LineBuilder` below reads the same cache, so no second fetch.
  const [, invoiceId] = recordId.split(':')
  const { data: invoiceLines } = api.lines.list.useQuery(
    { documentType: 'invoice', documentId: invoiceId ?? '' },
    { enabled: !!invoiceId }
  )

  const isOverdue = useMemo(() => {
    if (!dueDate || !OVERDUE_STATUSES.has(status)) return false
    return new Date(dueDate).getTime() < Date.now()
  }, [dueDate, status])

  // The edit stamp rides the record itself (74 §1.2.1), so this is a store read
  // and not a query. Unknown reads as locked.
  const { editing } = useRecordEditState(recordId as RecordId)
  // A draft is typed freely; an issued invoice is typed again only while an edit
  // is open, and Save brings its ledger entry up to date (74 §1.3).
  const readOnly = status !== 'draft' && !editing

  // Void is only offered while no succeeded payment exists (decision 6, §G.4) — the server
  // enforces it, the UI hides the button when the ledger has any recorded payment.
  const { data: payments } = api.money.listPayments.useQuery({ invoiceRecordId: recordId })
  const canVoid = status !== 'void' && !editing && (payments?.length ?? 0) === 0

  // Shared send/download flow (compose + PDF + no-channel guard).
  const { hasEmailChannel, handleSend, handleDownload, isSending } = useDocumentSendActions(
    recordId,
    'invoice'
  )

  const markSent = api.money.markInvoiceSent.useMutation({
    onError: (error) =>
      toastError({ title: 'Error marking invoice as sent', description: error.message }),
  })
  const voidInvoice = api.money.voidInvoice.useMutation({
    onError: (error) => toastError({ title: 'Error voiding invoice', description: error.message }),
  })

  // The edit-in-place lane (74 §1.3). The three mutations return the stamp, so
  // the store is patched without waiting on the realtime echo or a refetch.
  const editTarget = { family: 'invoice' as const, recordId: invoiceId ?? '' }
  const stampEdit = (edit: EditStamp | null) => {
    const [defId] = recordId.split(':')
    if (defId && invoiceId) updateRecord(defId, invoiceId, { edit })
  }
  const openEdit = api.documentEdit.open.useMutation({
    onSuccess: (edit) => stampEdit(edit),
    onError: (error) => toastError({ title: 'Error opening invoice', description: error.message }),
  })
  const saveEdit = api.documentEdit.save.useMutation({
    onSuccess: (result) => {
      stampEdit(result.edit)
      utils.record.invalidate().catch(() => {})
    },
    onError: (error) => toastError({ title: 'Error saving invoice', description: error.message }),
  })
  const cancelEdit = api.documentEdit.cancel.useMutation({
    onSuccess: (result) => {
      stampEdit(result.edit)
      // Restore rewrote header values and recreated the lines under new ids.
      utils.record.invalidate().catch(() => {})
      utils.lines.list
        .invalidate({ documentType: 'invoice', documentId: invoiceId })
        .catch(() => {})
    },
    onError: (error) => toastError({ title: 'Error cancelling edit', description: error.message }),
  })

  // Raises a draft memo carrying every line of this invoice, then drills into it: the memo's
  // own drawer is where lines are trimmed and the memo is issued (§6.2). The memo header is a
  // `record.create`; its lines transcribe qty, rate, subtotal and each line's own tax share.
  const createRecord = api.record.create.useMutation({
    onError: (error) =>
      toastError({ title: 'Error creating credit memo', description: error.message }),
  })
  const createLines = api.lines.create.useMutation({
    onError: (error) =>
      toastError({ title: 'Error copying invoice lines', description: error.message }),
  })
  const isCreditPending = createRecord.isPending || createLines.isPending

  const handleCredit = async () => {
    if (!contactRecordId) {
      toastError({
        title: 'Error creating credit memo',
        description: 'This invoice has no contact to credit.',
      })
      return
    }
    try {
      const { recordId: creditMemoRecordId } = await createRecord.mutateAsync({
        entityDefinitionId: 'credit_memo',
        values: {
          credit_memo_status: 'draft',
          credit_memo_source: 'native',
          credit_memo_contact: contactRecordId,
          credit_memo_invoice: recordId,
        },
      })

      // Created in the invoice's order; the module stamps sort order at the tail.
      const lines = (invoiceLines ?? []).map((line): CreateLineInput => {
        const qty = line.qty ?? 1
        const input: CreateLineInput = {
          sourceLineItemId: line.id,
          qty,
          lineTotal:
            line.lineTotal ?? (line.unitPrice !== null ? Math.round(line.unitPrice * qty) : 0),
        }
        if (line.name) input.name = line.name
        if (line.unitPrice !== null) input.unitPrice = line.unitPrice
        if (line.taxTotal !== null) input.taxTotal = line.taxTotal
        return input
      })
      const creditMemoId = parseRecordId(creditMemoRecordId).entityInstanceId
      for (let start = 0; start < lines.length; start += CREATE_CHUNK) {
        await createLines.mutateAsync({
          documentType: 'credit_memo',
          documentId: creditMemoId,
          lines: lines.slice(start, start + CREATE_CHUNK),
        })
      }

      if (openRecord) openRecord(creditMemoRecordId)
      else router.push(creditMemoHref(creditMemoRecordId))
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const handleVoid = async () => {
    const confirmed = await voidConfirm({
      title: 'Void this invoice?',
      description:
        'Gathered job lines are released back to unbilled so they can be re-invoiced. This can be undone by manually setting the invoice status back to draft.',
      confirmText: 'Void',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) voidInvoice.mutate({ invoiceRecordId: recordId })
  }

  const handleCancelEdit = async () => {
    const confirmed = await confirm({
      title: 'Discard these changes?',
      description:
        'The invoice returns to the values it had when Edit was pressed. Lines added since are ' +
        'deleted. The ledger was never touched.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) cancelEdit.mutate(editTarget)
  }

  const sendSlot = SENDABLE_STATUSES.has(status)
    ? {
        label: status === 'draft' ? 'Send' : 'Resend',
        onClick: handleSend,
        isPending: isSending,
        disabledReason: hasEmailChannel ? undefined : (
          <div className='flex flex-col gap-1 text-xs'>
            <span>Connect an email channel to send invoices.</span>
            <Link href='/app/settings/channels' className='underline'>
              Go to channel settings
            </Link>
          </div>
        ),
      }
    : undefined

  // While an edit is open, Save IS the next move, so it takes the primary segment.
  const primary = editing
    ? {
        label: 'Save changes',
        onClick: () => saveEdit.mutate(editTarget),
        isPending: saveEdit.isPending,
      }
    : sendSlot
  const canEdit = EDITABLE_STATUSES.has(status) && !editing

  return (
    <div className='flex h-[26rem] min-h-0 flex-col'>
      <DocumentSectionActions
        badge={
          editing ? (
            <Badge variant='amber' size='sm'>
              Editing
            </Badge>
          ) : isOverdue ? (
            <Badge variant='amber' size='sm'>
              Overdue
            </Badge>
          ) : undefined
        }>
        <DocumentActionsCluster send={primary} menuLabel='Invoice actions'>
          <DropdownMenuItem onClick={handleDownload}>
            <Download /> Download PDF
          </DropdownMenuItem>

          {status === 'draft' && (
            <DropdownMenuItem onClick={() => markSent.mutate({ invoiceRecordId: recordId })}>
              <Send /> Mark as sent
            </DropdownMenuItem>
          )}

          {CREDITABLE_STATUSES.has(status) && (
            <DropdownMenuItem onClick={handleCredit} disabled={isCreditPending}>
              <FileMinus /> Credit
            </DropdownMenuItem>
          )}

          {canEdit && (
            <DropdownMenuItem onClick={() => openEdit.mutate(editTarget)}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}

          {editing && (
            <>
              <DropdownMenuItem onClick={() => saveEdit.mutate(editTarget)}>
                <Save /> Save changes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCancelEdit}>
                <Undo2 /> Cancel changes
              </DropdownMenuItem>
            </>
          )}

          {canVoid && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={handleVoid}>
                <Ban /> Void
              </DropdownMenuItem>
            </>
          )}
        </DocumentActionsCluster>
      </DocumentSectionActions>

      {editing && (
        <div className='border-amber-300 border-b bg-amber-50 px-1 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/40'>
          This invoice is issued and open for editing. Save to bring its ledger entry up to date.
        </div>
      )}

      <div className='min-h-0 flex-1 pe-3'>
        <LineBuilder documentRecordId={recordId} documentType='invoice' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
      <VoidConfirmDialog />
    </div>
  )
}
