// apps/web/src/components/workflow/nodes/core/app-trigger/types.ts

import type { BaseTestEvent } from '~/components/workflow/shared/test-events'

export interface AppTriggerTestEvent extends BaseTestEvent {
  source: 'webhook' | 'manual'
  triggerData: Record<string, unknown>
  eventId?: string
}
