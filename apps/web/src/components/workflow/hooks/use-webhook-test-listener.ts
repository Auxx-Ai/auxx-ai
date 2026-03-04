// apps/web/src/components/workflow/hooks/use-webhook-test-listener.ts

import { useTestEventListener } from '~/components/workflow/shared/test-events'
import { useWebhookTestStore } from '~/components/workflow/store/webhook-test-store'
import type { WebhookTestEvent } from '../nodes/core/webhook/types'

export function useWebhookTestListener(workflowId: string) {
  return useTestEventListener<WebhookTestEvent>(useWebhookTestStore, workflowId)
}
