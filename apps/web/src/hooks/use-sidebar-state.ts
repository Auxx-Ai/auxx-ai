// apps/web/src/hooks/use-sidebar-state.ts
'use client'

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  createSidebarStateStore,
  type SidebarPersistedState,
  type SidebarStateStore,
  type SidebarStateStoreApi,
} from './sidebar-state-store'

const LEGACY_STORAGE_KEY = 'auxx:sidebar-state'

const SidebarStateContext = createContext<SidebarStateStoreApi | null>(null)

/** Unseeded fallback for trees rendered outside the provider; only written from client events. */
let fallbackStore: SidebarStateStoreApi | undefined

function useSidebarStore<T>(selector: (state: SidebarStateStore) => T): T {
  const store = useContext(SidebarStateContext) ?? (fallbackStore ??= createSidebarStateStore())
  return useStore(store, selector)
}

/** Provides the shared sidebar collapse store, seeded from the `sidebar_collapse` cookie. */
export function SidebarStateProvider({
  initialState,
  children,
}: {
  /** Parsed cookie from the server layout; `undefined` means no cookie was set. */
  initialState?: SidebarPersistedState
  children: ReactNode
}) {
  const [store] = useState(() => createSidebarStateStore(initialState))

  // One-time move of pre-cookie localStorage state into the cookie.
  useEffect(() => {
    if (initialState) return
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!stored) return
      const legacy = JSON.parse(stored) as Partial<SidebarPersistedState>
      store.getState().hydrate({
        groups: legacy.groups ?? {},
        sections: legacy.sections ?? {},
        showHidden: false,
      })
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // Unreadable legacy state: keep defaults.
    }
  }, [initialState, store])

  return createElement(SidebarStateContext.Provider, { value: store }, children)
}

/** Open state of a sidebar group header; groups default open. */
export function useSidebarGroupOpen(id: string, defaultOpen = true): boolean {
  return useSidebarStore((s) => s.groups[id] ?? defaultOpen)
}

/** Open state of a collapsible section or folder, falling back to the caller's default. */
export function useSidebarSectionOpen(id: string | undefined, defaultOpen: boolean): boolean {
  return useSidebarStore((s) => (id ? (s.sections[id] ?? defaultOpen) : defaultOpen))
}

/** Sidebar-wide "show hidden rows" flag. */
export function useSidebarShowHidden(): boolean {
  return useSidebarStore((s) => s.showHidden)
}

/** Stable store actions. Pass the same default to toggles that the reader used. */
export function useSidebarStateActions() {
  return useSidebarStore(
    useShallow((s) => ({
      toggleGroup: s.toggleGroup,
      toggleSection: s.toggleSection,
      setSectionOpen: s.setSectionOpen,
      setShowHidden: s.setShowHidden,
    }))
  )
}
