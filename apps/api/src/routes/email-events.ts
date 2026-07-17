// apps/api/src/routes/email-events.ts

import { handleSnsEnvelope, verifySnsMessage } from '@auxx/lib/signals/email-events'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'
import type { AppContext } from '../types/context'

const log = createScopedLogger('email-events')

const emailEvents = new Hono<AppContext>()

/**
 * POST /webhooks/email-events
 * SES configuration-set → SNS (HTTPS subscription) delivery target. SNS posts JSON with
 * `content-type: text/plain`, so the body is read raw and parsed by `verifySnsMessage` rather
 * than via Hono's `c.req.json()`. No auth middleware — the SNS message signature IS the auth.
 */
emailEvents.post('/', async (c) => {
  const rawBody = await c.req.text()

  // Truthiness check on `.value` (rather than `.ok`) — `TypedResult`'s `ok` getter is typed
  // `boolean`, not a discriminant literal, so it doesn't narrow the union; checking `.value`
  // itself does (a parsed envelope/handled-result is always truthy, `undefined` is not).
  const verified = await verifySnsMessage(rawBody)
  if (!verified.value) {
    log.warn('SES/SNS envelope rejected', { error: verified.error?.message })
    return c.json({ error: verified.error?.message ?? 'Verification failed' }, 403)
  }

  const result = await handleSnsEnvelope(verified.value)
  if (!result.value) {
    log.error('SES/SNS envelope handling failed', { error: result.error?.message })
    return c.json({ error: result.error?.message ?? 'Handling failed' }, 500)
  }

  // Always 2xx once the envelope is verified — including "handled: message_not_found" or
  // "skipped:<eventType>" — SNS just needs an ack; a 500 here would trigger pointless retries
  // for events we deliberately don't track.
  log.info('SES/SNS envelope handled', { handled: result.value.handled })
  return c.json({ ok: true }, 200)
})

export default emailEvents
