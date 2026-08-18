// packages/lib/src/providers/social/webhook-message.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData } from '../../ingest/types'
import { webhookAttachmentRefs } from './attachments'
import { socialThreadKey } from './thread-key'
import type {
  MetaWebhookMessagingEvent,
  SocialIntegrationMetadata,
  SocialPlatform,
  SocialSurface,
} from './types'

const logger = createScopedLogger('social-webhook-message')

const SNIPPET_LENGTH = 100

export interface ConvertMetaWebhookEventInput {
  event: MetaWebhookMessagingEvent
  integrationId: string
  organizationId: string
  /** The Page id (Messenger) or IG business account id this channel owns. */
  pageId: string
  platform: SocialPlatform
  metadata?: SocialIntegrationMetadata | null
  surface?: SocialSurface
}

/**
 * Converts one Meta `entry.messaging[]` event into `MessageData`.
 *
 * **Lives in lib, not in the Next route, so the wire format is unit-testable.** The
 * bug this replaces — `externalThreadId: senderPsid`, marked `!!! Placeholder !!!`
 * in both routes — was invisible to tests for as long as the mapper was a private
 * function inside a request handler.
 *
 * One converter for both platforms: Messenger and Instagram Direct share this wire
 * format exactly, differing only in which id space the participants live in (PSID
 * vs IGSID) and which side is "us". REST `/conversations` returns a *different*
 * shape and gets its own mapper — never reuse this one for it.
 *
 * @returns `null` when the event is unusable, which callers treat as "ack and
 * drop". Never throws: a webhook that 500s is retried by Meta indefinitely and
 * repeated failures get the subscription disabled.
 */
export function convertMetaWebhookEventToMessageData(
  input: ConvertMetaWebhookEventInput
): MessageData | null {
  const { event, integrationId, organizationId, pageId, platform, metadata } = input

  try {
    const message = event.message
    const externalId = message?.mid
    if (!externalId) {
      logger.warn('Meta messaging event has no message id; dropping', { platform, integrationId })
      return null
    }

    const senderId = event.sender?.id
    const recipientId = event.recipient?.id
    if (!senderId || !recipientId) {
      logger.warn('Meta messaging event is missing sender or recipient; dropping', {
        platform,
        integrationId,
        mid: externalId,
      })
      return null
    }

    // An echo is the page's own message played back to us, so the sides are
    // swapped relative to an inbound message. Deriving direction from which side
    // is the page — rather than assuming "webhook implies inbound" — is what keeps
    // our sends and the customer's messages on ONE thread key.
    const isEcho = message?.is_echo === true
    const pageSideId = isEcho ? senderId : recipientId
    const counterpartId = isEcho ? recipientId : senderId

    if (pageSideId !== pageId) {
      logger.warn('Meta messaging event does not name this channel as the page side; dropping', {
        platform,
        integrationId,
        mid: externalId,
        pageSideId,
        expectedPageId: pageId,
      })
      return null
    }

    const ourName =
      platform === 'instagram'
        ? (metadata?.instagramUsername ?? metadata?.pageName)
        : metadata?.pageName

    const pageParticipant = { name: ourName, identifier: pageId }
    const counterpartParticipant = { name: undefined, identifier: counterpartId }

    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now()
    const createdTime = new Date(timestamp)
    if (Number.isNaN(createdTime.getTime())) {
      logger.warn('Unparseable timestamp on Meta messaging event; dropping', {
        platform,
        integrationId,
        mid: externalId,
        timestamp: event.timestamp,
      })
      return null
    }

    const text = message?.text
    const attachmentRefs = webhookAttachmentRefs(message)
    // The snippet still falls back to the raw first attachment, which may be a
    // kind we deliberately do not download (a share, a location). "shared a link"
    // is a better snippet than an empty one.
    const firstAttachmentName =
      attachmentRefs[0]?.name ||
      attachmentRefs[0]?.type ||
      message?.attachments?.[0]?.payload?.title ||
      message?.attachments?.[0]?.type ||
      ''

    return {
      externalId,
      externalThreadId: socialThreadKey(pageId, counterpartId),
      integrationId,
      organizationId,
      createdTime,
      sentAt: createdTime,
      receivedAt: createdTime,
      subject: undefined,
      from: isEcho ? pageParticipant : counterpartParticipant,
      to: [isEcho ? counterpartParticipant : pageParticipant],
      cc: [],
      bcc: [],
      replyTo: [],
      // True as soon as the payload declares a downloadable attachment, not once
      // the bytes land. It describes the MESSAGE — the customer did send a photo —
      // and the workflow trigger filter reads it at store time, which is before the
      // route's `after()` ingest could possibly have finished. `Attachment` rows
      // follow from `ingestSocialAttachments`.
      hasAttachments: attachmentRefs.length > 0,
      textPlain: text ?? undefined,
      textHtml: undefined,
      snippet: text ? text.substring(0, SNIPPET_LENGTH) : firstAttachmentName,
      isInbound: !isEcho,
      metadata: { meta_webhook_event: event as unknown as Record<string, unknown> },
      keywords: [],
      labelIds: [],
    }
  } catch (error) {
    logger.error('Failed to convert Meta messaging event', {
      platform,
      integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
