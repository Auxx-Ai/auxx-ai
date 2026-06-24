// apps/web/src/components/connections/triggers/use-connection-webhook-test-listener.ts

import { useTestEventListener } from '~/components/workflow/shared/test-events'
import { useConnectionWebhookTestStore } from './connection-webhook-test-store'
import type { ConnectionWebhookTestEvent } from './types'

export function useConnectionWebhookTestListener(connectionId: string, topic: string) {
  return useTestEventListener<ConnectionWebhookTestEvent>(
    useConnectionWebhookTestStore,
    `${connectionId}:${topic}`
  )
}
