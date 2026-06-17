// apps/web/src/components/workflow/store/app-trigger-test-store.ts

import type { AppTriggerTestEvent } from '~/components/workflow/apps/trigger/types'
import { createTestEventStore } from '~/components/workflow/shared/test-events'

export const useAppTriggerTestStore = createTestEventStore<AppTriggerTestEvent>((key) => {
  const [installationId, triggerId] = key.split(':')
  return `/api/app-triggers/${installationId}/${triggerId}/events`
})
