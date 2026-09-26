// apps/web/src/components/global/sidebar/tree/sidebar-tree-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { useConfirm } from '~/hooks/use-confirm'
import type { SidebarRenderTree } from './sidebar-access'
import type { SidebarMutations } from './use-sidebar-mutations'

interface SidebarTreeContextValue {
  tree: SidebarRenderTree
  mutations: SidebarMutations
  /** Own dropdown items for NAV rows, keyed by nav id. */
  navActions: Record<string, () => ReactNode>
  /** Shared confirm; its dialog renders at the tree root so it outlives closed dropdowns. */
  confirm: ReturnType<typeof useConfirm>[0]
}

export const SidebarTreeContext = createContext<SidebarTreeContextValue | null>(null)

export function useSidebarTree(): SidebarTreeContextValue {
  const ctx = useContext(SidebarTreeContext)
  if (!ctx) throw new Error('useSidebarTree must be used within SidebarTree')
  return ctx
}
