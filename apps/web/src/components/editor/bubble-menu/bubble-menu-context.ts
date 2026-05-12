// apps/web/src/components/editor/bubble-menu/bubble-menu-context.ts
'use client'

import { createContext, useContext } from 'react'

/** Registered by the bubble menu shell. Sections call this when their own
 *  dropdown/popover opens/closes so the parent bubble stays mounted across
 *  the focus transition. */
export const BubbleSubPopoverContext = createContext<(open: boolean) => void>(() => {})

export function useBubbleSubPopover(): (open: boolean) => void {
  return useContext(BubbleSubPopoverContext)
}
