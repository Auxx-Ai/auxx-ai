// apps/web/src/components/money/ui/use-document-send-actions.ts
'use client'

import { parseRecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useChannelsLoading } from '~/components/channels/hooks/use-channels'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { useEmailChannels } from '~/components/channels/store/channel-store'
import type { RecordId } from '~/components/resources'
import { useDefaultSignature } from '~/components/signatures/hooks'
import { useCompose } from '~/hooks/use-compose'
import { api } from '~/trpc/react'

/**
 * Shared send/download flow for money documents (quote + invoice). Both tabs used
 * to duplicate this verbatim (money MQ2 build spec §E.2/§E.4, composed per §H.4):
 * `prepareDocumentEmail` → open the composer with the rendered snippet + PDF
 * attachment, and `ensureDocumentPdf` → open the generated PDF in a new tab. The
 * no-email-channel guard (treat "still loading" as available to avoid a flash) is
 * owned here too. Lifecycle mutations stay per-document — only these two are shared.
 *
 * @param recordId - the document's RecordId
 * @param documentLabel - lowercase noun for error toasts, e.g. `'quote'` / `'invoice'`
 */
export function useDocumentSendActions(recordId: RecordId, documentLabel: string) {
  const { openCompose } = useCompose()
  // The snippet body carries no sign-off — pre-select the sender's own default
  // signature so the composer appends it (the composer does NOT auto-apply a
  // default). Per-user since plan 36 §12.2, and `signature.getDefault` re-checks
  // viewability, so this can never preset a signature the sender cannot use.
  const { signature: defaultSignature } = useDefaultSignature()

  const channelsLoading = useChannelsLoading()
  const emailChannels = useEmailChannels()
  const defaultChannelId = useDefaultChannelId()
  // Treat "still loading" as "assume available" — avoids a flash of the
  // no-channel state before the channel list has actually loaded.
  const hasEmailChannel = channelsLoading || emailChannels.length > 0

  const prepareDocumentEmail = api.money.prepareDocumentEmail.useMutation({
    onError: (error) =>
      toastError({ title: `Error preparing ${documentLabel} email`, description: error.message }),
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
      // The endpoint's input is named `quoteRecordId` generically — invoices reuse it.
      const { assetId } = await ensureDocumentPdf.mutateAsync({ quoteRecordId: recordId })
      window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer')
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return {
    hasEmailChannel,
    handleSend,
    handleDownload,
    isSending: prepareDocumentEmail.isPending,
    isDownloading: ensureDocumentPdf.isPending,
  }
}
