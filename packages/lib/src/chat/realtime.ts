// packages/lib/src/chat/realtime.ts

import { publishMessageCreated, publishMessageUpdated } from '../realtime/publish-helpers'
import type { RealtimeService } from '../realtime/realtime-service'

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
  }
): Promise<void> {
  await Promise.all([
    publishMessageCreated(realtime, args.organizationId, {
      messageId: args.messageId,
      threadId: args.threadId,
      inboxId: args.inboxId,
    }),
    realtime.sendToChat(args.visitorChatSessionId, 'new-message', args.visitorPayload),
  ])
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
  await realtime.sendToChat(args.visitorChatSessionId, 'typing', {
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
  await realtime.sendToChat(args.visitorChatSessionId, 'session-closed', {
    closedBy: args.closedBy,
    createdAt: new Date(),
  })
}
