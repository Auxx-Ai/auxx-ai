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

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { EditStamp, RecordId } from '@auxx/lib/resources/client'
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
import {
  documentLineFilters,
  LINE_PAGE_SIZE,
  LINE_SCHEMAS,
  LINE_SORT,
} from '~/components/money/ui/line-builder/line-values'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { toRecordId, useRecordList } from '~/components/resources'
import { useRecordEditState, useSystemValues } from '~/components/resources/hooks'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const INVOICE_STATUS_ATTRS = ['invoice_status', 'invoice_due_date', 'invoice_contact'] as const

const INVOICE_LINE_SCHEMA = LINE_SCHEMAS.invoice

/** What a credit memo line transcribes off an invoice line (accounting/10 §5.1). */
const CREDIT_SOURCE_LINE_ATTRS = [
  'line_item_name',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_tax_total',
  'line_item_sort_order',
] as const
type CreditSourceLineValues = Partial<Record<(typeof CREDIT_SOURCE_LINE_ATTRS)[number], unknown>>

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

  // The invoice's OWNED lines, read through the same list key the `LineBuilder` below
  // builds (`documentLineFilters` + `LINE_SORT`), so this is the already-loaded list and
  // not a second fetch. Owned only: a gather stamps source work-order lines onto the
  // invoice rather than copying them, and those are excluded by the schema's filter.
  const lineFilters = useMemo<ConditionGroup[]>(
    () => documentLineFilters(INVOICE_LINE_SCHEMA, recordId),
    [recordId]
  )
  const { records: lineRecords } = useRecordList({
    entityDefinitionId: INVOICE_LINE_SCHEMA.lineEntityType,
    filters: lineFilters,
    sorting: LINE_SORT,
    limit: LINE_PAGE_SIZE,
  })
  const lineRecordIds = useMemo(
    () => lineRecords.map((r) => toRecordId(INVOICE_LINE_SCHEMA.lineEntityType, r.id)),
    [lineRecords]
  )
  const { valuesById: lineValuesById } = useSystemValuesForRecords(
    lineRecordIds,
    CREDIT_SOURCE_LINE_ATTRS,
    { autoFetch: true, enabled: lineRecordIds.length > 0 }
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
  const [, invoiceId] = recordId.split(':')
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
      // Restore rewrote header values and deleted the lines the edit added, so
      // every value the drawer holds for this invoice is stale.
      utils.record.invalidate().catch(() => {})
    },
    onError: (error) => toastError({ title: 'Error cancelling edit', description: error.message }),
  })

  // Raises a draft memo carrying every line of this invoice, then drills into it: the memo's
  // own drawer is where lines are trimmed and the memo is issued (§6.2). Done client-side
  // the way the line builder materializes drafts: `record.create` the memo (draft, native,
  // this invoice and its contact), then `record.createMany` one `credit_memo_line` per
  // invoice line, transcribing qty, unit price, subtotal and the line's own tax share.
  const createRecord = api.record.create.useMutation({
    onError: (error) =>
      toastError({ title: 'Error creating credit memo', description: error.message }),
  })
  const createManyRecords = api.record.createMany.useMutation({
    onError: (error) =>
      toastError({ title: 'Error copying invoice lines', description: error.message }),
  })
  const isCreditPending = createRecord.isPending || createManyRecords.isPending

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

      const lines = lineRecordIds.map((lineRecordId, index) => {
        const line: CreditSourceLineValues = lineValuesById[lineRecordId] ?? {}
        const qty = (line.line_item_qty as number | null | undefined) ?? 1
        const unitPrice = line.line_item_unit_price as number | null | undefined
        const lineTotal = line.line_item_line_total as number | null | undefined
        const taxTotal = line.line_item_tax_total as number | null | undefined
        const sortOrder = line.line_item_sort_order as number | null | undefined
        return {
          credit_memo_line_credit_memo: creditMemoRecordId,
          credit_memo_line_line_item: lineRecordId,
          credit_memo_line_description: (line.line_item_name as string | undefined) || undefined,
          credit_memo_line_qty: qty,
          credit_memo_line_unit_price: unitPrice ?? undefined,
          credit_memo_line_subtotal:
            lineTotal ??
            (unitPrice !== null && unitPrice !== undefined ? Math.round(unitPrice * qty) : 0),
          credit_memo_line_tax_total: taxTotal ?? undefined,
          credit_memo_line_sort_order: sortOrder ?? index,
        }
      })
      // `createMany` is capped at 50 per call, the interactive bulk-add ceiling.
      for (let start = 0; start < lines.length; start += 50) {
        await createManyRecords.mutateAsync({
          entityDefinitionId: 'credit_memo_line',
          records: lines.slice(start, start + 50),
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
