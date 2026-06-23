// packages/lib/src/data-connectors/webhooks/stripe.ts
// Stripe webhook capability (Step 8). The read path (verify / event-id / topic→action)
// is declared as data in `stripeSpec` and compiled into the capability; only the
// registration half — the Stripe REST API (`/v1/webhook_endpoints`) — is coded here.

import { createScopedLogger } from '@auxx/logger'
import type { RuntimeConnectionData } from '../../connections/resolve-connection-for-runtime'
import { compileWebhookSpec, stripeSpec } from '../../webhooks/inbound'
import type {
  WebhookCapability,
  WebhookRegisterInput,
  WebhookSubscription,
  WebhookUnregisterInput,
} from '../types'

const logger = createScopedLogger('data-connector-webhook-stripe')

/** Default Stripe event types a connector subscribes to. */
const DEFAULT_EVENTS = ['customer.created', 'customer.updated', 'customer.deleted']

async function stripeRegister(input: WebhookRegisterInput): Promise<WebhookSubscription[]> {
  const events = input.topics.length > 0 ? input.topics : DEFAULT_EVENTS
  const id = await stripeRequest(input.credential, 'POST', '/v1/webhook_endpoints', {
    url: input.callbackUrl,
    ...Object.fromEntries(events.map((e, i) => [`enabled_events[${i}]`, e])),
  })
  return id ? [{ topic: 'stripe-endpoint', externalId: id }] : []
}

async function stripeUnregister(input: WebhookUnregisterInput): Promise<void> {
  for (const id of input.externalIds) {
    await stripeRequest(input.credential, 'DELETE', `/v1/webhook_endpoints/${id}`)
  }
}

export const stripeWebhookCapability: WebhookCapability = compileWebhookSpec(stripeSpec, {
  topics: DEFAULT_EVENTS,
  register: stripeRegister,
  unregister: stripeUnregister,
})

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
