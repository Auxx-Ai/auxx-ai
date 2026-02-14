// apps/web/src/components/groups/providers/groups-provider.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useGroups } from '../hooks'

/** Groups context value */
interface GroupsContextValue {
  isLoading: boolean
  refetch: () => void
}

const GroupsContext = createContext<GroupsContextValue | null>(null)

/** Props for GroupsProvider */
interface GroupsProviderProps {
  children: ReactNode
}

/**
 * Provider that loads and manages groups state
 * Wrap components that need access to groups data
 */
export function GroupsProvider({ children }: GroupsProviderProps) {
  const { isLoading, refetch } = useGroups()

  return <GroupsContext.Provider value={{ isLoading, refetch }}>{children}</GroupsContext.Provider>
}

/**
 * Hook to access groups context
 */
export function useGroupsContext() {
  const context = useContext(GroupsContext)
  if (!context) {
    throw new Error('useGroupsContext must be used within a GroupsProvider')
  }
  return context
}
