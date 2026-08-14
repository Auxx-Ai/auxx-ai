// packages/ui/src/components/dockable-drawer.tsx
'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Drawer, DrawerContent, DrawerHandle, DrawerOverlay, DrawerTitle } from './drawer'

/**
 * Context value for dockable drawer
 */
interface DockableDrawerContextValue {
  /** Whether drawer is in docked mode */
  isDocked: boolean
  /** Current drawer width */
  width: number
  /** Update drawer width */
  setWidth: (width: number) => void
  /** Minimum allowed width */
  minWidth: number
  /** Maximum allowed width */
  maxWidth: number
}

const DockableDrawerContext = React.createContext<DockableDrawerContextValue | null>(null)

/**
 * Hook to access dockable drawer context
 */
export const useDockableDrawer = () => {
  const context = React.useContext(DockableDrawerContext)
  if (!context) {
    throw new Error('useDockableDrawer must be used within DockableDrawerProvider')
  }
  return context
}

/**
 * Props for DockableDrawer component
 */
interface DockableDrawerProps {
  /** Whether the drawer is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Whether the drawer is docked */
  isDocked: boolean
  /** Current width */
  width: number
  /** Callback when width changes */
  onWidthChange: (width: number) => void
  /** Min width */
  minWidth?: number
  /** Max width */
  maxWidth?: number
  /** Drawer content */
  children: React.ReactNode
  /** Accessible title for the drawer (required for screen readers) */
  title?: string
  /**
   * Render the (transparent) overlay in undocked mode. The overlay swallows every pointer
   * event outside the drawer — pass `false` when the page behind must stay interactive
   * (e.g. the dispatch route planner's map).
   */
  overlay?: boolean
  /** Optional portal target ref for docked mode - content will be portaled here when docked */
  portalTarget?: React.RefObject<HTMLElement | null>
}

/**
 * DockableDrawer - A drawer that can render as overlay or docked panel.
 *
 * When docked with portalTarget, portals content to the target element (preserves React context).
 * When docked without portalTarget, renders children directly (to be placed in MainPageContent.dockedPanel).
 * When not docked, renders as traditional Vaul drawer overlay.
 */
export function DockableDrawer({
  open,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
  minWidth = 350,
  maxWidth = 800,
  children,
  title = 'Details',
  overlay = true,
  portalTarget,
}: DockableDrawerProps) {
  const contextValue = React.useMemo(
    () => ({ isDocked, width, setWidth: onWidthChange, minWidth, maxWidth }),
    [isDocked, width, onWidthChange, minWidth, maxWidth]
  )

  // When docked with portal target, portal content to the target element
  if (isDocked && open && portalTarget?.current) {
    // When docked, no handle needed - resize is handled by PanelFrame gap
    return createPortal(
      <DockableDrawerContext.Provider value={contextValue}>
        <div className='flex flex-col h-full relative rounded'>{children}</div>
      </DockableDrawerContext.Provider>,
      portalTarget.current
    )
  }

  // When docked without portal target, just return the content with context
  if (isDocked && open) {
    // When docked, no handle needed - resize is handled by PanelFrame gap
    return (
      <DockableDrawerContext.Provider value={contextValue}>
        <div className='flex flex-col h-full relative rounded'>{children}</div>
      </DockableDrawerContext.Provider>
    )
  }

  // When not docked, use the overlay drawer
  if (!isDocked) {
    return (
      <Drawer
        direction='right'
        open={open}
        onOpenChange={onOpenChange}
        modal={false}
        defaultWidth={width}
        handleOnly
        minWidth={minWidth}
        maxWidth={maxWidth}
        onWidthChange={onWidthChange}>
        {overlay && <DrawerOverlay className='bg-transparent' />}
        <DrawerContent>
          <DrawerHandle />
          <DrawerTitle className='sr-only'>{title}</DrawerTitle>
          <DockableDrawerContext.Provider value={contextValue}>
            {children}
          </DockableDrawerContext.Provider>
        </DrawerContent>
      </Drawer>
    )
  }

  return null
}
