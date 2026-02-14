// apps/web/src/components/fields/field-navigation-context.tsx
'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

/**
 * Context value for field navigation
 * Manages keyboard navigation between field rows and popover focus capture
 */
interface FieldNavigationContextValue {
  /** Currently focused row ID (null if none) */
  focusedRowId: string | null

  /** Set focus to a specific row */
  setFocusedRow: (rowId: string | null) => void

  /** Move focus to next/prev row */
  moveFocus: (direction: 'up' | 'down') => void

  /** Open the popover for the focused row */
  openFocusedRow: () => void

  /** Register a row in the navigation order */
  registerRow: (rowId: string, index: number) => void

  /** Unregister a row */
  unregisterRow: (rowId: string) => void

  /** Register the handler that can open any row's popover */
  registerOpenHandler: (handler: (rowId: string) => void) => void

  /** Whether a popover is currently capturing keyboard events (e.g., Tags picker) */
  isPopoverCapturing: boolean

  /** Set whether a popover is capturing (pickers call this) */
  setPopoverCapturing: (capturing: boolean) => void
}

const FieldNavigationContext = createContext<FieldNavigationContextValue | null>(null)

/**
 * Hook to access field navigation context
 * @throws Error if used outside FieldNavigationProvider
 */
export function useFieldNavigation(): FieldNavigationContextValue {
  const ctx = useContext(FieldNavigationContext)
  if (!ctx) throw new Error('useFieldNavigation must be used within FieldNavigationProvider')
  return ctx
}

/**
 * Hook to optionally access field navigation context
 * Returns null if not within a provider (useful for components that may or may not be in navigation context)
 */
export function useFieldNavigationOptional(): FieldNavigationContextValue | null {
  return useContext(FieldNavigationContext)
}

interface FieldNavigationProviderProps {
  children: ReactNode
}

/**
 * Provider for field navigation context
 * Manages row focus state, keyboard navigation between rows, and popover key capture
 */
export function FieldNavigationProvider({ children }: FieldNavigationProviderProps) {
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [isPopoverCapturing, setPopoverCapturing] = useState(false)

  // Map of row ID -> index for navigation order
  const rowOrderRef = useRef<Map<string, number>>(new Map())

  // Handler to open any row's popover
  const openHandlerRef = useRef<((rowId: string) => void) | null>(null)

  /**
   * Register a row in the navigation order
   */
  const registerRow = useCallback((rowId: string, index: number) => {
    rowOrderRef.current.set(rowId, index)
  }, [])

  /**
   * Unregister a row from navigation
   */
  const unregisterRow = useCallback((rowId: string) => {
    rowOrderRef.current.delete(rowId)
  }, [])

  /**
   * Register the handler that can open any row's popover
   */
  const registerOpenHandler = useCallback((handler: (rowId: string) => void) => {
    openHandlerRef.current = handler
  }, [])

  /**
   * Get sorted row IDs by their index
   */
  const getSortedRowIds = useCallback(() => {
    return [...rowOrderRef.current.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  }, [])

  /**
   * Move focus to next or previous row
   * Wraps around at boundaries
   */
  const moveFocus = useCallback(
    (direction: 'up' | 'down') => {
      const rowIds = getSortedRowIds()
      if (rowIds.length === 0) return

      const currentIndex = focusedRowId ? rowIds.indexOf(focusedRowId) : -1
      let newIndex: number

      if (direction === 'down') {
        // Move down, wrap to top if at bottom
        newIndex = currentIndex < rowIds.length - 1 ? currentIndex + 1 : 0
      } else {
        // Move up, wrap to bottom if at top
        newIndex = currentIndex > 0 ? currentIndex - 1 : rowIds.length - 1
      }

      setFocusedRowId(rowIds[newIndex] ?? null)
    },
    [focusedRowId, getSortedRowIds]
  )

  /**
   * Open the popover for the currently focused row
   */
  const openFocusedRow = useCallback(() => {
    if (focusedRowId && openHandlerRef.current) {
      openHandlerRef.current(focusedRowId)
    }
  }, [focusedRowId])

  const value = useMemo(
    () => ({
      focusedRowId,
      setFocusedRow: setFocusedRowId,
      moveFocus,
      openFocusedRow,
      registerRow,
      unregisterRow,
      registerOpenHandler,
      isPopoverCapturing,
      setPopoverCapturing,
    }),
    [
      focusedRowId,
      moveFocus,
      openFocusedRow,
      registerRow,
      unregisterRow,
      registerOpenHandler,
      isPopoverCapturing,
    ]
  )

  return <FieldNavigationContext.Provider value={value}>{children}</FieldNavigationContext.Provider>
}
