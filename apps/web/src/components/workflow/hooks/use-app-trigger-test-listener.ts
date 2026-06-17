// apps/web/src/components/workflow/hooks/use-app-trigger-test-listener.ts

import type { AppTriggerTestEvent } from '~/components/workflow/apps/trigger/types'
import { useTestEventListener } from '~/components/workflow/shared/test-events'
import { useAppTriggerTestStore } from '~/components/workflow/store/app-trigger-test-store'

export function useAppTriggerTestListener(installationId: string, triggerId: string) {
  return useTestEventListener<AppTriggerTestEvent>(
    useAppTriggerTestStore,
    `${installationId}:${triggerId}`
  )
}
