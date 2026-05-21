// apps/chat-widget/src/ui/portal-container.tsx
//
// Provides the element Radix portal primitives (Popover, Dialog, DropdownMenu,
// Tooltip) should render into. Inside a closed Shadow DOM the default
// `document.body` target lives outside the shadow tree, which breaks both
// styling (Tailwind utilities aren't available) and focus/pointer behavior.

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

const PortalContainerCtx = createContext<HTMLElement | null>(null)

export const PortalContainerProvider = PortalContainerCtx.Provider

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerCtx)
}
