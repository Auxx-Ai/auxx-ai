// packages/lib/src/data-connectors/webhooks/stripe.ts
// Stripe webhook capability (Step 8). Verifies the `Stripe-Signature` scheme
// (`t=<ts>,v1=<hmac>` over `${t}.${rawBody}` with the `whsec_` signing secret),
// dedupes by the event `id`, and resolves an event onto an upsert/delete by its
// `type`. Registration uses the Stripe REST API (`/v1/webhook_endpoints`).
//
// A Stripe event's object (`data.object`) carries `object: 'customer'` etc.; the
// stream key is that object name pluralized-by-convention is avoided — we use the
// raw object name as the stream key, and `*.deleted` event types archive.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createScopedLogger } from '@auxx/logger'
import type { RuntimeConnectionData } from '../../connections/resolve-connection-for-runtime'
import type { WebhookAction, WebhookCapability, WebhookSubscription } from '../types'

const logger = createScopedLogger('data-connector-webhook-stripe')

/** Default Stripe event types a connector subscribes to. */
const DEFAULT_EVENTS = ['customer.created', 'customer.updated', 'customer.deleted']

interface StripeEvent {
  id?: string
  type?: string
  data?: { object?: { id?: string; object?: string } }
}

/** Parse the `Stripe-Signature` header into its timestamp + v1 signatures. */
function parseSignature(header: string): { t: string; v1: string[] } {
  const parts = header.split(',').map((p) => p.trim())
  let t = ''
  const v1: string[] = []
  for (const part of parts) {
    const [k, v] = part.split('=')
    if (k === 't' && v) t = v
    if (k === 'v1' && v) v1.push(v)
  }
  return { t, v1 }
}

export const stripeWebhookCapability: WebhookCapability = {
  topics: DEFAULT_EVENTS,

  verify({ rawBody, headers, secret }) {
    if (!secret) return false
    const header = headers['stripe-signature'] ?? ''
    const { t, v1 } = parseSignature(header)
    if (!t || v1.length === 0) return false
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
    const eb = Buffer.from(expected)
    // Any v1 signature matching the expected digest passes (Stripe may send several).
    return v1.some((sig) => {
      const sb = Buffer.from(sig)
      return sb.length === eb.length && timingSafeEqual(sb, eb)
    })
  },

  eventId({ rawBody }) {
    try {
      return (JSON.parse(rawBody) as StripeEvent).id ?? null
    } catch {
      return null
    }
  },

  resolveWebhook({ payload }): WebhookAction[] {
    const event = payload as StripeEvent | null
    const type = event?.type
    const object = event?.data?.object
    if (!type || !object?.id) return []
    const streamKey = object.object ?? type.split('.')[0] ?? 'event'
    const externalId = String(object.id)
    if (type.endsWith('.deleted')) {
      return [{ kind: 'delete', streamKey, externalId }]
    }
    return [{ kind: 'upsert', streamKey, record: { streamKey, externalId, fields: object } }]
  },

  async register(input): Promise<WebhookSubscription[]> {
    const events = input.topics.length > 0 ? input.topics : DEFAULT_EVENTS
    const id = await stripeRequest(input.credential, 'POST', '/v1/webhook_endpoints', {
      url: input.callbackUrl,
      ...Object.fromEntries(events.map((e, i) => [`enabled_events[${i}]`, e])),
    })
    return id ? [{ topic: 'stripe-endpoint', externalId: id }] : []
  },

  async unregister(input) {
    for (const id of input.externalIds) {
      await stripeRequest(input.credential, 'DELETE', `/v1/webhook_endpoints/${id}`)
    }
  },
}

/** Make a form-encoded Stripe API call; returns the response `id` (POST) or null. */
async function stripeRequest(
  credential: RuntimeConnectionData | null,
  method: 'POST' | 'DELETE',
  path: string,
  form?: Record<string, string>
): Promise<string | null> {
  const key = credential?.value
  if (!key) {
    logger.warn('Stripe webhook: missing secret key on credential')
    return null
  }
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    })
    if (!res.ok) {
      logger.warn('Stripe webhook API error', { status: res.status, body: await res.text() })
      return null
    }
    const json = (await res.json()) as { id?: string }
    return json.id ?? null
  } catch (error) {
    logger.warn('Stripe webhook API request failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
