// apps/web/src/components/connections/triggers/types.ts

import type { BaseTestEvent } from '~/components/workflow/shared/test-events'

/** A delivery captured for the connection-webhook inspector (one connection + topic). */
export interface ConnectionWebhookTestEvent extends BaseTestEvent {
  source: 'webhook' | 'manual'
  topic: string
  triggerData: unknown
  eventId?: string
}
