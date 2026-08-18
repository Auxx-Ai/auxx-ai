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
import {
  type AttachmentIngestInput,
  InboundAttachmentIngestService,
  MessageStorageService,
} from '@auxx/lib/email'
import { parseConversationIdFromDeepLink } from '@auxx/lib/providers/openphone/deep-link'
import type {
  OpenPhoneIntegrationMetadata,
  QuoWebhookCall,
  QuoWebhookEvent,
  QuoWebhookMessage,
} from '@auxx/lib/providers/openphone/types'
import { convertQuoWebhookCallEventToMessageData } from '@auxx/lib/providers/openphone/webhook-call'
import { convertQuoWebhookEventToMessageData } from '@auxx/lib/providers/openphone/webhook-message'
import { getRealtimeService, publishMessageUpdated } from '@auxx/lib/realtime'
import { resolveWebhookSecret, verifyHmacSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, like, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('openphone-webhook')

/** Quo's signature header. Note: no `x-` prefix — that was the shape we wrongly shipped before. */
const SIGNATURE_HEADER = 'openphone-signature'

/** Replay window, in seconds. Matches the Recall/Svix call site's tolerance. */
const TIMESTAMP_TOLERANCE_SEC = 300

/**
 * Cap on a single fetched media file (voicemail or call recording). REST never returns this
 * media (see the Quo plan's "Inbound media"), so the webhook delivery is the only shot at it —
 * this cap exists purely to stop a pathological response from blowing up memory, not because we
 * expect to hit it.
 */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024

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

      // `call.ringing` never creates a row — we don't subscribe to it (see
      // `QuoCreateMessageWebhookInput`), but a stray delivery (e.g. from a webhook created
      // before this shipped) is still handled as a harmless no-op rather than falling to
      // `default`, so it's obvious in logs this is deliberate, not unhandled.
      case 'call.ringing':
        logger.info('Received Quo call.ringing event (no-op)', {
          eventId: payload.id,
          integrationId: integration.id,
        })
        break

      // A completed (answered or missed) call becomes a Message row: `CALL`, or `VOICEMAIL`
      // when the call carries voicemail audio. Voicemail bytes are fetched right here, because
      // REST never returns call media at all (message-type-overhaul plan §"Inbound media") —
      // this webhook delivery is the only chance to capture them.
      case 'call.completed': {
        const event = payload as QuoWebhookEvent<QuoWebhookCall>
        logger.info('Processing Quo call.completed event', {
          eventId: payload.id,
          integrationId: integration.id,
        })

        const conversationId = resolveQuoConversationId(event, { integrationId: integration.id })
        const messageData = convertQuoWebhookCallEventToMessageData(
          event,
          integration.id,
          integration.organizationId,
          metadata,
          conversationId
        )
        if (!messageData) {
          logger.warn('Failed to convert Quo call.completed event data', { eventId: payload.id })
          break
        }

        const storageService = new MessageStorageService(integration.organizationId)
        let stored: { messageId: string; isNew: boolean }
        try {
          stored = await storageService.storeMessage(messageData)
          logger.info('Stored Quo call', {
            mid: messageData.externalId,
            messageType: messageData.messageType,
            isNew: stored.isNew,
            integrationId: integration.id,
          })
        } catch (storeError) {
          const message = storeError instanceof Error ? storeError.message : String(storeError)
          logger.error('Failed to store Quo call', {
            mid: messageData.externalId,
            integrationId: integration.id,
            error: message,
          })
          return NextResponse.json({ error: 'Failed to store call' }, { status: 500 })
        }

        const voicemail = event.data?.object?.voicemail
        if (voicemail?.url) {
          // Checked by attachment existence, NOT `stored.isNew`: after a fetch failure below we
          // return 500 so Quo redelivers the same event, and by then `storeMessage` has already
          // upserted the row, so `isNew` would read false on the retry and silently skip the
          // fetch forever. An existing-attachment check is idempotent across any number of
          // redeliveries regardless of `isNew`. Scoped to voicemail files so a recording that
          // somehow attached first can never block the voicemail (and vice versa below).
          const alreadyIngested = await hasExistingAttachment(
            stored.messageId,
            integration.organizationId,
            'voicemail.'
          )
          if (alreadyIngested) {
            logger.debug('Voicemail already ingested for this call; skipping refetch', {
              messageId: stored.messageId,
              eventId: payload.id,
            })
            break
          }

          const bytes = await fetchQuoMediaBytes(voicemail.url, {
            eventId: payload.id,
            kind: 'voicemail',
          })
          if (!bytes) {
            // The presigned URL is only valid for this delivery attempt and REST never returns
            // voicemail media, so a dropped fetch here is unrecoverable once this response is
            // sent. Returning 500 makes Quo redeliver with a fresh URL; `storeMessage` already
            // upserted on `externalId` above, so the redelivery is safe and simply retries the
            // fetch (see the `hasExistingAttachment` guard above for why it isn't skipped).
            return NextResponse.json({ error: 'Failed to fetch voicemail media' }, { status: 500 })
          }

          try {
            const ingestService = new InboundAttachmentIngestService()
            const input: AttachmentIngestInput = {
              content: bytes,
              filename: `voicemail.${extensionForMimeType(voicemail.type)}`,
              mimeType: voicemail.type || 'audio/mpeg',
              inline: false,
              attachmentOrder: 0,
            }
            // `skipReconciliation`: this call only ever carries the voicemail, never the full
            // attachment set for the message, so reconciliation would delete anything a later
            // `call.recording.completed` adds (or vice versa).
            await ingestService.ingestAll(
              [input],
              {
                organizationId: integration.organizationId,
                messageId: stored.messageId,
                contentScopeId: messageData.externalId,
              },
              { skipReconciliation: true }
            )
            logger.info('Ingested Quo voicemail attachment', {
              messageId: stored.messageId,
              eventId: payload.id,
            })
          } catch (ingestError) {
            const message = ingestError instanceof Error ? ingestError.message : String(ingestError)
            logger.error('Failed to ingest Quo voicemail attachment', {
              messageId: stored.messageId,
              eventId: payload.id,
              error: message,
            })
            return NextResponse.json(
              { error: 'Failed to ingest voicemail attachment' },
              { status: 500 }
            )
          }
        }
        break
      }

      // Attaches the recording to the call row `call.completed` already created. Dropped
      // silently when no such row exists (a call from before this feature shipped) — there is
      // no retriable fix for a missing parent message.
      case 'call.recording.completed': {
        const event = payload as QuoWebhookEvent<QuoWebhookCall>
        const callId = event.data?.object?.id
        logger.info('Processing Quo call.recording.completed event', {
          eventId: payload.id,
          integrationId: integration.id,
        })

        if (!callId) {
          logger.warn('Quo recording event carries no call id', { eventId: payload.id })
          break
        }

        const [existing] = await db
          .select({
            id: schema.Message.id,
            threadId: schema.Message.threadId,
            hasAttachments: schema.Message.hasAttachments,
          })
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.organizationId, integration.organizationId),
              eq(schema.Message.integrationId, integration.id),
              eq(schema.Message.externalId, callId)
            )
          )
          .limit(1)

        if (!existing) {
          // Recording events only flow on webhooks that also subscribe to `call.completed`, so
          // a missing parent row is almost always an out-of-order delivery, not a call from
          // before this shipped. 500 makes Quo redeliver, by which time the call row exists;
          // for a genuinely orphaned recording, Quo's bounded retries give up on their own.
          logger.warn('No stored call found for Quo recording event; retrying via 500', {
            callId,
            eventId: payload.id,
            integrationId: integration.id,
          })
          return NextResponse.json({ error: 'No stored call for recording yet' }, { status: 500 })
        }

        // Scoped to recording files: a voicemail attachment on the same call must not read as
        // "recording already ingested".
        const alreadyIngested = await hasExistingAttachment(
          existing.id,
          integration.organizationId,
          'recording-'
        )
        if (alreadyIngested) {
          logger.debug('Recording already ingested for this call; skipping', {
            messageId: existing.id,
            eventId: payload.id,
          })
          break
        }

        const media = event.data?.object?.media ?? []
        if (media.length === 0) {
          logger.warn('Quo recording event carries no media', { callId, eventId: payload.id })
          break
        }

        // All-or-nothing across the media entries: ingesting a partial set and then 500ing
        // would make the redelivery see recordings already present and skip the rest forever
        // (the existence check above is per-kind, not per-entry). Fetch everything first;
        // ingest only a complete set.
        const inputs: AttachmentIngestInput[] = []
        let anyFetchFailed = false
        for (let i = 0; i < media.length; i++) {
          const item = media[i]!
          const bytes = await fetchQuoMediaBytes(item.url, {
            eventId: payload.id,
            kind: 'recording',
          })
          if (!bytes) {
            anyFetchFailed = true
            break
          }
          inputs.push({
            content: bytes,
            filename: `recording-${i}.${extensionForMimeType(item.type)}`,
            mimeType: item.type || 'audio/mpeg',
            inline: false,
            attachmentOrder: i,
          })
        }
        if (anyFetchFailed) {
          return NextResponse.json({ error: 'Failed to fetch recording media' }, { status: 500 })
        }

        if (inputs.length > 0) {
          try {
            const ingestService = new InboundAttachmentIngestService()
            await ingestService.ingestAll(
              inputs,
              {
                organizationId: integration.organizationId,
                messageId: existing.id,
                contentScopeId: callId,
              },
              { skipReconciliation: true }
            )
            logger.info('Ingested Quo call recording attachment(s)', {
              messageId: existing.id,
              count: inputs.length,
              eventId: payload.id,
            })

            if (!existing.hasAttachments) {
              await db
                .update(schema.Message)
                .set({ hasAttachments: true, updatedAt: new Date() })
                .where(eq(schema.Message.id, existing.id))

              const [thread] = await db
                .select({ inboxId: schema.Thread.inboxId, assigneeId: schema.Thread.assigneeId })
                .from(schema.Thread)
                .where(eq(schema.Thread.id, existing.threadId))
                .limit(1)

              await publishMessageUpdated(getRealtimeService(), integration.organizationId, {
                messageId: existing.id,
                threadId: existing.threadId,
                inboxId: thread?.inboxId ?? null,
                assigneeId: thread?.assigneeId ?? null,
                patch: { hasAttachments: true },
              }).catch((error) => {
                logger.warn('Failed to publish message:updated for Quo recording', {
                  messageId: existing.id,
                  error: error instanceof Error ? error.message : String(error),
                })
              })
            }
          } catch (ingestError) {
            const message = ingestError instanceof Error ? ingestError.message : String(ingestError)
            logger.error('Failed to ingest Quo call recording attachment(s)', {
              messageId: existing.id,
              eventId: payload.id,
              error: message,
            })
            return NextResponse.json(
              { error: 'Failed to ingest recording attachment' },
              { status: 500 }
            )
          }
        }

        break
      }

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
 * Recovers the Quo conversation id (`CN…`) for a message OR call webhook event — both share the
 * same envelope shape, and neither payload object carries `conversationId` (verified live, v4).
 *
 * **Why this exists.** Without one, `MessageData.externalThreadId` is undefined, ingest's alias
 * rung (`resolveThreadId`) has nothing to look up, `Thread.externalId` stays NULL, and every
 * inbound message/call opens a brand-new thread. SMS/calls have no `In-Reply-To`/`References`
 * either, so the conversation key is the ONLY threading signal this channel has.
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
 * Never throws, and a miss returns `null` — which is exactly the pre-fix behaviour: the
 * message/call still stores, it just opens its own thread. Ingest must not be breakable by a
 * lookup that is an improvement over nothing.
 */
function resolveQuoConversationId<T extends { id?: string }>(
  event: QuoWebhookEvent<T>,
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
 * Whether the message already has an Attachment row of the given kind (voicemail vs recording,
 * distinguished by the filename prefix this route itself assigns — `Attachment.title` carries the
 * ingest filename). Per-kind, so the two media kinds on one call never mask each other. Used to
 * make voicemail and recording ingest idempotent across webhook redeliveries WITHOUT relying on `storeMessage`'s
 * `isNew` flag, which flips false on any redelivery once the row exists — including a redelivery
 * triggered by returning 500 from a failed media fetch, which is exactly the case that must still
 * retry.
 */
async function hasExistingAttachment(
  messageId: string,
  organizationId: string,
  titlePrefix: 'voicemail.' | 'recording-'
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.Attachment.id })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.organizationId, organizationId),
        eq(schema.Attachment.entityType, 'MESSAGE'),
        eq(schema.Attachment.entityId, messageId),
        like(schema.Attachment.title, `${titlePrefix}%`)
      )
    )
    .limit(1)
  return !!row
}

/**
 * Fetches one voicemail or recording media URL as bytes. Plain `fetch` — Quo hands out
 * presigned CDN URLs, not API endpoints, so there is no auth header to add (`quoFetch` is
 * JSON-only and cannot be reused here).
 *
 * Returns `null` on any failure (non-2xx, over the size cap, or a network error) and never
 * throws; the caller decides retry policy.
 */
async function fetchQuoMediaBytes(
  url: string,
  ctx: { eventId: string; kind: 'voicemail' | 'recording' }
): Promise<Buffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      logger.error('Quo media fetch returned a non-2xx status', {
        status: res.status,
        kind: ctx.kind,
        eventId: ctx.eventId,
      })
      return null
    }

    const contentLength = res.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_MEDIA_BYTES) {
      logger.error('Quo media exceeds the size cap; skipping', {
        contentLength,
        kind: ctx.kind,
        eventId: ctx.eventId,
      })
      return null
    }

    const arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
      logger.error('Quo media exceeded the size cap after download; skipping', {
        size: arrayBuffer.byteLength,
        kind: ctx.kind,
        eventId: ctx.eventId,
      })
      return null
    }

    return Buffer.from(arrayBuffer)
  } catch (error) {
    logger.error('Quo media fetch failed', {
      error: error instanceof Error ? error.message : String(error),
      kind: ctx.kind,
      eventId: ctx.eventId,
    })
    return null
  }
}

/** Best-effort extension for the attachment filename. Defaults to `mp3` — Quo's common case. */
function extensionForMimeType(mimeType: string | undefined): string {
  switch (mimeType) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'm4a'
    case 'audio/ogg':
      return 'ogg'
    default:
      // Includes 'audio/mpeg', Quo's common case.
      return 'mp3'
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
