// apps/web/src/components/mail/chat-composer/use-chat-send.ts
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useState } from 'react'
import { useMessageListStore } from '~/components/threads/store/message-list-store'
import { useMessageStore } from '~/components/threads/store/message-store'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { api } from '~/trpc/react'
import type { FileAttachment } from '../email-editor/types'

interface UseChatSendOptions {
  threadId: string
  integrationId: string
  onSendSuccess: () => void
  onClose: () => void
}

interface SendArgs {
  textHtml: string
  attachments: FileAttachment[]
}

export function useChatSend({
  threadId,
  integrationId,
  onSendSuccess,
  onClose,
}: UseChatSendOptions) {
  const utils = api.useUtils()
  const [isSending, setIsSending] = useState(false)

  const mutation = api.thread.sendMessage.useMutation({
    onMutate: () => setIsSending(true),
    onSuccess: (sentMessage) => {
      toastSuccess({ description: 'Message sent' })

      if (sentMessage.threadId && sentMessage.id) {
        // Optimistically append the new message ID to the local list and
        // queue its detail fetch. Avoid invalidating the cached list — that
        // would wipe `messageIds` and unmount/remount every message in the
        // thread (visible as a full slide-in animation replay).
        useMessageListStore.getState().appendMessage(sentMessage.threadId, sentMessage.id)
        useMessageStore.getState().requestMessage(sentMessage.id)
        // tRPC cache invalidate is safe — the local list cache stays intact, so
        // useMessages remains disabled and no refetch happens. The next time
        // the cache misses (e.g. cold load), the fresh data will be used.
        utils.message.listByThread.invalidate({ threadId: sentMessage.threadId })

        const currentThread = getThreadStoreState().getThread(sentMessage.threadId)
        if (currentThread) {
          getThreadStoreState().updateThread(sentMessage.threadId, {
            lastMessageAt: sentMessage.sentAt?.toISOString() ?? new Date().toISOString(),
          })
        }
      }

      onSendSuccess()
      onClose()
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
