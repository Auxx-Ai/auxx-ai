// apps/web/src/components/global/sidebar/tree/sidebar-nodes-provider.tsx
'use client'

import {
  parseSidebarLayoutSnapshot,
  SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY,
  toResourceNav,
} from '@auxx/lib/sidebar-layout/client'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useResourceStore } from '~/components/resources/store/resource-store'
import {
  useDehydratedSettingsOptional,
  useDehydratedState,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import {
  createSidebarNodesStore,
  type SidebarNodesState,
  type SidebarNodesStoreApi,
} from './sidebar-nodes-store'

const SidebarNodesContext = createContext<SidebarNodesStoreApi | null>(null)

/** Unseeded fallback for trees rendered outside the provider (tests, isolated previews). */
let fallbackStore: SidebarNodesStoreApi | undefined

/** Provides an existing store without the dehydrated seed or background refresh (tests). */
export function SidebarNodesStoreProvider({
  store,
  children,
}: {
  store: SidebarNodesStoreApi
  children: ReactNode
}) {
  return <SidebarNodesContext.Provider value={store}>{children}</SidebarNodesContext.Provider>
}

/** The sidebar node store API, for reads inside callbacks. */
export function useSidebarNodesApi(): SidebarNodesStoreApi {
  return useContext(SidebarNodesContext) ?? (fallbackStore ??= createSidebarNodesStore())
}

export function useSidebarNodes<T>(selector: (state: SidebarNodesState) => T): T {
  return useStore(useSidebarNodesApi(), selector)
}

/**
 * Holds the member's sidebar rows (favorites + layout). Seeded from the dehydrated state at
 * creation; `sidebar.list` refreshes it in the background and the resource store keeps defs live.
 */
export function SidebarNodesProvider({ children }: { children: ReactNode }) {
  const dehydrated = useDehydratedState().sidebar
  const defaultLayout = useDehydratedSettingsOptional()?.[SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY]
  const [store] = useState(() => createSidebarNodesStore(dehydrated, defaultLayout))

  const { data } = api.sidebar.list.useQuery(undefined, {
    initialData: dehydrated,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const applied = useRef(dehydrated)
  const resourcesLoaded = useResourceStore((s) => s.hasLoadedOnce)
  const resources = useResourceStore((s) => s.resources)

  useEffect(() => {
    if (!data || data === applied.current) return
    applied.current = data
    store.getState().setNodes(data.nodes)
    if (!useResourceStore.getState().hasLoadedOnce) {
      store.getState().setResourceNav(data.resourceNav ?? null)
    }
  }, [data, store])

  // Once the resource store is loaded it is the live source (realtime def edits, creates, archives).
  useEffect(() => {
    if (resourcesLoaded) store.getState().setResourceNav(toResourceNav(resources))
  }, [resourcesLoaded, resources, store])

  const lastLayoutSetting = useRef(defaultLayout)
  useEffect(() => {
    if (lastLayoutSetting.current === defaultLayout) return
    lastLayoutSetting.current = defaultLayout
    store.getState().setSnapshot(parseSidebarLayoutSnapshot(defaultLayout))
  }, [defaultLayout, store])

  return <SidebarNodesContext.Provider value={store}>{children}</SidebarNodesContext.Provider>
}
