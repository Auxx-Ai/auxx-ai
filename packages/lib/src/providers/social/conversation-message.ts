// packages/lib/src/providers/social/conversation-message.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData } from '../../ingest/types'
import type { GraphConversation, GraphConversationMessage } from './api'
import {
  conversationAttachmentRefs,
  type SocialAttachmentRef,
  webhookAttachmentRefs,
} from './attachments'
import { socialThreadKey } from './thread-key'
import type { SocialPlatform } from './types'

const logger = createScopedLogger('social-conversation-message')

const SNIPPET_LENGTH = 100

/**
 * A conversation-message node's `message` field, as we are willing to receive it.
 *
 * **This is the one genuinely unverified shape in the FB/IG channel.** Nobody has
 * captured a real payload from `GET /{conversationId}/messages` — the only sync run
 * that ever reached this edge discarded every conversation on a client-side `since`
 * filter before fetching a single message (see
 * `plans/channels/facebook-instagram-runtime-fixes.md` WS7).
 *
 * What we believe, and why the code does not depend on it: Graph's Message node
 * documents `message` as a **scalar string**, which is why the old code's
 * `fields=message{text,attachments,mid}` was not a richer request but an invalid
 * expansion — subfield selection on a scalar is an error, so that fetch may simply
 * have been failing. `{@link listConversationMessages}` therefore asks for bare
 * `message` and this converter accepts **either** shape:
 *
 * - `message: "where's my order?"` — the documented scalar.
 * - `message: { text: "…", mid?, attachments? }` — the webhook-ish object, accepted
 *   because being wrong here means silently storing `[object Object]` as the body of
 *   five years of real customer mail.
 *
 * Run `packages/lib/scripts/probe-meta-conversations.ts` against the live channel to
 * settle it; once settled, the loser branch can go.
 */
export type GraphConversationMessageBody =
  | string
  | {
      text?: string
      mid?: string
      attachments?: Array<{ type?: string; payload?: { url?: string; title?: string } }>
    }

/** A `GraphConversationMessage` whose `message` may have arrived as an object. */
export type TolerantConversationMessage = Omit<GraphConversationMessage, 'message'> & {
  message?: GraphConversationMessageBody
}

/**
 * The message text, whichever shape Graph answered with.
 *
 * A non-string, non-object `message` (a number, an array) yields `undefined` rather
 * than a coerced string: an unexpected shape is a shape we do not understand, and
 * stringifying it stores garbage that looks like a customer wrote it.
 */
export function conversationMessageText(
  body: GraphConversationMessageBody | undefined
): string | undefined {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return typeof body.text === 'string' ? body.text : undefined
  }
  return undefined
}

/** Attachment descriptors, only present if `message` came back as an object. */
function conversationMessageAttachments(
  body: GraphConversationMessageBody | undefined
): Array<{ type?: string; payload?: { url?: string; title?: string } }> {
  if (body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body.attachments)) {
    return body.attachments
  }
  return []
}

/**
 * Every attachment on a conversation-message node, from whichever of the two
 * places Graph put them.
 *
 * The node's own `attachments` connection is the documented one and wins. The
 * fallback exists because the `message` field's object shape — the one this
 * module already tolerates rather than trusts — carries webhook-style
 * `{type, payload:{url}}` entries, and dropping those would mean a payload we
 * *did* understand still lost its photo. The two are alternatives, never merged:
 * a node answering both would be describing the same files twice, and duplicate
 * `attachmentOrder`s would store them twice.
 */
export function conversationMessageAttachmentRefs(
  message: TolerantConversationMessage | undefined | null
): SocialAttachmentRef[] {
  const fromConnection = conversationAttachmentRefs(message)
  if (fromConnection.length > 0) return fromConnection
  return webhookAttachmentRefs({ attachments: conversationMessageAttachments(message?.message) })
}

/**
 * The `mid` carried *inside* the message body, if the object shape is real.
 *
 * Kept separate from the node's own `id` because they are different ideas: `id`
 * identifies the node on this edge, `mid` is the id the webhook and the send path
 * both use. They are believed to be the same value (`m_…`) — see
 * {@link conversationMessageExternalId}.
 */
function conversationMessageMid(
  body: GraphConversationMessageBody | undefined
): string | undefined {
  if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.mid === 'string') {
    return body.mid
  }
  return undefined
}

/**
 * The id to store as `Message.externalId`.
 *
 * **`mid` wins when it is there, and the node's own `id` is the fallback — in that
 * order, deliberately.** `(integrationId, externalId)` is the idempotency key that
 * dedupes one message across all three doors (webhook, REST sync, our own send), and
 * the other two doors both stamp the `mid`. The node `id` on this edge is believed to
 * BE the `mid` (both are `m_…` strings), which would make the fallback exact rather
 * than merely adequate — but that is unverified, so the explicit `mid` is preferred
 * whenever the payload offers one.
 *
 * If the belief turns out to be wrong, the failure is visible and self-limiting: a
 * backfilled message would store under a second id and appear twice in one thread,
 * rather than landing in the wrong thread.
 */
export function conversationMessageExternalId(
  message: TolerantConversationMessage
): string | undefined {
  return conversationMessageMid(message.message) ?? message.id ?? undefined
}

/**
 * The non-us participant of a conversation.
 *
 * **`ourIds` is a set, not a single id, and that is deliberate.** Our side of an
 * Instagram conversation is the IG business account id — that is what the IG webhook
 * puts in `recipient.id`, so that is what the thread key must use — but the
 * `/conversations` edge is addressed on the *linked Page*, and nobody has verified which
 * of the two ids Graph lists as a participant for `platform=instagram`. Excluding both
 * makes the pick correct either way; matching on one would silently return our own Page
 * as "the customer" if the guess were wrong.
 *
 * Returns `null` for a conversation with no other party — a self-conversation, or a
 * participants list Graph declined to expand.
 */
export function pickConversationCounterpart(
  conversation: GraphConversation,
  ourIds: string | readonly string[]
): { id: string; name?: string } | null {
  const ours = new Set(typeof ourIds === 'string' ? [ourIds] : ourIds)
  const participants = conversation.participants?.data ?? []
  const other = participants.find((participant) => participant.id && !ours.has(participant.id))
  if (!other?.id) return null
  return { id: other.id, name: other.username ?? other.name }
}

export interface ConvertGraphConversationMessageInput {
  message: TolerantConversationMessage
  /** The `t_…` conversation id. Stored in `metadata` for deep links, never as a key. */
  conversationId?: string
  integrationId: string
  organizationId: string
  inboxId?: string
  /** Our side: the Page id (Messenger) or the IG business account id (Instagram). */
  ourId: string
  /**
   * Other ids that are also **us** on this conversation, and must be read as our
   * side without becoming the thread key.
   *
   * This exists for exactly one reason, and it is the same reason
   * {@link pickConversationCounterpart} takes a set: on Instagram our identity is
   * the IG business account id (that is what the IG webhook puts in
   * `recipient.id`, so that is what the key must use) while the `/conversations`
   * edge is addressed on the **linked Page**, and which of the two Graph names as
   * the business on a `platform=instagram` node is unverified.
   *
   * Excluding both from the counterpart pick but accepting only `ourId` as a
   * sender left the defence half-applied: if Graph answers with the Page id, the
   * counterpart is still picked correctly and **every message we ever sent is
   * dropped** as "a third party", silently, with only a warn log — an IG backfill
   * that stores the customer's half of five years of conversation and none of
   * ours. Matching the alias fixes the direction; `ourId` still supplies the
   * identifier and the key, so the thread stays byte-identical to the webhook's.
   */
  ourAliasIds?: readonly string[]
  /** The other party's PSID / IGSID, resolved from the conversation's participants. */
  counterpartId: string
  counterpartName?: string
  /** Our display name — page name, or IG handle. */
  ourName?: string
  platform: SocialPlatform
}

/**
 * Converts one `GET /{conversationId}/messages` node into `MessageData`.
 *
 * **A second converter, not a reuse of `webhook-message.ts`, and that is the point.**
 * The two doors carry different shapes: the webhook nests `{ mid, text, attachments }`
 * under `message` and names the parties `sender`/`recipient`; this edge answers a flat
 * node with `from`/`to` and (believed) a scalar `message`. Quo taught the same lesson
 * with `body` vs `text` — a shared mapper reads `undefined` on one of the two paths and
 * produces silently empty messages rather than crashing.
 *
 * What the two DO share is the thread key: `socialThreadKey(ourId, counterpartId)`,
 * byte-identical to what the webhook writes. There is no RFC 5322 parentage chain to
 * recover from a disagreement (`resolve-thread.ts` gates rung 2 to outlook/imap), so a
 * key that differs by one character forks the conversation permanently.
 *
 * @returns `null` when the node is unusable — no id, no resolvable direction, an
 * unparseable timestamp. Never throws: one malformed node must not abort a backfill.
 */
export function convertGraphConversationMessageToMessageData(
  input: ConvertGraphConversationMessageInput
): MessageData | null {
  const {
    message,
    conversationId,
    integrationId,
    organizationId,
    inboxId,
    ourId,
    counterpartId,
    counterpartName,
    ourName,
    platform,
  } = input

  try {
    const externalId = conversationMessageExternalId(message)
    if (!externalId) {
      logger.warn('Conversation message has no id; dropping', {
        platform,
        integrationId,
        conversationId,
      })
      return null
    }

    const senderId = message.from?.id
    if (!senderId) {
      logger.warn('Conversation message has no sender; dropping', {
        platform,
        integrationId,
        externalId,
      })
      return null
    }

    // Direction comes from which side sent it, never from "REST implies inbound".
    // A page's own replies are on this edge too, and misfiling them makes our
    // outbound history read as customer messages.
    let isInbound: boolean
    if (senderId === ourId || input.ourAliasIds?.includes(senderId)) {
      isInbound = false
    } else if (senderId === counterpartId) {
      isInbound = true
    } else {
      logger.warn('Conversation message names a third party as sender; dropping', {
        platform,
        integrationId,
        externalId,
        senderId,
        ourId,
        counterpartId,
      })
      return null
    }

    const createdTime = new Date(message.created_time ?? '')
    if (Number.isNaN(createdTime.getTime())) {
      logger.warn('Unparseable created_time on a conversation message; dropping', {
        platform,
        integrationId,
        externalId,
        createdTime: message.created_time,
      })
      return null
    }

    // `from` names the SENDER and nobody else. Stamping it on the counterpart too
    // names the customer after our own Page on every page-sent node, and the
    // participant upsert takes the last write that carries a usable name — so one
    // reply of ours anywhere in the batch renames the customer to the Page, and
    // every message they ever sent then renders as authored by us.
    const senderName = message.from?.username ?? message.from?.name
    const ourParticipant = {
      identifier: ourId,
      name: isInbound ? ourName : (senderName ?? ourName),
    }
    const counterpartParticipant = {
      identifier: counterpartId,
      name: isInbound ? (senderName ?? counterpartName) : counterpartName,
    }

    const text = conversationMessageText(message.message)
    const attachmentRefs = conversationMessageAttachmentRefs(message)
    // The snippet still falls back to the raw first descriptor, which may be a
    // kind we deliberately do not download (a share, a location).
    const rawAttachments = conversationMessageAttachments(message.message)
    const firstAttachmentName =
      attachmentRefs[0]?.name ||
      attachmentRefs[0]?.type ||
      rawAttachments[0]?.payload?.title ||
      rawAttachments[0]?.type ||
      ''

    return {
      externalId,
      // NOT the `t_…` conversation id. The webhook never receives one, so the REST
      // path must derive the SAME pair key or one conversation becomes two threads.
      externalThreadId: socialThreadKey(ourId, counterpartId),
      integrationId,
      inboxId,
      organizationId,
      createdTime,
      sentAt: createdTime,
      receivedAt: createdTime,
      // No subject. Messenger and IG have none, and the fabricated "commented on
      // your Facebook post" string this replaces was actively wrong — these are
      // DMs, not comments. Thread titles are participant-derived at render, the
      // same rule SMS follows.
      subject: undefined,
      from: isInbound ? counterpartParticipant : ourParticipant,
      to: [isInbound ? ourParticipant : counterpartParticipant],
      cc: [],
      bcc: [],
      replyTo: [],
      // True as soon as the payload declares a downloadable attachment, not once
      // the bytes land. It describes the MESSAGE — the customer did send a photo —
      // and the workflow trigger filter reads it at store time, which is before
      // any ingestor could have finished. `Attachment` rows follow from
      // `ingestSocialAttachments`, the same order Gmail's ingest uses.
      hasAttachments: attachmentRefs.length > 0,
      textPlain: text,
      textHtml: undefined,
      snippet: text ? text.substring(0, SNIPPET_LENGTH) : firstAttachmentName,
      isInbound,
      metadata: {
        meta_conversation_id: conversationId,
        meta_conversation_message: message as unknown as Record<string, unknown>,
      },
      keywords: [],
      labelIds: [],
    }
  } catch (error) {
    logger.error('Failed to convert a Meta conversation message', {
      platform,
      integrationId,
      messageId: message?.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
