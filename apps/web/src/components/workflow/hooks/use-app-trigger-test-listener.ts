// apps/web/src/components/workflow/hooks/use-app-trigger-test-listener.ts

import { useTestEventListener } from '~/components/workflow/shared/test-events'
import { useAppTriggerTestStore } from '~/components/workflow/store/app-trigger-test-store'
import type { AppTriggerTestEvent } from '../nodes/core/app-trigger/types'

export function useAppTriggerTestListener(installationId: string, triggerId: string) {
  return useTestEventListener<AppTriggerTestEvent>(
    useAppTriggerTestStore,
    `${installationId}:${triggerId}`
  )
}
