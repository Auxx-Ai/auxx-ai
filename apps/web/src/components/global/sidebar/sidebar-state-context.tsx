// components/global/sidebar/sidebar-state-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useSidebarState } from '~/hooks/use-sidebar-state'

type SidebarStateContextValue = ReturnType<typeof useSidebarState>

const SidebarStateContext = createContext<SidebarStateContextValue | null>(null)

/** Provider component that wraps the sidebar to enable localStorage persistence */
export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const sidebarState = useSidebarState()
  return (
    <SidebarStateContext.Provider value={sidebarState}>{children}</SidebarStateContext.Provider>
  )
}

/** Hook to access sidebar state context for localStorage persistence */
export function useSidebarStateContext() {
  const context = useContext(SidebarStateContext)
  if (!context) {
    throw new Error('useSidebarStateContext must be used within SidebarStateProvider')
  }
  return context
}
