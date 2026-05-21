// apps/web/src/components/chat-widget/hooks/use-chat-widget.ts
'use client'
import { api } from '~/trpc/react'

/** Fetch a chat-widget channel by integration id. */
export function useChatWidget(channelId: string) {
  return api.channel.getChatWidgetIntegration.useQuery(
    { integrationId: channelId },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, enabled: !!channelId }
  )
}
