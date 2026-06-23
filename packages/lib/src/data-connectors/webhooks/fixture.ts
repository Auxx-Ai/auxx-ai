// packages/lib/src/data-connectors/webhooks/fixture.ts
// Provider-neutral webhook capability — proves the ingress spine with no external
// dependency (mirrors fixtureConnector). Used by tests + as the reference driver.
// `verify` is a plain timing-safe secret-header compare; `resolveWebhook` maps a
// self-describing payload straight onto sink actions.

import { timingSafeEqual } from 'node:crypto'
import type { WebhookAction, WebhookCapability } from '../types'

/** A fixture webhook payload — already shaped as one action's worth of data. */
interface FixturePayload {
  topic?: string
  streamKey: string
  externalId: string
  fields?: Record<string, unknown>
  displayName?: string
  deleted?: boolean
}

/** Constant-time string compare that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const fixtureWebhookCapability: WebhookCapability = {
  topics: ['fixture/upsert', 'fixture/delete'],

  verify({ headers, secret }) {
    if (!secret) return true // an unsecured fixture endpoint (tests)
    return safeEqual(headers['x-fixture-signature'] ?? '', secret)
  },

  eventId({ headers }) {
    return headers['x-fixture-event-id'] ?? null
  },

  resolveWebhook({ payload }): WebhookAction[] {
    const p = payload as FixturePayload | null
    if (!p?.streamKey || !p?.externalId) return []
    if (p.deleted) {
      return [{ kind: 'delete', streamKey: p.streamKey, externalId: p.externalId }]
    }
    return [
      {
        kind: 'upsert',
        streamKey: p.streamKey,
        record: {
          streamKey: p.streamKey,
          externalId: p.externalId,
          displayName: p.displayName,
          fields: p.fields ?? {},
        },
      },
    ]
  },

  // The fixture has no real provider — register/unregister are deterministic no-ops
  // that still return a subscription so the registration round-trip is exercisable.
  async register({ topics }) {
    return topics.map((topic) => ({ topic, externalId: `fixture-sub:${topic}` }))
  },

  async unregister() {
    /* no-op */
  },
}
