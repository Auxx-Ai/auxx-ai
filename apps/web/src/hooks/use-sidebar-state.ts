// hooks/use-sidebar-state.ts
'use client'

import { useCallback, useEffect, useState } from 'react'

const SIDEBAR_STATE_KEY = 'auxx:sidebar-state'

/** Represents the persisted state of sidebar groups and sections */
interface SidebarState {
  /** Sidebar group headers (e.g. unified Mail group, Records group) */
  groups: Record<string, boolean>
  /** Collapsible sections within NavMain (by item id) */
  sections: Record<string, boolean>
}

const DEFAULT_STATE: SidebarState = {
  groups: {
    mail: true,
  },
  sections: {},
}

/**
 * Hook to manage sidebar open/closed state in localStorage.
 * Provides instant UI updates with persistence across page refreshes.
 */
export function useSidebarState() {
  const [state, setState] = useState<SidebarState>(DEFAULT_STATE)
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STATE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as SidebarState
        setState({
          groups: { ...DEFAULT_STATE.groups, ...parsed.groups },
          sections: { ...DEFAULT_STATE.sections, ...parsed.sections },
        })
      }
    } catch {
      // Ignore parse errors, use defaults
    }
    setIsHydrated(true)
  }, [])

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state))
    }
  }, [state, isHydrated])

  /** Get open state for a sidebar group */
  const getGroupOpen = useCallback(
    (groupId: string): boolean => {
      return state.groups[groupId] ?? true
    },
    [state.groups]
  )

  /** Toggle a sidebar group's open state */
  const toggleGroup = useCallback((groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        [groupId]: !(prev.groups[groupId] ?? true),
      },
    }))
  }, [])

  /** Get open state for a collapsible section */
  const getSectionOpen = useCallback(
    (sectionId: string, defaultValue: boolean): boolean => {
      // If section has been explicitly set, use that value
      if (sectionId in state.sections) {
        return state.sections[sectionId]!
      }
      // Otherwise use the default (typically based on isActive)
      return defaultValue
    },
    [state.sections]
  )

  /** Set a section's open state */
  const setSectionOpen = useCallback((sectionId: string, isOpen: boolean) => {
    setState((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [sectionId]: isOpen,
      },
    }))
  }, [])

  /** Toggle a section's open state */
  const toggleSection = useCallback((sectionId: string) => {
    setState((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        [sectionId]: !(prev.sections[sectionId] ?? true),
      },
    }))
  }, [])

  return {
    isHydrated,
    getGroupOpen,
    toggleGroup,
    getSectionOpen,
    setSectionOpen,
    toggleSection,
  }
}
