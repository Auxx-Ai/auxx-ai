// apps/web/src/components/mail/chat-composer/use-chat-send.ts
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import {
  appendOptimisticMessage,
  toAttachmentMeta,
} from '~/components/threads/hooks/append-optimistic-message'
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
        const textPlain = variables.textPlain ?? ''
        const attachments = (variables.attachments ?? []).map(toAttachmentMeta)
        const snippet =
          textPlain.length > 0
            ? textPlain.length > 140
              ? `${textPlain.slice(0, 139)}…`
              : textPlain
            : (attachments[0]?.name ?? '')
        const optimistic: MessageMeta = {
          id: sentMessage.id,
          threadId: sentMessage.threadId,
          subject: sentMessage.subject ?? null,
          snippet,
          textHtml: variables.textHtml ?? null,
          textPlain,
          isInbound: false,
          isFirstInThread: false,
          hasAttachments: attachments.length > 0,
          hasHtmlBody: !!variables.textHtml,
          hasTextBody: textPlain.length > 0,
          sentAt,
          receivedAt: null,
          createdAt: sentAt,
          participants: [],
          createdById: null,
          sendStatus: 'SENT',
          providerError: null,
          attempts: 1,
          attachments,
          messageType: 'CHAT',
        }
        appendOptimisticMessage(utils, sentMessage.threadId, optimistic)
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
