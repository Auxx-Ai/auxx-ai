// apps/web/src/components/mail/hooks/use-retry-send.ts
'use client'

import type { SendStatus } from '@auxx/database/types'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useChannelById } from '~/components/channels/store/channel-store'
import { getChannelProviderName } from '~/components/channels/ui/channel-icon'
import { getMessageStoreState } from '~/components/threads/store'
import { api } from '~/trpc/react'
import { humanizeSendError } from '../send-status-error'

/**
 * Wires the retry-send mutation for a single message.
 *
 * The server publishes `message:updated` for other tabs, but the tab that
 * fired the mutation is excluded from its own publish — so the result is
 * written into the message store here from the mutation's return value.
 * A retry that the provider rejects again resolves successfully with
 * `success: false`, which is why the failure branch lives in `onSuccess`.
 */
export function useRetrySend(messageId: string | null | undefined, integrationId?: string | null) {
  const channel = useChannelById(integrationId ?? undefined)
  const channelName = channel
    ? channel.name || channel.identifier || getChannelProviderName(channel.provider)
    : undefined

  const retrySendMessage = api.thread.retrySendMessage.useMutation({
    onSuccess: (result) => {
      const id = result.message?.id ?? messageId
      if (id) {
        getMessageStoreState().updateMessage(id, {
          sendStatus: (result.message?.sendStatus ?? null) as SendStatus | null,
          providerError: result.message?.providerError ?? null,
          sentAt: result.message?.sentAt ? new Date(result.message.sentAt).toISOString() : null,
          attempts: result.attemptNumber,
        })
      }
      if (!result.success) {
        toastError({
          title: 'Still could not send',
          description:
            humanizeSendError(result.message?.providerError ?? result.error, channelName) ??
            'The provider rejected the message again.',
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Could not retry sending',
        description: error.message || 'This message can no longer be retried.',
      })
    },
  })

  const retry = useCallback(() => {
    if (messageId) retrySendMessage.mutate({ messageId })
  }, [messageId, retrySendMessage])

  return { retry, isRetrying: retrySendMessage.isPending }
}
