// packages/lib/src/chat/realtime.ts

import {
  publishMessageCreated,
  publishMessageUpdated,
  publishThreadUpdated,
} from '../realtime/publish-helpers'
import type { RealtimeService } from '../realtime/realtime-service'
import { rooms } from '../realtime/rooms'

/**
 * Shape of a chat message frame the embedded widget renders. Loose typing —
 * the widget code is the source of truth and converts as it likes.
 */
export interface ChatVisitorMessagePayload {
  id: string
  threadId: string
  content: string
  sender: 'USER' | 'AGENT' | 'SYSTEM'
  createdAt: Date
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error'
  clientMessageId?: string
  agent?: { id?: string; name?: string; image?: string }
}

/**
 * Publish a `message:created` for the agent inbox channel AND a `new-message`
 * for the visitor's private chat channel. Both channels need to update on every
 * new chat message; bundling here means callers don't have to remember both.
 *
 * When `visitorParticipantId` is provided, also publishes a `thread-updated`
 * frame on the per-visitor channel so the widget can bump the thread's spot in
 * the Messages tab and update the launcher unread badge even when the
 * conversation isn't currently in view.
 */
export async function publishChatMessageCreated(
  realtime: RealtimeService,
  args: {
    organizationId: string
    inboxId: string | null
    /** The id the visitor widget subscribes against — currently `Thread.id`. */
    visitorChatSessionId: string
    messageId: string
    threadId: string
    visitorPayload: ChatVisitorMessagePayload
    /** Visitor's Participant id; enables cross-thread per-visitor updates. */
    visitorParticipantId?: string
  }
): Promise<void> {
  const tasks: Promise<unknown>[] = [
    publishMessageCreated(realtime, args.organizationId, {
      messageId: args.messageId,
      threadId: args.threadId,
      inboxId: args.inboxId,
    }),
    // Bump the thread row in the admin's mail-thread list so it re-sorts and
    // the `isLiveChat` dot in `mail-thread-item.tsx` re-evaluates against the
    // fresh `lastMessageAt`. Without this, `ChatProvider.receiveMessage` updates
    // the DB but the admin list stays stale until refresh.
    publishThreadUpdated(realtime, args.organizationId, {
      threadId: args.threadId,
      inboxId: args.inboxId,
      patch: {
        lastMessageAt: args.visitorPayload.createdAt.toISOString(),
        latestMessageId: args.messageId,
      },
    }),
    realtime.publish(
      rooms.chatSession(args.visitorChatSessionId),
      'new-message',
      args.visitorPayload
    ),
  ]
  if (args.visitorParticipantId) {
    tasks.push(
      realtime.publish(rooms.visitor(args.visitorParticipantId), 'thread-updated', {
        threadId: args.threadId,
        lastMessage: {
          sender: args.visitorPayload.sender,
          snippet: args.visitorPayload.content.slice(0, 280),
          sentAt: args.visitorPayload.createdAt,
        },
      })
    )
  }
  await Promise.all(tasks)
}

/**
 * Notify the per-visitor channel that a brand-new thread has been created for
 * the visitor. Phase 6 use case: an agent kicks off a thread without the
 * visitor having sent the first message.
 */
export async function publishVisitorThreadCreated(
  realtime: RealtimeService,
  args: { visitorParticipantId: string; threadId: string; createdAt?: Date }
): Promise<void> {
  await realtime.publish(rooms.visitor(args.visitorParticipantId), 'thread-created', {
    threadId: args.threadId,
    createdAt: args.createdAt ?? new Date(),
  })
}

/**
 * Publish a delivery/read receipt update — `message:updated` for agents,
 * `message-receipt` for the visitor.
 */
export async function publishChatMessageReceiptUpdated(
  realtime: RealtimeService,
  args: {
    organizationId: string
    inboxId: string | null
    messageId: string
    threadId: string
    patch: { deliveredAt?: Date; readAt?: Date }
  }
): Promise<void> {
  await Promise.all([
    publishMessageUpdated(realtime, args.organizationId, {
      messageId: args.messageId,
      threadId: args.threadId,
      inboxId: args.inboxId,
      patch: args.patch as any,
    }),
  ])
}

/** Publish a typing indicator to the visitor's chat channel. */
export async function publishChatTyping(
  realtime: RealtimeService,
  args: {
    visitorChatSessionId: string
    sender: 'USER' | 'AGENT'
    isTyping: boolean
    agent?: { id: string; name: string }
  }
): Promise<void> {
  await realtime.publish(rooms.chatSession(args.visitorChatSessionId), 'typing', {
    sender: args.sender,
    isTyping: args.isTyping,
    agent: args.agent,
    createdAt: new Date(),
  })
}

/** Publish thread-closed event to the visitor's chat channel. */
export async function publishChatThreadClosed(
  realtime: RealtimeService,
  args: { visitorChatSessionId: string; closedBy: { id: string; name: string } }
): Promise<void> {
  await realtime.publish(rooms.chatSession(args.visitorChatSessionId), 'session-closed', {
    closedBy: args.closedBy,
    createdAt: new Date(),
  })
}
