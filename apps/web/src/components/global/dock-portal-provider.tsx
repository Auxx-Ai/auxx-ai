// apps/web/src/components/global/dock-portal-provider.tsx
'use client'

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type RefObject,
  type ReactNode,
} from 'react'

/** Identifies which panel slot to use */
type PanelSlot = 'primary' | 'secondary'

/**
 * Context value for dock portal - provides refs to docked panel containers
 */
interface DockPortalContextValue {
  /** Ref to the primary docked panel container */
  primaryPanelRef: RefObject<HTMLDivElement | null>
  /** Ref to the secondary docked panel container */
  secondaryPanelRef: RefObject<HTMLDivElement | null>
  /** Get the appropriate ref for a panel slot */
  getPanelRef: (slot: PanelSlot) => RefObject<HTMLDivElement | null>
  /** Callback ref for primary panel */
  setPrimaryRef: (el: HTMLDivElement | null) => void
  /** Callback ref for secondary panel */
  setSecondaryRef: (el: HTMLDivElement | null) => void

  /** @deprecated Use primaryPanelRef instead */
  dockedPanelRef: RefObject<HTMLDivElement | null>
}

const DockPortalContext = createContext<DockPortalContextValue | null>(null)

/**
 * Provider that creates portal targets for docked panels.
 * Supports both single panel and side-by-side panel layouts.
 * Uses callback refs to trigger re-render when portal targets become available.
 */
export function DockPortalProvider({ children }: { children: ReactNode }) {
  const primaryPanelRef = useRef<HTMLDivElement>(null)
  const secondaryPanelRef = useRef<HTMLDivElement>(null)

  // Force re-render when refs become available so portals can attach
  const [, forceUpdate] = useState(0)

  // Callback ref for primary panel - triggers re-render when mounted
  const setPrimaryRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !primaryPanelRef.current) {
      primaryPanelRef.current = el
      forceUpdate((n) => n + 1)
    } else {
      primaryPanelRef.current = el
    }
  }, [])

  // Callback ref for secondary panel - triggers re-render when mounted
  const setSecondaryRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !secondaryPanelRef.current) {
      secondaryPanelRef.current = el
      forceUpdate((n) => n + 1)
    } else {
      secondaryPanelRef.current = el
    }
  }, [])

  const getPanelRef = (slot: PanelSlot) => {
    return slot === 'primary' ? primaryPanelRef : secondaryPanelRef
  }

  return (
    <DockPortalContext.Provider
      value={{
        primaryPanelRef,
        secondaryPanelRef,
        getPanelRef,
        setPrimaryRef,
        setSecondaryRef,
        // Legacy alias
        dockedPanelRef: primaryPanelRef,
      }}>
      {children}
    </DockPortalContext.Provider>
  )
}

/**
 * Hook to access the dock portal context.
 * Returns refs to the docked panel containers for use with createPortal.
 */
export function useDockPortal() {
  const context = useContext(DockPortalContext)
  if (!context) {
    throw new Error('useDockPortal must be used within DockPortalProvider')
  }
  return context
}

/**
 * Props for DockedPanelTarget
 */
interface DockedPanelTargetProps {
  /** Which slot this target is for */
  slot?: PanelSlot
  /** Panel type filter for tabbed mode */
  panelFilter?: 'property' | 'run' | 'settings'
}

/**
 * Portal target for docked panels.
 * Place inside a PanelFrame where you want docked content to appear.
 * Uses callback refs to trigger re-render when mounted.
 */
export function DockedPanelTarget({ slot = 'primary', panelFilter }: DockedPanelTargetProps) {
  const { setPrimaryRef, setSecondaryRef } = useDockPortal()
  const setRef = slot === 'primary' ? setPrimaryRef : setSecondaryRef

  return (
    <div
      ref={setRef}
      data-panel-filter={panelFilter}
      data-panel-slot={slot}
      className="contents h-full"
    />
  )
}

export type { PanelSlot }
