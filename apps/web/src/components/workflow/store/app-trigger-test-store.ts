// apps/web/src/components/workflow/store/app-trigger-test-store.ts

import { createTestEventStore } from '~/components/workflow/shared/test-events'
import type { AppTriggerTestEvent } from '../nodes/core/app-trigger/types'

export const useAppTriggerTestStore = createTestEventStore<AppTriggerTestEvent>((key) => {
  const [installationId, triggerId] = key.split(':')
  return `/api/app-triggers/${installationId}/${triggerId}/events`
})
