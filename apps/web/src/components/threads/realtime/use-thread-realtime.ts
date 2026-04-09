// apps/web/src/components/threads/realtime/use-thread-realtime.ts
'use client'

import { useCallback, useEffect } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { useMessageListStore } from '../store/message-list-store'
import { useMessageStore } from '../store/message-store'
import { useThreadStore } from '../store/thread-store'
import type {
  ChatMessagesReadEvent,
  NewChatMessageEvent,
  NewSystemMessageEvent,
  SessionClosedEvent,
  SessionCreatedEvent,
} from './types'

/**
 * Hook that subscribes to realtime events on the org channel and updates thread/message stores.
 * Uses useOrgChannel() (useSyncExternalStore) — no Context provider needed.
 *
 * This hook handles the following events:
 * - session-created: New chat session (creates a new thread)
 * - session-closed: Chat session ended
 * - new-chat-message: New message in a chat thread
 * - new-system-message: System message in a chat thread
 * - chat-messages-read: Messages marked as read
 */
export function useThreadRealtime() {
  const orgChannel = useOrgChannel()

  // Store actions
  const requestThread = useThreadStore((s) => s.requestThread)
  const updateThread = useThreadStore((s) => s.updateThread)
  const invalidateAllContexts = useThreadStore((s) => s.invalidateAllContexts)

  const requestMessage = useMessageStore((s) => s.requestMessage)
  const appendMessage = useMessageListStore((s) => s.appendMessage)

  const handleSessionCreated = useCallback(
    (data: SessionCreatedEvent) => {
      console.log('[ThreadRealtime] session-created:', data.threadId)
      requestThread(data.threadId)
      invalidateAllContexts()
    },
    [requestThread, invalidateAllContexts]
  )

  const handleSessionClosed = useCallback(
    (data: SessionClosedEvent) => {
      console.log('[ThreadRealtime] session-closed:', data.threadId)
      updateThread(data.threadId, { status: 'ARCHIVED' })
    },
    [updateThread]
  )

  const handleNewChatMessage = useCallback(
    (data: NewChatMessageEvent) => {
      console.log('[ThreadRealtime] new-chat-message:', data.threadId)
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
        isUnread: true,
      })
    },
    [requestMessage, appendMessage, updateThread]
  )

  const handleNewSystemMessage = useCallback(
    (data: NewSystemMessageEvent) => {
      console.log('[ThreadRealtime] new-system-message:', data.threadId)
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
      })
    },
    [requestMessage, appendMessage, updateThread]
  )

  const handleChatMessagesRead = useCallback(
    (data: ChatMessagesReadEvent) => {
      console.log('[ThreadRealtime] chat-messages-read:', data.threadId, 'by', data.reader)
      if (data.reader === 'agent') {
        updateThread(data.threadId, { isUnread: false })
      }
    },
    [updateThread]
  )

  useEffect(() => {
    if (!orgChannel) return

    orgChannel.bind('session-created', handleSessionCreated)
    orgChannel.bind('session-closed', handleSessionClosed)
    orgChannel.bind('new-chat-message', handleNewChatMessage)
    orgChannel.bind('new-system-message', handleNewSystemMessage)
    orgChannel.bind('chat-messages-read', handleChatMessagesRead)

    return () => {
      orgChannel.unbind('session-created', handleSessionCreated)
      orgChannel.unbind('session-closed', handleSessionClosed)
      orgChannel.unbind('new-chat-message', handleNewChatMessage)
      orgChannel.unbind('new-system-message', handleNewSystemMessage)
      orgChannel.unbind('chat-messages-read', handleChatMessagesRead)
    }
  }, [
    orgChannel,
    handleSessionCreated,
    handleSessionClosed,
    handleNewChatMessage,
    handleNewSystemMessage,
    handleChatMessagesRead,
  ])
}
