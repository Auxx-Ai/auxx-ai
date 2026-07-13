// apps/web/src/components/money/ui/invoice/invoice-lines-card.tsx
'use client'

// Invoice drawer's "Line items" tab card — registered as 'invoice:lines' (money MI1 build
// spec §J.1). Shares the quote recipe (MQ1/MQ2): the document actions cluster (Send/resend
// + Download/Mark-as-sent/Void/return-to-draft dropdown) teleported into the drawer Section
// header via `DocumentSectionActions`, the Overdue badge (§J.4), the edit-sent guard banner,
// and the shared `LineBuilder` in `documentType='invoice'` mode (§J.2). The "Line items"
// section title itself is rendered by the drawer's `Section` wrapper (base-entity-drawer.tsx).

import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Download, Send, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const INVOICE_STATUS_ATTRS = ['invoice_status', 'invoice_due_date'] as const

/** Statuses where the invoice can still be (re)sent — void is terminal, paid rarely resent. */
const SENDABLE_STATUSES = new Set(['draft', 'sent', 'partially_paid'])
/** Statuses that show the "sent — editing returns to draft" banner. */
const SENT_STATUSES = new Set(['sent', 'partially_paid', 'paid'])
/** Statuses where an invoice can be overdue (money MI1 build spec §J.4). */
const OVERDUE_STATUSES = new Set(['sent', 'partially_paid'])

export function InvoiceLinesCard({ recordId }: DrawerTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [voidConfirm, VoidConfirmDialog] = useConfirm()

  const { values } = useSystemValues(recordId, [...INVOICE_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)

  const status = (values.invoice_status as string | undefined) ?? 'draft'
  const dueDate = values.invoice_due_date as string | null | undefined

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

      {SENT_STATUSES.has(status) && (
        <div className='mx-3 mt-2 mb-3 flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm'>
          <span className='text-amber-700 dark:text-amber-400'>
            This invoice was sent — use “Return to draft” to edit it.
          </span>
        </div>
      )}

      <div className='min-h-0 flex-1'>
        <LineBuilder documentRecordId={recordId} documentType='invoice' readOnly={readOnly} />
      </div>

      <ConfirmDialog />
      <VoidConfirmDialog />
    </div>
  )
}
