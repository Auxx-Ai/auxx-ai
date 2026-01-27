// apps/web/src/components/threads/realtime/types.ts

/**
 * Realtime event types for thread/message system.
 * These events are sent from the backend via Pusher.
 */

/** Chat message data from realtime event */
export interface RealtimeChatMessage {
  id: string
  threadId: string
  sessionId: string
  content: string
  senderType: 'visitor' | 'agent' | 'bot' | 'system'
  senderId?: string
  senderName?: string
  createdAt: string
}

/** Session created event payload */
export interface SessionCreatedEvent {
  sessionId: string
  threadId: string
  createdAt: string
}

/** Session closed event payload */
export interface SessionClosedEvent {
  sessionId: string
  threadId: string
  closedBy: {
    id: string
    name: string
  }
}

/** New chat message event payload */
export interface NewChatMessageEvent {
  sessionId: string
  threadId: string
  message: RealtimeChatMessage
}

/** New system message event payload */
export interface NewSystemMessageEvent {
  sessionId: string
  threadId: string
  message: RealtimeChatMessage
}

/** Visitor updated event payload */
export interface VisitorUpdatedEvent {
  sessionId: string
  threadId: string
  visitorInfo: {
    name?: string
    email?: string
    [key: string]: unknown
  }
}

/** Chat messages read event payload */
export interface ChatMessagesReadEvent {
  sessionId: string
  threadId: string
  reader: 'agent' | 'visitor'
}

/** User typing event payload */
export interface UserTypingEvent {
  sessionId: string
  userId: string
  timestamp: string
}

/** Message processing status changed event */
export interface MessageProcessingStatusEvent {
  messageId: string
  threadId: string
  organizationId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

/** All realtime event types mapped to their payloads */
export interface ThreadRealtimeEvents {
  'session-created': SessionCreatedEvent
  'session-closed': SessionClosedEvent
  'new-chat-message': NewChatMessageEvent
  'new-system-message': NewSystemMessageEvent
  'visitor-updated': VisitorUpdatedEvent
  'chat-messages-read': ChatMessagesReadEvent
  'user-typing': UserTypingEvent
  'message:processing:status_changed': MessageProcessingStatusEvent
  'thread:processing:status_changed': MessageProcessingStatusEvent
}

/** Type helper for event names */
export type ThreadRealtimeEventName = keyof ThreadRealtimeEvents
