// apps/web/src/components/mail/chat-composer/use-chat-send.ts
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { useMessageListStore } from '~/components/threads/store/message-list-store'
import { type MessageMeta, useMessageStore } from '~/components/threads/store/message-store'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { api } from '~/trpc/react'
import type { FileAttachment } from '../email-editor/types'

function htmlToSnippet(html: string, maxLen = 140): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
}

interface UseChatSendOptions {
  threadId: string
  integrationId: string
  /** Called after optimistic updates land. Use to clear local composer state.
   * Does NOT close the surrounding window — that's the parent's call. */
  onSendSuccess: () => void
}

interface SendArgs {
  textHtml: string
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
        // Synthesize a MessageMeta entry so the inbox row's snippet/body
        // updates in-place when `latestMessageId` flips — without it, the row
        // renders empty for the ~50ms request batch window and visibly shifts.
        const sentAt = sentMessage.sentAt?.toISOString() ?? new Date().toISOString()
        const optimistic: MessageMeta = {
          id: sentMessage.id,
          threadId: sentMessage.threadId,
          subject: sentMessage.subject ?? null,
          snippet: htmlToSnippet(variables.textHtml ?? ''),
          textHtml: variables.textHtml ?? null,
          textPlain: null,
          isInbound: false,
          isFirstInThread: false,
          hasAttachments: (variables.attachments?.length ?? 0) > 0,
          hasHtmlBody: !!variables.textHtml,
          hasTextBody: false,
          sentAt,
          receivedAt: null,
          createdAt: sentAt,
          participants: [],
          createdById: null,
          sendStatus: 'SENT',
          providerError: null,
          attempts: 1,
          attachments: [],
          messageType: 'CHAT',
        }
        useMessageStore.getState().setMessages([optimistic])

        // Optimistically append the new message ID to the local list. Avoid
        // invalidating the cached list — that would wipe `messageIds` and
        // unmount/remount every message in the thread (visible as a full
        // slide-in animation replay).
        useMessageListStore.getState().appendMessage(sentMessage.threadId, sentMessage.id)
        // tRPC cache invalidate is safe — the local list cache stays intact, so
        // useMessages remains disabled and no refetch happens. The next time
        // the cache misses (e.g. cold load), the fresh data will be used.
        utils.message.listByThread.invalidate({ threadId: sentMessage.threadId })

        const currentThread = getThreadStoreState().getThread(sentMessage.threadId)
        if (currentThread) {
          getThreadStoreState().updateThread(sentMessage.threadId, {
            lastMessageAt: sentAt,
            latestMessageId: sentMessage.id,
          })
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
    ({ textHtml, attachments }: SendArgs) => {
      mutation.mutate({
        threadId,
        integrationId,
        textHtml,
        to: [],
        attachments: attachments.length > 0 ? attachments : undefined,
      })
    },
    [mutation, threadId, integrationId]
  )

  return { send, isSending }
}
