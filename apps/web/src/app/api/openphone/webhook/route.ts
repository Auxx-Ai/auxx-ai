// apps/web/src/app/api/openphone/webhook/route.ts
// Inbound webhook endpoint for Quo (formerly OpenPhone).
//
// The provider key stays `openphone` everywhere it is persisted — Integration.provider,
// Credential.type, and this route path (which `providerWebhookCallbackUrl('openphone')` derives,
// so renaming it would invalidate every already-registered webhook). The rename is labels-only.
//
// Verification: Quo signs as `openphone-signature: hmac;1;<timestamp>;<base64 signature>` —
// HMAC-SHA256, base64 digest, over `${timestamp}.${rawBody}`, with the signing key base64-DECODED
// first. The timestamp comes from the header, which `WebhookVerifyPreset.signedPayload` (raw-body
// only) cannot express, so this call site parses the header and calls `verifyHmacSignature`
// directly, exactly like the Recall/Svix call site. `openphonePreset` documents the scheme as data.

import { database as db, schema } from '@auxx/database'
import type { MessageData } from '@auxx/lib/email'
import { MessageStorageService } from '@auxx/lib/email'
import type {
  OpenPhoneIntegrationMetadata,
  QuoWebhookEvent,
  QuoWebhookMessage,
} from '@auxx/lib/providers/openphone/types'
import { resolveWebhookSecret, verifyHmacSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('openphone-webhook')

/** Quo's signature header. Note: no `x-` prefix — that was the shape we wrongly shipped before. */
const SIGNATURE_HEADER = 'openphone-signature'

/** Replay window, in seconds. Matches the Recall/Svix call site's tolerance. */
const TIMESTAMP_TOLERANCE_SEC = 300

/** The events that carry a `phoneNumberId` and therefore resolve to one of our Integrations. */
type QuoPhoneScopedPayload = { phoneNumberId?: string }

/**
 * Handles an incoming Quo webhook event (POST).
 *
 * Always answers 200 for anything we deliberately do not process — Quo retries on non-2xx, and a
 * retry loop on an event we will never handle is worse than a dropped one.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let bodyText: string
  let payload: QuoWebhookEvent<QuoPhoneScopedPayload>

  try {
    // 1. Raw body first — the HMAC is computed over these exact bytes, never over re-serialized
    //    JSON.
    bodyText = await req.text()
    if (!bodyText) {
      logger.warn('Received empty request body for Quo webhook.')
      return NextResponse.json({ error: 'Bad Request: Empty body' }, { status: 400 })
    }

    payload = JSON.parse(bodyText)
    logger.debug('Parsed Quo webhook payload', { type: payload?.type, eventId: payload?.id })

    // 2. Resolve the Integration. Every phone-scoped event — `message.received`,
    //    `message.delivered`, `call.ringing`, `call.completed`, `call.recording.completed` —
    //    carries `phoneNumberId` at the same place, so one code path covers all five.
    const phoneNumberId = payload.data?.object?.phoneNumberId

    if (!phoneNumberId) {
      // `call.summary.completed`, `call.transcript.completed`, `contact.updated` and
      // `contact.deleted` carry NO `phoneNumberId`, so `metadata->>'phoneNumberId' = …` can never
      // match them. Do NOT subscribe to those events without first building the lookup they need:
      // summaries/transcripts require a `callId` → prior-call resolution, and contact events
      // require a credential-scoped (org-level) resolution rather than a channel-level one.
      logger.warn('Quo webhook payload carries no phoneNumberId; cannot resolve an integration.', {
        payloadType: payload.type,
        eventId: payload.id,
      })
      return NextResponse.json({ status: 'success - cannot identify integration' }, { status: 200 })
    }

    const [integration] = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        credentialId: schema.Integration.credentialId,
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.provider, 'openphone'),
          eq(schema.Integration.enabled, true),
          sql`${schema.Integration.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`
        )
      )
      .limit(1)

    if (!integration || !integration.metadata) {
      logger.warn('No active Quo integration found for phoneNumberId. Ignoring webhook event.', {
        phoneNumberId,
        eventType: payload.type,
      })
      return NextResponse.json({ status: 'success - no integration found' }, { status: 200 })
    }
    const metadata = integration.metadata as unknown as OpenPhoneIntegrationMetadata

    // 3. The signing secret lives encrypted on the linked Credential (Quo mints it and returns it
    //    from `POST /v1/webhooks/messages` → `data.key`; the provisioning hook writes it there).
    if (!integration.credentialId) {
      logger.error('Quo integration has no linked credential; cannot verify webhook.', {
        integrationId: integration.id,
      })
      return NextResponse.json(
        { error: 'Configuration Error: Missing credential' },
        { status: 500 }
      )
    }
    const signingSecret = await resolveWebhookSecret({
      kind: 'credentialField',
      credentialId: integration.credentialId,
      organizationId: integration.organizationId,
      field: 'webhookSigningSecret',
    })
    if (!signingSecret) {
      logger.error('Missing Quo webhook signing secret. Cannot verify signature.', {
        integrationId: integration.id,
      })
      return NextResponse.json(
        { error: 'Configuration Error: Missing signing secret' },
        { status: 500 }
      )
    }

    // 4. Verify the signature.
    const parsedSignature = parseQuoSignatureHeader(req.headers.get(SIGNATURE_HEADER))
    if (!parsedSignature) {
      logger.error('Missing or malformed openphone-signature header. Rejecting request.', {
        integrationId: integration.id,
      })
      return NextResponse.json({ error: 'Forbidden: Missing signature' }, { status: 403 })
    }

    const { timestamp, signature } = parsedSignature
    if (!isWithinTolerance(timestamp)) {
      logger.error('Quo webhook timestamp outside the tolerance window. Rejecting as a replay.', {
        integrationId: integration.id,
        timestamp,
      })
      return NextResponse.json({ error: 'Forbidden: Stale signature' }, { status: 403 })
    }

    const verified = verifyHmacSignature({
      rawBody: bodyText,
      signature,
      secret: signingSecret,
      encoding: 'base64',
      secretEncoding: 'base64',
      signedPayload: () => `${timestamp}.${bodyText}`,
    })
    if (!verified) {
      logger.error('Invalid openphone-signature. Request rejected.', {
        integrationId: integration.id,
      })
      return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
    }

    // 5. Process the events we subscribe to.
    switch (payload.type) {
      // `message.received` is inbound; `message.delivered` is the confirmation of an OUTBOUND
      // message (`direction: 'outgoing'`). Both go through the same store path: `storeMessage`
      // reconciles an outbound echo against the row our send pipeline already wrote (by
      // externalId, then by the reconciler's heuristics) and flips `sendStatus` to SENT, so this
      // both confirms our own sends AND captures messages an agent sent from the Quo app.
      case 'message.received':
      case 'message.delivered': {
        const event = payload as QuoWebhookEvent<QuoWebhookMessage>
        logger.info('Processing Quo message event', {
          type: payload.type,
          eventId: payload.id,
          integrationId: integration.id,
        })

        const messageData = convertQuoWebhookEventToMessageData(
          event,
          integration.id,
          integration.organizationId,
          metadata
        )
        if (!messageData) {
          logger.warn('Failed to convert Quo message event data', { eventId: payload.id })
          break
        }

        const storageService = new MessageStorageService(integration.organizationId)
        try {
          await storageService.storeMessage(messageData)
          logger.info('Stored Quo message', {
            mid: messageData.externalId,
            isInbound: messageData.isInbound,
            integrationId: integration.id,
          })
        } catch (storeError) {
          const message = storeError instanceof Error ? storeError.message : String(storeError)
          logger.error('Failed to store Quo message', {
            mid: messageData.externalId,
            integrationId: integration.id,
            error: message,
          })
          // `storeMessage` is idempotent on `(integrationId, externalId)` and swallows the
          // duplicate-key case itself, so anything reaching here is a real failure worth a retry.
          return NextResponse.json({ error: 'Failed to store message' }, { status: 500 })
        }
        break
      }

      // Call events are logged no-ops today. The names below are the real ones — there is no
      // `call.finished`. Turning any of these into a Message row needs a call-shaped payload
      // mapper (voicemail/recording `media[]`), which is out of scope here.
      case 'call.ringing':
      case 'call.completed':
      case 'call.recording.completed':
        logger.info('Received Quo call event (no-op)', {
          type: payload.type,
          eventId: payload.id,
          integrationId: integration.id,
        })
        break

      default:
        logger.debug('Ignoring unhandled Quo event type', { type: payload.type })
    }

    return NextResponse.json({ status: 'success' }, { status: 200 })
  } catch (error) {
    logger.error('Error processing Quo webhook:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Parses `hmac;1;<timestamp>;<base64 signature>`. Returns null for a missing, malformed, or
 * unknown-scheme header so the caller rejects before any crypto runs.
 */
function parseQuoSignatureHeader(
  headerValue: string | null
): { timestamp: string; signature: string } | null {
  if (!headerValue) return null
  const [scheme, version, timestamp, signature] = headerValue.split(';')
  if (scheme !== 'hmac' || !version || !timestamp || !signature) return null
  return { timestamp, signature }
}

/**
 * Replay guard over the header timestamp.
 *
 * Quo's timestamp is an ISO-8601 string on the current apiVersion and epoch milliseconds on
 * older ones, so both are parsed. If neither parses we SKIP the guard rather than reject: the
 * timestamp is inside the signed payload, so an unparseable value still cannot be forged — only
 * un-aged — and rejecting would take the channel down over a format change.
 */
function isWithinTolerance(timestamp: string): boolean {
  const trimmed = timestamp.trim()
  if (!trimmed) return true

  const numeric = Number(trimmed)
  let ms: number
  if (Number.isFinite(numeric)) {
    // A millisecond timestamp any time after 2001 is >= 1e12; anything smaller is seconds.
    ms = numeric < 1e12 ? numeric * 1000 : numeric
  } else {
    ms = Date.parse(trimmed)
  }
  if (!Number.isFinite(ms)) return true

  return Math.abs(Date.now() - ms) <= TIMESTAMP_TOLERANCE_SEC * 1000
}

/**
 * Converts a Quo message webhook event into `MessageData`.
 *
 * Reads the **webhook** message shape (`body`, `to` as a plain string, `direction: 'incoming'`) —
 * REST returns `text` and `to[]` instead, which is why the two are separate types with separate
 * mappers. Identifiers are passed through as raw E.164; the ingest path maps `openphone` to
 * `IdentifierType.PHONE` and normalizes from there.
 */
function convertQuoWebhookEventToMessageData(
  event: QuoWebhookEvent<QuoWebhookMessage>,
  integrationId: string,
  organizationId: string,
  metadata: OpenPhoneIntegrationMetadata | null
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
      externalThreadId: message.conversationId,
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
      textPlain: message.body,
      snippet: message.body?.substring(0, 100),
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
