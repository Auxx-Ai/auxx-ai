// apps/web/src/components/connections/triggers/connection-webhook-test-store.ts

import { createTestEventStore } from '~/components/workflow/shared/test-events'
import type { ConnectionWebhookTestEvent } from './types'

// Key is `${connectionId}:${topic}`; topics carry `/` or `.` but never `:`, so we
// split on the first colon (topic may otherwise look like `orders/create`).
export const useConnectionWebhookTestStore = createTestEventStore<ConnectionWebhookTestEvent>(
  (key) => {
    const idx = key.indexOf(':')
    const connectionId = key.slice(0, idx)
    const topic = key.slice(idx + 1)
    return `/api/connection-webhooks/${connectionId}/${encodeURIComponent(topic)}/events`
  }
)
