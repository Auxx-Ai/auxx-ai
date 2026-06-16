// apps/web/src/components/mail/chat-thread-metadata.ts

/**
 * Client-side shape of a chat thread's `Thread.metadata` blob. Mirrors
 * `ChatThreadMetadata` in `@auxx/lib/threads`, kept local so client components
 * don't pull a server-only barrel. The per-conversation visit facts now live as
 * FieldValue-backed thread fields (rendered via the Details surface); the keys
 * kept here are operational session bookkeeping.
 */
export interface ChatThreadMetadata {
  channel?: 'chat'
  channelId?: string
  visitorParticipantId?: string
  visit?: {
    userAgent?: string
    ipAddress?: string
    referrer?: string
    url?: string
    city?: string
    region?: string
    country?: string
    timezone?: string
  }
  claimedVisitorEmail?: string
  claimedVisitorName?: string
  visitorLabel?: string
}

/**
 * Narrow `Thread.metadata` to chat-shaped metadata. Returns null when the
 * thread has no metadata or the metadata is for a different channel.
 */
export function asChatThreadMetadata(
  metadata: Record<string, unknown> | null | undefined
): ChatThreadMetadata | null {
  if (!metadata) return null
  const m = metadata as ChatThreadMetadata
  if (m.channel !== 'chat') return null
  return m
}
