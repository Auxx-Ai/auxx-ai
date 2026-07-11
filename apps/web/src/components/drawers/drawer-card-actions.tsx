// apps/web/src/components/drawers/drawer-card-actions.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'

/**
 * Portal target for a drawer tab card's wrapping Section header actions (top-right
 * slot). `TabCards` in base-entity-drawer.tsx provides the slot element here so a
 * lazily-loaded card can teleport buttons into a Section it doesn't itself render.
 */
const DrawerCardActionsContext = createContext<HTMLElement | null>(null)

export const DrawerCardActionsProvider = DrawerCardActionsContext.Provider

/**
 * Renders its children into the wrapping Section's header actions slot. Returns
 * `null` when there is no slot (card rendered outside a `TabCards` Section), so
 * cards can use it unconditionally.
 */
export function DrawerCardActions({ children }: { children: ReactNode }) {
  const slot = useContext(DrawerCardActionsContext)
  if (!slot) return null
  return createPortal(children, slot)
}
