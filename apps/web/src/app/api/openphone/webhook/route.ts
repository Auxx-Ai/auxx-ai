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
import { MessageStorageService } from '@auxx/lib/email'
import { parseConversationIdFromDeepLink } from '@auxx/lib/providers/openphone/deep-link'
import type {
  OpenPhoneIntegrationMetadata,
  QuoWebhookEvent,
  QuoWebhookMessage,
} from '@auxx/lib/providers/openphone/types'
import { convertQuoWebhookEventToMessageData } from '@auxx/lib/providers/openphone/webhook-message'
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

        // The conversation key is not a field on the payload — recover it before mapping.
        // Without it every message opens its own thread (see `resolveQuoConversationId`).
        const conversationId = resolveQuoConversationId(event, { integrationId: integration.id })

        const messageData = convertQuoWebhookEventToMessageData(
          event,
          integration.id,
          integration.organizationId,
          metadata,
          conversationId
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
 * Recovers the Quo conversation id (`CN…`) for a message webhook event.
 *
 * **Why this exists.** The v4 message webhook payload carries no `conversationId` — verified
 * against a live event. Without one, `MessageData.externalThreadId` is undefined, ingest's alias
 * rung (`resolveThreadId`) has nothing to look up, `Thread.externalId` stays NULL, and every
 * inbound message opens a brand-new thread. SMS has no `In-Reply-To`/`References` either, so the
 * conversation key is the ONLY threading signal this channel has.
 *
 * The source is `data.deepLink`, whose `/c/<CN…>` segment carries the id. It is free,
 * synchronous, and arrives **inside the HMAC-signed body**, so it is authenticated by the same
 * signature that admitted the request.
 *
 * An earlier draft called `GET /v1/messages/{id}` first — `conversationId` is a documented field
 * there — and treated the link as a fallback. That was the wrong trade twice over: it spent an
 * API round-trip on **every inbound message** to re-fetch a fact the webhook had already
 * delivered, inside a handler Quo retries on non-2xx, and the value it fetched was no better
 * authenticated than the one already in hand. The webhook is the delivery mechanism for this
 * event; asking the API to repeat itself is not more correct, only slower.
 *
 * Never throws, and a miss returns `null` — which is exactly the pre-fix behaviour: the message
 * still stores, it just opens its own thread. Ingest must not be breakable by a lookup that is
 * an improvement over nothing.
 */
function resolveQuoConversationId(
  event: QuoWebhookEvent<QuoWebhookMessage>,
  ctx: { integrationId: string }
): string | null {
  const conversationId = parseConversationIdFromDeepLink(event.data?.deepLink)
  if (conversationId) return conversationId

  // Loud: a channel that silently forks every reply into its own thread is the failure this
  // whole function exists to stop, and it looks perfectly healthy in the logs otherwise.
  logger.error('Could not resolve a Quo conversation id — this message will open a new thread', {
    messageId: event.data?.object?.id,
    eventId: event.id,
    integrationId: ctx.integrationId,
    hasDeepLink: !!event.data?.deepLink,
  })
  return null
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
