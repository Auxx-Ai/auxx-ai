// apps/web/src/components/global/sidebar/sidebar-row-menu-context.ts
'use client'

import { createContext, type ReactNode, useContext } from 'react'

/** Menu items the sidebar tree appends to a row's own dropdown (Move to…, Hide, Remove). */
export const SidebarRowMenuContext = createContext<ReactNode>(null)

export function useSidebarRowMenuItems(): ReactNode {
  return useContext(SidebarRowMenuContext)
}
