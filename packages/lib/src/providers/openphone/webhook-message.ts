// packages/lib/src/providers/openphone/webhook-message.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData } from '../../ingest/types'
import type { OpenPhoneIntegrationMetadata, QuoWebhookEvent, QuoWebhookMessage } from './types'

const logger = createScopedLogger('quo-webhook-message')

/**
 * Converts a Quo message webhook event into `MessageData`.
 *
 * **Lives in lib, not in the Next route, so the wire format is unit-testable.** Every bug this
 * channel has shipped was a field read that silently returned `undefined` — `body` instead of
 * `text`, a `conversationId` that is not on the payload — and none of them could be caught by a
 * test while the mapper was a private function inside a route handler. Fixtures for it are built
 * from a captured live payload (`Message.metadata.quo_webhook_event`), never from the docs.
 *
 * Reads the **webhook** message shape: `text` for the body and `to` as a plain string. REST
 * returns `to[]`, which is why the two remain separate types with separate mappers.
 *
 * Identifiers pass through as raw E.164; the ingest path maps `openphone` to
 * `IdentifierType.PHONE` and normalizes from there.
 *
 * @param conversationId Supplied by the caller — the payload carries none, so it has to be
 *   recovered from the envelope's `deepLink` first (see `deep-link.ts`). `null` means the
 *   message cannot be threaded by conversation key and will open its own thread.
 * @returns `null` when the event is unusable, which the caller treats as "ack and drop" — never
 *   throws, because a webhook that 500s gets retried forever.
 */
export function convertQuoWebhookEventToMessageData(
  event: QuoWebhookEvent<QuoWebhookMessage>,
  integrationId: string,
  organizationId: string,
  metadata: OpenPhoneIntegrationMetadata | null,
  conversationId: string | null
): MessageData | null {
  const message = event.data?.object
  if (!message?.id) {
    logger.error('Cannot convert Quo webhook event: no message object on the payload.', {
      eventId: event.id,
    })
    return null
  }

  try {
    const isInbound = message.direction === 'incoming'
    // Quo puts both sides on the payload. `metadata.phoneNumber` is only a fallback for our own
    // side of the exchange.
    const ourNumber = metadata?.phoneNumber
    const fromNumber = message.from || (isInbound ? undefined : ourNumber)
    const toNumber = message.to || (isInbound ? ourNumber : undefined)

    if (!fromNumber || !toNumber) {
      logger.warn('Missing sender or recipient number on Quo message webhook', {
        messageId: message.id,
        eventType: event.type,
      })
      return null
    }

    const createdTime = new Date(message.createdAt)
    if (Number.isNaN(createdTime.getTime())) {
      logger.warn('Unparseable createdAt on Quo message webhook', {
        messageId: message.id,
        createdAt: message.createdAt,
      })
      return null
    }

    return {
      externalId: message.id,
      externalThreadId: conversationId ?? undefined,
      integrationId,
      organizationId,
      createdTime,
      sentAt: createdTime,
      receivedAt: createdTime,
      subject: undefined, // SMS has no subject.
      from: { identifier: fromNumber },
      to: [{ identifier: toNumber }],
      cc: [],
      bcc: [],
      replyTo: [],
      // Quo has no inbound attachment ingestor, so no MessageAttachment rows are ever created
      // and `providerAttachments` is never populated. `hasAttachments` is a workflow trigger
      // filter (see workflow-engine/nodes/trigger-nodes/message-received.ts), so claiming true
      // here fires attachment rules for bytes that were never fetched. The raw payload —
      // including each entry's `media[].url` — is retained in `metadata.quo_webhook_event` for a
      // future backfill. Real MMS ingest is a follow-up.
      hasAttachments: false,
      textPlain: message.text,
      snippet: message.text?.substring(0, 100),
      isInbound,
      metadata: { quo_webhook_event: event },
      keywords: [],
      labelIds: [],
    } satisfies MessageData
  } catch (error) {
    logger.error('Failed to convert Quo webhook event data', {
      error: error instanceof Error ? error.message : String(error),
      eventId: event.id,
    })
    return null
  }
}
