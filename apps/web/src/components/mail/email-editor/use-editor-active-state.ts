// apps/web/src/hooks/use-editor-active-state.ts
import { useCallback, useMemo, useState } from 'react'

export interface UseEditorActiveStateReturn {
  isActive: boolean
  hasFocus: boolean
  setHasFocus: (focus: boolean) => void
  trackPopoverOpen: (id: string) => void
  trackPopoverClose: (id: string) => void
  trackSelectOpen: (id: string) => void
  trackSelectClose: (id: string) => void
  resetAll: () => void
}

/**
 * Hook to manage editor active state across focus and UI element interactions
 * Tracks both direct focus and open state of related UI elements (selects, popovers)
 */
export function useEditorActiveState(): UseEditorActiveStateReturn {
  const [hasFocus, setHasFocus] = useState(false)
  const [openPopovers, setOpenPopovers] = useState<Set<string>>(new Set())
  const [openSelects, setOpenSelects] = useState<Set<string>>(new Set())

  // Editor is active if it has focus OR any related UI elements are open
  const isActive = useMemo(
    () => hasFocus || openPopovers.size > 0 || openSelects.size > 0,
    [hasFocus, openPopovers.size, openSelects.size]
  )

  const trackPopoverOpen = useCallback((id: string) => {
    setOpenPopovers((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const trackPopoverClose = useCallback((id: string) => {
    setTimeout(() => {
      setOpenPopovers((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next.size === prev.size ? prev : next
      })
    }, 1000)
  }, [])

  const trackSelectOpen = useCallback((id: string) => {
    setOpenSelects((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const trackSelectClose = useCallback((id: string) => {
    setOpenSelects((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next.size === prev.size ? prev : next
    })
  }, [])

  const resetAll = useCallback(() => {
    setHasFocus(false)
    setOpenPopovers(new Set())
    setOpenSelects(new Set())
  }, [])

  return {
    isActive,
    hasFocus,
    setHasFocus,
    trackPopoverOpen,
    trackPopoverClose,
    trackSelectOpen,
    trackSelectClose,
    resetAll,
  }
}
