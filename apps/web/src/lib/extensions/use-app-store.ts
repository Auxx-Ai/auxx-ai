// apps/web/src/lib/extensions/use-app-store.ts

import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Hook to access the AppStore instance
 */
export function useAppStore() {
  const { store } = useInternalAppsContext()
  return store
}
