// apps/api/src/routes/tracking.ts
// Public email-tracking endpoints — open pixel + click redirect (Phase 2 of
// plans/signals/02-email-engagement.md "Tracking endpoints"). No auth — the signed token IS
// the auth (`verifyTrackingToken`/`verifyClickUrl` from `@auxx/lib/signals`). Two isolation
// rules drive the shape of both routes:
//   1. `GET /o/:token` (open pixel) ALWAYS serves the gif — token garbage, a missing Message
//      row, or a `recordSignal` throw must never surface as a broken image. Processing runs
//      fully inside its own try/catch, logged the way `email-events.ts` logs ingestion
//      failures, never awaited into the response.
//   2. `GET|HEAD /c/:token` (click redirect) is the opposite: an unverified `u=` MUST 400
//      rather than redirect — the signature check on `u` is the open-redirect guard, so a
//      failure there can't be papered over the way pixel failures are.
// HEAD is handled alongside GET for `/c/:token` because Outlook SafeLinks probes links with a
// HEAD request before a human's GET follows; it gets the same verify + redirect but records no
// signal, so a scanner sweep doesn't fabricate a click.

import { database, schema } from '@auxx/database'
import {
  classifyTrackingHit,
  recordSignal,
  type TrackingTokenPayload,
  toSignalRecordKey,
  verifyClickUrl,
  verifyTrackingToken,
} from '@auxx/lib/signals'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

const log = createScopedLogger('tracking-route')

/** 1x1 transparent GIF — served for every `/o/:token` hit, valid token or not. */
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

const PIXEL_HEADERS = { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private' }

interface RequestMeta {
  userAgent?: string
  ip?: string
}

function clientIp(headerValue: string | undefined): string | undefined {
  return headerValue?.split(',')[0]?.trim() || undefined
}

/** Minute-granularity bucket — dedupes rapid duplicate hits (prefetch/proxy re-fetch, the
 * HEAD-then-GET double-fire on click) within a minute while still letting a genuine repeat
 * open/click later record as its own signal. */
function minuteBucket(): number {
  return Math.floor(Date.now() / 60000)
}

const tracking = new Hono()

tracking.get('/o/:token', async (c) => {
  try {
    await recordOpen(c.req.param('token'), {
      userAgent: c.req.header('user-agent'),
      ip: clientIp(c.req.header('x-forwarded-for')),
    })
  } catch (error) {
    log.error('Failed to process open-pixel hit', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return c.body(PIXEL_GIF, 200, PIXEL_HEADERS)
})

tracking.on(['GET', 'HEAD'], '/c/:token', async (c) => {
  const token = c.req.param('token')
  const url = c.req.query('u')

  const verified = await verifyTrackingToken(token)
  if (
    !verified.value ||
    verified.value.type !== 'click' ||
    !url ||
    !verifyClickUrl(verified.value, url) ||
    !(url.startsWith('http://') || url.startsWith('https://'))
  ) {
    return c.text('Invalid tracking link', 400)
  }
  const payload = verified.value

  // HEAD is Outlook SafeLinks pre-fetching the link, not a human click — verify + redirect the
  // same way, but never record a signal for it.
  if (c.req.method === 'GET') {
    try {
      await recordClick(payload, url, {
        userAgent: c.req.header('user-agent'),
        ip: clientIp(c.req.header('x-forwarded-for')),
      })
    } catch (error) {
      log.error('Failed to process click-redirect hit', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  c.header('Cache-Control', 'no-store, private')
  return c.redirect(url, 302)
})

/** Verifies the open token, resolves the Message it belongs to, classifies the hit, and writes
 * an `email:opened` signal. Every failure mode (bad token, wrong type, unknown/mismatched
 * message) is a silent no-op — the caller's try/catch + always-serve-the-pixel behavior is
 * what keeps this from ever affecting the HTTP response. */
async function recordOpen(token: string, request: RequestMeta): Promise<void> {
  const verified = await verifyTrackingToken(token)
  if (!verified.value || verified.value.type !== 'open') return
  const payload = verified.value

  // Mirrors `email-events.ts`'s `resolveMessageBySesId` DB-access style, but the tracking
  // token already carries the Message row id directly (no externalId hop needed).
  const message = await database.query.Message.findFirst({
    where: eq(schema.Message.id, payload.messageId),
  })
  if (!message || message.organizationId !== payload.organizationId) return

  const sentAt = message.sentAt ?? message.createdAt
  const { isBot, botReason } = classifyTrackingHit({ userAgent: request.userAgent, sentAt })

  const contactId = payload.contactEntityInstanceId
  const result = await recordSignal({
    organizationId: payload.organizationId,
    kind: 'email:opened',
    subtype: 'default',
    dedupeKey: `track:o:${payload.messageId}:${contactId ?? 'anon'}:${minuteBucket()}`,
    contactEntityInstanceId: contactId,
    messageId: payload.messageId,
    title: 'Email opened',
    isBot,
    metadata: {
      userAgent: request.userAgent,
      ip: request.ip,
      ...(botReason ? { botReason } : {}),
    },
    links: contactId ? [toSignalRecordKey('contact', contactId)] : [],
  })
  if (result.error) {
    log.error('recordSignal failed for open-pixel hit', {
      organizationId: payload.organizationId,
      messageId: payload.messageId,
      error: result.error.message,
    })
  }
}

/** Resolves the Message the (already URL-verified) click token belongs to and writes an
 * `email:clicked` signal. Same silent-no-op-on-failure shape as {@link recordOpen} — called
 * only after the redirect response is already being sent, so a failure here must never
 * surface to the caller. */
async function recordClick(
  payload: TrackingTokenPayload,
  url: string,
  request: RequestMeta
): Promise<void> {
  const message = await database.query.Message.findFirst({
    where: eq(schema.Message.id, payload.messageId),
  })
  if (!message || message.organizationId !== payload.organizationId) return

  const sentAt = message.sentAt ?? message.createdAt
  const { isBot, botReason } = classifyTrackingHit({ userAgent: request.userAgent, sentAt })

  const contactId = payload.contactEntityInstanceId
  const result = await recordSignal({
    organizationId: payload.organizationId,
    kind: 'email:clicked',
    subtype: 'default',
    dedupeKey: `track:c:${payload.messageId}:${payload.urlHash}:${minuteBucket()}`,
    contactEntityInstanceId: contactId,
    messageId: payload.messageId,
    title: 'Email link clicked',
    isBot,
    metadata: {
      userAgent: request.userAgent,
      ip: request.ip,
      linkUrl: url,
      ...(botReason ? { botReason } : {}),
    },
    links: contactId ? [toSignalRecordKey('contact', contactId)] : [],
  })
  if (result.error) {
    log.error('recordSignal failed for click-redirect hit', {
      organizationId: payload.organizationId,
      messageId: payload.messageId,
      error: result.error.message,
    })
  }
}

export default tracking
