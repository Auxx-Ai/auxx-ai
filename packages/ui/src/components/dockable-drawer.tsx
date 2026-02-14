// packages/ui/src/components/dockable-drawer.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
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

/** Panel type for filtering in tabbed/side-by-side mode */
type PanelType = 'property' | 'run' | 'settings'

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
  /** Optional portal target ref for docked mode - content will be portaled here when docked */
  portalTarget?: React.RefObject<HTMLElement | null>
  /** Identifies which panel this is (for filtering in tabbed/side-by-side mode) */
  panelType?: PanelType
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
  portalTarget,
  panelType,
}: DockableDrawerProps) {
  const contextValue = React.useMemo(
    () => ({ isDocked, width, setWidth: onWidthChange, minWidth, maxWidth }),
    [isDocked, width, onWidthChange, minWidth, maxWidth]
  )

  // When docked with portal target, portal content to the target element
  if (isDocked && open && portalTarget?.current) {
    // Check if there's a panel filter on the target and if it matches our type
    const filter = portalTarget.current.dataset?.panelFilter
    // If there's a filter and it doesn't match our type, don't render
    if (filter && panelType && filter !== panelType) {
      return null
    }

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
        <DrawerOverlay className='bg-transparent' />
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

/**
 * Resize handle for docked mode
 */
function DockableDrawerHandle() {
  const { setWidth, width, minWidth, maxWidth } = useDockableDrawer()
  const [isDragging, setIsDragging] = React.useState(false)

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)

      const startX = e.clientX
      const startWidth = width

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = startX - moveEvent.clientX
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX))
        setWidth(newWidth)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [setWidth, minWidth, maxWidth, width]
  )

  return (
    <div
      className={cn(
        'absolute -left-[3px] top-1/2 -translate-y-1/2 h-12 w-1.5 bg-primary-300 cursor-ew-resize rounded-full hover:bg-primary-400/70 z-50',
        isDragging && 'bg-primary-500'
      )}
      onMouseDown={handleMouseDown}
    />
  )
}
