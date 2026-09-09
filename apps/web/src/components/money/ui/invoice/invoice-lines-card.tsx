// apps/web/src/components/money/ui/invoice/invoice-lines-card.tsx
'use client'

// Invoice drawer's "Line items" tab card — registered as 'invoice:lines' (money MI1 build
// spec §J.1). Shares the quote recipe (MQ1/MQ2): the document actions cluster (Send/resend
// + Download/Mark-as-sent/Void/return-to-draft dropdown) teleported into the drawer Section
// header via `DocumentSectionActions`, the Overdue badge (§J.4), the edit-sent guard banner,
// and the shared `LineBuilder` in `documentType='invoice'` mode (§J.2). The "Line items"
// section title itself is rendered by the drawer's `Section` wrapper (base-entity-drawer.tsx).

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Download, FileMinus, Send, Undo2 } from 'lucide-react'
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
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
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
/** Statuses that show the "sent — editing returns to draft" banner. */
const SENT_STATUSES = new Set(['sent', 'partially_paid', 'paid'])
/** Statuses where an invoice can be overdue (money MI1 build spec §J.4). */
const OVERDUE_STATUSES = new Set(['sent', 'partially_paid'])
/** Statuses a credit memo can be raised against (plans/accounting/tasks/10-credit-memos.md
 * §6.1): the invoice must have been issued, so there is revenue to reverse. A draft is
 * edited instead, and a void or written-off invoice has nothing left to credit. */
const CREDITABLE_STATUSES = new Set(['sent', 'partially_paid', 'paid'])

export function InvoiceLinesCard({ recordId }: DrawerTabProps) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const [confirm, ConfirmDialog] = useConfirm()
  const [voidConfirm, VoidConfirmDialog] = useConfirm()

  const { values } = useSystemValues(recordId, [...INVOICE_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)

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

  // draft is the only editable state — sent/partially_paid/paid/void are all read-only.
  const readOnly = status !== 'draft'

  // Void is only offered while no succeeded payment exists (decision 6, §G.4) — the server
  // enforces it, the UI hides the button when the ledger has any recorded payment.
  const { data: payments } = api.money.listPayments.useQuery({ invoiceRecordId: recordId })
  const canVoid = status !== 'void' && (payments?.length ?? 0) === 0

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

  const handleEditSent = async () => {
    const confirmed = await confirm({
      title: 'Edit this invoice?',
      description: 'This invoice was sent — editing returns it to draft.',
      confirmText: 'Edit',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    const ok = await saveSystemValues({ invoice_status: 'draft' })
    if (!ok) {
      toastError({
        title: 'Error returning invoice to draft',
        description: 'Could not update the invoice status',
      })
    }
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

  return (
    <div className='flex h-[26rem] min-h-0 flex-col'>
      <DocumentSectionActions
        badge={
          isOverdue ? (
            <Badge variant='amber' size='sm'>
              Overdue
            </Badge>
          ) : undefined
        }>
        <DocumentActionsCluster send={sendSlot} menuLabel='Invoice actions'>
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

          {SENT_STATUSES.has(status) && (
            <DropdownMenuItem onClick={handleEditSent}>
              <Undo2 /> Return to draft
            </DropdownMenuItem>
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

      <div className='min-h-0 flex-1 pe-3'>
        <LineBuilder documentRecordId={recordId} documentType='invoice' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
      <VoidConfirmDialog />
    </div>
  )
}
