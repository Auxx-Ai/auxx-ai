// apps/web/src/components/mail/chat-composer/use-chat-send.ts
'use client'

import { type ParticipantRole, toParticipantId } from '@auxx/types'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import {
  appendOptimisticMessage,
  toAttachmentMeta,
} from '~/components/threads/hooks/append-optimistic-message'
import type { AttachmentMeta } from '~/components/threads/store'
import type { MessageMeta } from '~/components/threads/store/message-store'
import { api } from '~/trpc/react'
import type { FileAttachment } from '../email-editor/types'

interface UseChatSendOptions {
  threadId: string
  integrationId: string
  /** Called after optimistic updates land. Use to clear local composer state.
   * Does NOT close the surrounding window — that's the parent's call. */
  onSendSuccess: () => void
}

/** One message of a split send, as `SentMessage.splitMessages` reports it. */
interface SplitMessage {
  id: string
  sentAt?: Date | string | null
  attachmentIds: string[]
  hasText: boolean
}

/** The content of one optimistic bubble — one per message actually sent. */
interface OptimisticPart {
  id: string
  sentAt: string
  textPlain: string
  textHtml: string | null
  attachments: AttachmentMeta[]
}

interface SendArgs {
  textHtml: string
  /** Plain text counterpart (from `editor.getText()`) — preserves newlines and
   *  drives the bubble render. Without this, the optimistic message falls back
   *  to `snippet`, which is single-line and truncated at 140 chars. */
  textPlain: string
  attachments: FileAttachment[]
}

export function useChatSend({ threadId, integrationId, onSendSuccess }: UseChatSendOptions) {
  const utils = api.useUtils()
  const [isSending, setIsSending] = useState(false)

  const mutation = api.thread.sendMessage.useMutation({
    onMutate: () => setIsSending(true),
    onSuccess: (sentMessage, variables) => {
      toastSuccess({ description: 'Message sent' })

      if (sentMessage.threadId && sentMessage.id) {
        const sentAt = sentMessage.sentAt?.toISOString() ?? new Date().toISOString()
        const staged = (variables.attachments ?? []).map(toAttachmentMeta)
        const threadId = sentMessage.threadId

        const buildOptimistic = (part: OptimisticPart): MessageMeta => {
          const snippet =
            part.textPlain.length > 0
              ? part.textPlain.length > 140
                ? `${part.textPlain.slice(0, 139)}…`
                : part.textPlain
              : (part.attachments[0]?.name ?? '')

          return {
            id: part.id,
            threadId,
            subject: sentMessage.subject ?? null,
            snippet,
            textHtml: part.textHtml,
            textPlain: part.textPlain,
            isInbound: false,
            isFirstInThread: false,
            hasAttachments: part.attachments.length > 0,
            hasHtmlBody: !!part.textHtml,
            hasTextBody: part.textPlain.length > 0,
            sentAt: part.sentAt,
            receivedAt: null,
            createdAt: part.sentAt,
            // Tag ids as `<role>:<id>` so the participant store + grouping render
            // sender/recipient immediately rather than waiting on the realtime echo.
            // `thread.sendMessage` returns `any` (the router widens its
            // sent/scheduled union), so this shape is stated locally. It mirrors
            // `SentMessage['participants']` in @auxx/lib.
            participants: (sentMessage.participants ?? []).map((p: { id: string; role: string }) =>
              toParticipantId(p.role.toLowerCase() as ParticipantRole, p.id)
            ),
            createdById: null,
            sendStatus: 'SENT',
            providerError: null,
            attempts: 1,
            attachments: part.attachments,
            messageType: 'CHAT',
          }
        }

        // A send the channel could not carry in one message — Meta's `message`
        // object takes `text` OR one `attachment` — came back as several rows, and
        // this tab is excluded from its own `message:created` echo. One combined
        // bubble here would therefore be the only thing the sender ever saw, and it
        // is not what the customer received.
        const parts: OptimisticPart[] = sentMessage.splitMessages?.length
          ? sentMessage.splitMessages.map((part: SplitMessage) => ({
              id: part.id,
              sentAt: part.sentAt ? new Date(part.sentAt).toISOString() : sentAt,
              textPlain: part.hasText ? (variables.textPlain ?? '') : '',
              textHtml: part.hasText ? (variables.textHtml ?? null) : null,
              attachments: staged.filter((file) => part.attachmentIds.includes(file.id)),
            }))
          : [
              {
                id: sentMessage.id,
                sentAt,
                textPlain: variables.textPlain ?? '',
                textHtml: variables.textHtml ?? null,
                attachments: staged,
              },
            ]

        for (const part of parts) {
          appendOptimisticMessage(utils, threadId, buildOptimistic(part))
        }
      }

      onSendSuccess()
    },
    onError: (error) => {
      toastError({ title: 'Failed to send message', description: error.message })
    },
    onSettled: () => setIsSending(false),
  })

  const send = useCallback(
    ({ textHtml, textPlain, attachments }: SendArgs) => {
      mutation.mutate({
        threadId,
        integrationId,
        textHtml,
        textPlain,
        to: [],
        attachments: attachments.length > 0 ? attachments : undefined,
      })
    },
    [mutation, threadId, integrationId]
  )

  return { send, isSending }
}
