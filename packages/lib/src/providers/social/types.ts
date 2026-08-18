// packages/lib/src/providers/social/types.ts

/** The two Meta channels that share this wire format. */
export type SocialPlatform = 'facebook' | 'instagram'

/**
 * Which Meta surface an event arrived on.
 *
 * A one-member union today. It exists so post comments (WS10) add a case to the
 * existing converter instead of growing a second one — `entry.messaging` and
 * `entry.changes` are different envelopes carrying different identity, and the
 * lesson from Quo is that two wire shapes need two mappers, never one that guesses.
 */
export type SocialSurface = 'dm'

/** `entry.messaging[].message` — the inbound/echo message body. */
export interface MetaWebhookMessage {
  mid?: string
  text?: string
  /** Present (and `true`) on echoes of messages the page itself sent. */
  is_echo?: boolean
  /** Present when the user replied to a specific message. */
  reply_to?: { mid?: string }
  attachments?: MetaWebhookAttachment[]
}

export interface MetaWebhookAttachment {
  type?: string
  payload?: {
    url?: string
    title?: string
    sticker_id?: number
  }
}

/**
 * One entry in `entry.messaging[]`.
 *
 * `sender`/`recipient` swap by direction: on an inbound message the sender is the
 * user and the recipient is the page; on an echo it is the other way round. Every
 * consumer must derive the page side explicitly rather than assuming a position.
 */
export interface MetaWebhookMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  /** Milliseconds since epoch. */
  timestamp?: number
  message?: MetaWebhookMessage
  delivery?: { mids?: string[]; watermark?: number }
  read?: { watermark?: number }
  postback?: { mid?: string; title?: string; payload?: string }
}

/** One `entry` of the webhook envelope. */
export interface MetaWebhookEntry {
  id?: string
  time?: number
  /** DMs. */
  messaging?: MetaWebhookMessagingEvent[]
  /**
   * Comments, reactions, and other page-feed activity. Never populated today —
   * we subscribe to `messages,messaging_postbacks,message_reads` only — and the
   * routes log-and-drop it. WS10 fills this in.
   */
  changes?: unknown[]
}

/** Top-level webhook body. `object` is `page` for Messenger, `instagram` for IG. */
export interface MetaWebhookEnvelope {
  object?: string
  entry?: MetaWebhookEntry[]
}

/**
 * Integration metadata fields this module reads. Structural on purpose — the
 * provider-specific metadata interfaces live with their providers and carry more.
 */
export interface SocialIntegrationMetadata {
  pageId?: string
  pageName?: string
  instagramBusinessAccountId?: string
  instagramUsername?: string
}
