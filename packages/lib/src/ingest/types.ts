// packages/lib/src/ingest/types.ts

import type { MessageType } from '../providers/types'

type JsonValue = any
type JsonArray = any

/**
 * Structure for participant info provided by provider conversion methods.
 * Flat object; `identifier` is the raw email/phone/PSID/etc.
 */
export interface ParticipantInputData {
  identifier: string
  name?: string | null
  raw?: string | null
}

/** Provider-side attachment metadata for downstream ingest (not persisted in DB). */
export interface MessageAttachmentMeta {
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId: string | null
  /** Gmail: body.attachmentId for large parts; null for embedded parts */
  providerAttachmentId?: string | null
  /** Gmail: base64url-encoded body.data for small embedded parts */
  embeddedData?: string | null
}

/** Structure for message data coming from provider conversion methods. */
export interface MessageData {
  externalId: string
  /**
   * The provider's conversation key, when it has one.
   *
   * **Optional on purpose.** Every write path already guards on it
   * (`recordThreadExternalKey`, `resolveByAlias`, `reconcileIncomingSync`) because a provider can
   * genuinely fail to supply one — Quo's message webhook carries no conversation id at all. The
   * type used to claim `string` while the Quo mapper handed it `undefined`, which is how an
   * un-threadable channel type-checked cleanly all the way to production.
   *
   * Absent means "cannot thread by conversation key": the Thread upsert inserts a NULL
   * `externalId`, and since Postgres treats NULLs as distinct in the
   * `(integrationId, externalId)` unique index, each such message opens its own thread.
   */
  externalThreadId?: string
  inboxId?: string
  integrationId: string
  organizationId: string

  /**
   * The message's form (email/sms/chat/call/voicemail). Optional so every
   * existing provider mapper keeps compiling unchanged — `storeMessage` falls
   * back to `getMessageTypeFromProvider(provider)` when a mapper does not
   * supply one. Only a mapper that can distinguish per-message (e.g. an
   * openphone call vs. text on the same integration) needs to set this.
   */
  messageType?: MessageType
  isInbound: boolean
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  snippet?: string | null
  metadata?: JsonValue | null
  createdTime: Date
  sentAt: Date
  receivedAt: Date

  from: ParticipantInputData
  to: ParticipantInputData[]
  cc?: ParticipantInputData[]
  bcc?: ParticipantInputData[]
  replyTo?: ParticipantInputData[]

  hasAttachments: boolean

  /** Object-backed body storage (set by ingest pipeline). */
  htmlBodyStorageLocationId?: string | null

  historyId?: number | null
  internetMessageId?: string | null
  keywords?: string[]
  labelIds?: string[]
  inReplyTo?: string | null
  references?: string | null
  /**
   * Our own `Message.id`, echoed back by the provider on the Sent-folder copy of a
   * message we sent, via the `X-AuxxAi-Message-Id` header.
   *
   * Microsoft Graph mints its own `Message-ID` and returns nothing from
   * `/me/sendMail`, so a Sent Items copy shares no identifier with the row we
   * created — it used to reconcile only by a subject-and-time heuristic, and
   * otherwise arrived as a duplicate in a forked thread. Custom `x-` headers are
   * the one thing Graph both accepts on send and preserves on the copy (verified
   * 2026-08-01: the copy came back carrying `X-AuxxAi-Message` and nothing else),
   * so this is an exact, latency-independent correlation key.
   */
  echoedMessageId?: string | null
  threadIndex?: string | null
  folderId?: string | null
  internetHeaders?: JsonArray | null
  isFirstInThread?: boolean | null
  isAIGenerated?: boolean | null

  providerAttachments?: MessageAttachmentMeta[]
}

/** Per-integration record-creation + filter settings, stored in Integration.metadata.settings. */
export interface IntegrationSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  excludeSenders?: string[]
  excludeRecipients?: string[]
  onlyProcessRecipients?: string[]
  [key: string]: any
}
