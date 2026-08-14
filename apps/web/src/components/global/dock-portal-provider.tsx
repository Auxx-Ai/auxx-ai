// apps/web/src/components/global/dock-portal-provider.tsx
'use client'

import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'

/**
 * Context value for dock portal - provides a ref to the docked panel container.
 */
interface DockPortalContextValue {
  /** Ref to the docked panel container. */
  panelRef: RefObject<HTMLDivElement | null>
  /** Callback ref for the panel target. */
  setPanelRef: (el: HTMLDivElement | null) => void
}

const DockPortalContext = createContext<DockPortalContextValue | null>(null)

/**
 * Provider that creates the portal target for the docked panel.
 *
 * There is exactly **one** target. An earlier version had a primary/secondary
 * pair for side-by-side panels, which meant a panel could portal into a target
 * the page had stopped rendering — the callback ref below ignores `null`, so the
 * ref kept pointing at a detached node and the panel silently vanished. One
 * permanent target makes that unrepresentable.
 */
export function DockPortalProvider({ children }: { children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Force re-render when the ref becomes available so portals can attach.
  const [, forceUpdate] = useState(0)

  // Ignores null so an AnimatePresence exit unmount can't wipe a ref that a
  // newly mounted target has already claimed.
  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      panelRef.current = el
      forceUpdate((n) => n + 1)
    }
  }, [])

  return (
    <DockPortalContext.Provider value={{ panelRef, setPanelRef }}>
      {children}
    </DockPortalContext.Provider>
  )
}

/**
 * Hook to access the dock portal context.
 * Returns the ref to the docked panel container for use with createPortal.
 */
export function useDockPortal() {
  const context = useContext(DockPortalContext)
  if (!context) {
    throw new Error('useDockPortal must be used within DockPortalProvider')
  }
  return context
}

/**
 * Portal target for the docked panel.
 * Place inside a PanelFrame where docked content should appear.
 */
export function DockedPanelTarget() {
  const { setPanelRef } = useDockPortal()

  return <div ref={setPanelRef} className='contents h-full' />
}
