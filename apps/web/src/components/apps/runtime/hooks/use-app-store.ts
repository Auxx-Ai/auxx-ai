// apps/web/src/components/apps/runtime/hooks/use-app-store.ts

import { useInternalAppsContext } from '~/components/apps/providers/internal-apps-context'

/**
 * Hook to access the AppStore instance
 */
export function useAppStore() {
  const { store } = useInternalAppsContext()
  return store
}
