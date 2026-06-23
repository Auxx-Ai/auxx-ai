// packages/lib/src/data-connectors/webhooks/fixture.ts
// Provider-neutral webhook capability — proves the ingress spine with no external
// dependency (mirrors fixtureConnector). Used by tests + as the reference driver. The
// read path is declared in `fixtureSpec` (a shared-token verify, or unsigned in tests,
// over a self-describing payload); register/unregister are deterministic no-ops.

import { compileWebhookSpec, fixtureSpec } from '../../webhooks/inbound'
import type { WebhookCapability } from '../types'

export const fixtureWebhookCapability: WebhookCapability = compileWebhookSpec(fixtureSpec, {
  topics: ['fixture/upsert', 'fixture/delete'],
  // The fixture has no real provider — register/unregister are deterministic no-ops
  // that still return a subscription so the registration round-trip is exercisable.
  async register({ topics }) {
    return topics.map((topic) => ({ topic, externalId: `fixture-sub:${topic}` }))
  },
  async unregister() {
    /* no-op */
  },
})
