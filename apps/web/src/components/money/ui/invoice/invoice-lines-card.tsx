// apps/web/src/components/money/ui/invoice/invoice-lines-card.tsx
'use client'

// Invoice drawer's "Line items" tab card — registered as 'invoice:lines' (money MI1 build
// spec §J.1). Adapted from the quote-line-items-tab.tsx recipe (MQ1/MQ2): the status-driven
// header action strip (Send/resend + Download PDF + Mark as sent/Void) + Overdue badge
// (§J.4) + the edit-sent guard banner + the shared `LineBuilder` in `documentType='invoice'`
// mode (§J.2). The "Line items" section title itself is rendered by the drawer's `Section`
// wrapper (base-entity-drawer.tsx) — this card renders only the action strip + body.

import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import Link from 'next/link'
import { useMemo } from 'react'
import { useChannelsLoading } from '~/components/channels/hooks/use-channels'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { useEmailChannels } from '~/components/channels/store/channel-store'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { Tooltip } from '~/components/global/tooltip'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useSaveSystemValues, useSystemValues } from '~/components/resources/hooks'
import { useDefaultSignature } from '~/components/signatures/hooks'
import { useCompose } from '~/hooks/use-compose'
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
  const { openCompose } = useCompose()

  const { values } = useSystemValues(recordId, [...INVOICE_STATUS_ATTRS], { autoFetch: true })
  const { save: saveSystemValues } = useSaveSystemValues(recordId)
  const { signature: defaultSignature } = useDefaultSignature()

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

  const markSent = api.money.markInvoiceSent.useMutation({
    onError: (error) =>
      toastError({ title: 'Error marking invoice as sent', description: error.message }),
  })
  const voidInvoice = api.money.voidInvoice.useMutation({
    onError: (error) => toastError({ title: 'Error voiding invoice', description: error.message }),
  })

  // ─── Send flow (money MQ2 build spec §E.2/§E.4, composed per §H.4) ─────────
  const channelsLoading = useChannelsLoading()
  const emailChannels = useEmailChannels()
  const defaultChannelId = useDefaultChannelId()
  // Treat "still loading" as "assume available" — avoids a flash of the
  // no-channel state before the channel list has actually loaded.
  const hasEmailChannel = channelsLoading || emailChannels.length > 0

  const prepareDocumentEmail = api.money.prepareDocumentEmail.useMutation({
    onError: (error) =>
      toastError({ title: 'Error preparing invoice email', description: error.message }),
  })
  const ensureDocumentPdf = api.money.ensureDocumentPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })

  const handleSend = async () => {
    try {
      const prepared = await prepareDocumentEmail.mutateAsync({ recordId })
      openCompose({
        presetValues: {
          to: prepared.to.map((recipient) => ({
            id: recipient.email,
            identifier: recipient.email,
            identifierType: 'EMAIL',
            name: recipient.name,
          })),
          subject: prepared.subject,
          contentHtml: prepared.contentHtml,
          attachments: [prepared.attachment],
          integrationId: defaultChannelId,
          signatureId: defaultSignature?.id ?? null,
          linkTicketId: parseRecordId(recordId).entityInstanceId,
        },
      })
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const handleDownload = async () => {
    try {
      const { assetId } = await ensureDocumentPdf.mutateAsync({ quoteRecordId: recordId })
      window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer')
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

  return (
    <div className='flex h-[26rem] min-h-0 flex-col'>
      {/* fullBleed cancels the Section's own inset (drawer-config.ts) so the table below can
          span edge-to-edge — the header strip/banner restore padding for themselves. */}
      <div className='flex items-center justify-between gap-2 px-3 pb-2'>
        <div className='flex items-center gap-2'>
          {isOverdue && (
            <Badge variant='amber' size='sm'>
              Overdue
            </Badge>
          )}
        </div>

        <div className='flex items-center gap-2'>
          {SENDABLE_STATUSES.has(status) &&
            (hasEmailChannel ? (
              <Button
                variant='outline'
                size='sm'
                loading={prepareDocumentEmail.isPending}
                loadingText='Preparing...'
                onClick={handleSend}>
                {status === 'draft' ? 'Send' : 'Resend'}
              </Button>
            ) : (
              <Tooltip
                allowInteraction
                contentComponent={
                  <div className='flex flex-col gap-1 text-xs'>
                    <span>Connect an email channel to send invoices.</span>
                    <Link href='/app/settings/channels' className='underline'>
                      Go to channel settings
                    </Link>
                  </div>
                }>
                <span>
                  <Button variant='outline' size='sm' disabled>
                    Send
                  </Button>
                </span>
              </Tooltip>
            ))}

          <Button
            variant='outline'
            size='sm'
            loading={ensureDocumentPdf.isPending}
            loadingText='Preparing...'
            onClick={handleDownload}>
            Download PDF
          </Button>

          {status === 'draft' && (
            <Button
              variant='outline'
              size='sm'
              loading={markSent.isPending}
              loadingText='Sending...'
              onClick={() => markSent.mutate({ invoiceRecordId: recordId })}>
              Mark as sent
            </Button>
          )}

          {canVoid && (
            <Button
              variant='destructive'
              size='sm'
              loading={voidInvoice.isPending}
              loadingText='Voiding...'
              onClick={handleVoid}>
              Void
            </Button>
          )}
        </div>
      </div>

      {SENT_STATUSES.has(status) && (
        <div className='mx-3 mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm'>
          <span className='text-amber-700 dark:text-amber-400'>
            This invoice was sent — editing returns it to draft.
          </span>
          <Button variant='outline' size='sm' onClick={handleEditSent}>
            Edit
          </Button>
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
