// apps/web/src/components/webhooks/hooks/use-webhook-endpoint-events.ts
// Live-delivery listener for a generic inbound WebhookEndpoint. The event shape mirrors
// what the ingress writes to Redis (`pushWebhookEndpointEvent` in apps/api webhooks.ts):
// the per-delivery topic travels on the payload so binding-scoped views can filter on it.
// Thin configs over the shared SSE test-event primitives.

'use client'

import {
  type BaseTestEvent,
  createTestEventStore,
  useTestEventListener,
} from '~/components/workflow/shared/test-events'

export interface WebhookEndpointTestEvent extends BaseTestEvent {
  source: 'webhook'
  /** The topic extracted from this delivery ('' when the endpoint declares no topic source). */
  topic: string
  triggerData: Record<string, unknown>
  eventId?: string
}

const useWebhookEndpointTestStore = createTestEventStore<WebhookEndpointTestEvent>(
  (endpointId) => `/api/webhook-endpoints/${endpointId}/events`
)

/** Subscribe to the live delivery stream for one endpoint (listen/stop/clear + events). */
export function useWebhookEndpointTestListener(endpointId: string) {
  return useTestEventListener<WebhookEndpointTestEvent>(useWebhookEndpointTestStore, endpointId)
}
