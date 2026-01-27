// apps/web/src/components/threads/realtime/use-thread-realtime.ts
'use client'

import { useEffect, useCallback } from 'react'
import { usePusher } from '~/providers/pusher-provider'
import { useUser } from '~/hooks/use-user'
import { useThreadStore } from '../store/thread-store'
import { useThreadListStore } from '../store/thread-list-store'
import { useMessageStore } from '../store/message-store'
import { useMessageListStore } from '../store/message-list-store'
import { useThreadReadStatusStore } from '../store/thread-read-status-store'
import type {
  SessionCreatedEvent,
  SessionClosedEvent,
  NewChatMessageEvent,
  NewSystemMessageEvent,
  ChatMessagesReadEvent,
} from './types'

/**
 * Hook that subscribes to Pusher realtime events and updates thread/message stores.
 * Should be used within a component that has access to PusherProvider context.
 *
 * This hook handles the following events:
 * - session-created: New chat session (creates a new thread)
 * - session-closed: Chat session ended
 * - new-chat-message: New message in a chat thread
 * - new-system-message: System message in a chat thread
 * - chat-messages-read: Messages marked as read
 */
export function useThreadRealtime() {
  const { pusher } = usePusher()
  const { organizationId } = useUser()

  // Store actions
  const requestThread = useThreadStore((s) => s.requestThread)
  const updateThread = useThreadStore((s) => s.updateThread)
  const invalidateAllLists = useThreadListStore((s) => s.invalidateAll)
  const prependThreadToList = useThreadListStore((s) => s.prependThreadToList)
  const activeListKey = useThreadListStore((s) => s.activeListKey)

  const requestMessage = useMessageStore((s) => s.requestMessage)
  const appendMessage = useMessageListStore((s) => s.appendMessage)

  const setReadStatus = useThreadReadStatusStore((s) => s.setStatus)

  /**
   * Handle session-created event.
   * A new chat session has been created with a new thread.
   */
  const handleSessionCreated = useCallback(
    (data: SessionCreatedEvent) => {
      console.log('[ThreadRealtime] session-created:', data.threadId)

      // Request the new thread metadata (will be batch-fetched)
      requestThread(data.threadId)

      // Add to the active list at the top (if we have an active list)
      if (activeListKey) {
        prependThreadToList(activeListKey, data.threadId)
      }

      // Invalidate all lists to ensure consistency on next fetch
      // (new thread should appear in appropriate filtered lists)
      invalidateAllLists()
    },
    [requestThread, prependThreadToList, invalidateAllLists, activeListKey]
  )

  /**
   * Handle session-closed event.
   * A chat session has been closed.
   */
  const handleSessionClosed = useCallback(
    (data: SessionClosedEvent) => {
      console.log('[ThreadRealtime] session-closed:', data.threadId)

      // Update thread status in cache
      updateThread(data.threadId, { status: 'ARCHIVED' })

      // Invalidate lists (thread might move to different filtered view)
      invalidateAllLists()
    },
    [updateThread, invalidateAllLists]
  )

  /**
   * Handle new-chat-message event.
   * A new message has been added to a chat thread.
   */
  const handleNewChatMessage = useCallback(
    (data: NewChatMessageEvent) => {
      console.log('[ThreadRealtime] new-chat-message:', data.threadId)

      // Request the new message metadata
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }

      // Update thread's lastMessageAt and latestMessageId
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
        messageCount: undefined, // Will be refreshed on next fetch
      })

      // Mark thread as unread (unless it's from the current user)
      // For chat, messages from agents should mark thread as read for that agent
      // For now, we'll mark as unread for simplicity - the read status
      // will be properly set when the thread is viewed
      setReadStatus(data.threadId, true)

      // Thread position in list might change due to new lastMessageAt
      // Invalidate lists to ensure proper ordering on next fetch
      invalidateAllLists()
    },
    [requestMessage, appendMessage, updateThread, setReadStatus, invalidateAllLists]
  )

  /**
   * Handle new-system-message event.
   * A system message has been added to a chat thread.
   */
  const handleNewSystemMessage = useCallback(
    (data: NewSystemMessageEvent) => {
      console.log('[ThreadRealtime] new-system-message:', data.threadId)

      // Request the new message metadata
      if (data.message?.id) {
        requestMessage(data.message.id)
        appendMessage(data.threadId, data.message.id)
      }

      // Update thread timestamp
      updateThread(data.threadId, {
        lastMessageAt: data.message?.createdAt || new Date().toISOString(),
        latestMessageId: data.message?.id || null,
      })
    },
    [requestMessage, appendMessage, updateThread]
  )

  /**
   * Handle chat-messages-read event.
   * Messages in a thread have been marked as read.
   */
  const handleChatMessagesRead = useCallback(
    (data: ChatMessagesReadEvent) => {
      console.log('[ThreadRealtime] chat-messages-read:', data.threadId, 'by', data.reader)

      // If an agent read the messages, mark the thread as read
      if (data.reader === 'agent') {
        setReadStatus(data.threadId, false)
      }
    },
    [setReadStatus]
  )

  // Subscribe to Pusher events
  useEffect(() => {
    if (!pusher || !organizationId) {
      return
    }

    const channelName = `presence-org-${organizationId}`

    // Try to get existing channel (PusherProvider should have subscribed)
    // If channel doesn't exist yet, wait for next effect run
    let channel = pusher.channel(channelName)

    if (!channel) {
      // Channel not subscribed yet - PusherProvider may still be connecting
      // Set up a short delay and retry
      const retryTimeout = setTimeout(() => {
        channel = pusher.channel(channelName)
        if (channel) {
          bindEvents(channel)
        }
      }, 500)

      return () => clearTimeout(retryTimeout)
    }

    function bindEvents(ch: typeof channel) {
      if (!ch) return

      console.log('[ThreadRealtime] Binding store update handlers to channel:', channelName)

      // Bind event handlers (these supplement the PusherProvider's React Query invalidations)
      ch.bind('session-created', handleSessionCreated)
      ch.bind('session-closed', handleSessionClosed)
      ch.bind('new-chat-message', handleNewChatMessage)
      ch.bind('new-system-message', handleNewSystemMessage)
      ch.bind('chat-messages-read', handleChatMessagesRead)
    }

    bindEvents(channel)

    // Cleanup on unmount
    return () => {
      if (channel) {
        console.log('[ThreadRealtime] Unbinding store update handlers from channel:', channelName)
        channel.unbind('session-created', handleSessionCreated)
        channel.unbind('session-closed', handleSessionClosed)
        channel.unbind('new-chat-message', handleNewChatMessage)
        channel.unbind('new-system-message', handleNewSystemMessage)
        channel.unbind('chat-messages-read', handleChatMessagesRead)
      }
    }
  }, [
    pusher,
    organizationId,
    handleSessionCreated,
    handleSessionClosed,
    handleNewChatMessage,
    handleNewSystemMessage,
    handleChatMessagesRead,
  ])
}
