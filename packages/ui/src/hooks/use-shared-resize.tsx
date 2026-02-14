// packages/ui/src/hooks/use-shared-resize.tsx
'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

/** Context value for shared resize state */
interface ResizeContextValue {
  /** Current stable width (only updates when resize ends) */
  width: number
  /** Get the real-time width (may be different during resize) */
  getCurrentWidth: () => number
}

const ResizeContext = createContext<ResizeContextValue>({
  width: 0,
  getCurrentWidth: () => 0,
})

/** Props for SharedResizeProvider */
interface SharedResizeProviderProps {
  children: ReactNode
  /** Class name for the wrapper div */
  className?: string
}

/**
 * Provider that measures container width with a single ResizeObserver.
 * Only updates React state when resize ends (after 150ms of no changes).
 * During resize, components can call getCurrentWidth() to get real-time value.
 */
export function SharedResizeProvider({ children, className }: SharedResizeProviderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [stableWidth, setStableWidth] = useState(0)
  const currentWidthRef = useRef(0)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const getCurrentWidth = useCallback(() => currentWidthRef.current, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const newWidth = Math.floor(entries[0]?.contentRect.width ?? 0)

      // Always update the ref (no re-render)
      if (newWidth === currentWidthRef.current) return
      currentWidthRef.current = newWidth

      console.log('[SharedResizeProvider] resize, width:', newWidth)

      // Debounce the state update - only update when resize stops
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        console.log(
          '[SharedResizeProvider] resize ended, committing width:',
          currentWidthRef.current
        )
        setStableWidth(currentWidthRef.current)
      }, 150)
    })

    observer.observe(el)

    // Initial measurement
    const initialWidth = Math.floor(el.getBoundingClientRect().width)
    currentWidthRef.current = initialWidth
    setStableWidth(initialWidth)

    return () => {
      observer.disconnect()
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      <ResizeContext.Provider value={{ width: stableWidth, getCurrentWidth }}>
        {children}
      </ResizeContext.Provider>
    </div>
  )
}

/**
 * Hook to read shared container width from nearest SharedResizeProvider.
 * Returns stable width that only updates when resize ends.
 */
export function useSharedResize(): { width: number; isResizing: boolean } {
  const { width } = useContext(ResizeContext)
  // isResizing is no longer tracked - we just debounce the state update
  return { width, isResizing: false }
}
