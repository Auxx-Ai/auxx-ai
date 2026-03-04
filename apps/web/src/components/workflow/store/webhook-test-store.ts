// apps/web/src/components/workflow/store/webhook-test-store.ts

import { createTestEventStore } from '~/components/workflow/shared/test-events'
import type { WebhookTestEvent } from '../nodes/core/webhook/types'

export type { WebhookTestEvent }

export const useWebhookTestStore = createTestEventStore<WebhookTestEvent>(
  (workflowId) => `/api/workflows/${workflowId}/webhook/events`
)
