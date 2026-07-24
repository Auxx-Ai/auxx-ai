// apps/web/src/components/fields/hooks/use-field-popover-coordination.ts
'use client'

import { useCallback, useRef } from 'react'

/**
 * Enforces one-open-editor-at-a-time across a list of field rows.
 *
 * Each row's `PropertyProvider` registers its close function on mount and reports
 * open/close transitions through `onOpenChange`; opening a row closes whichever
 * row was open before it. Shared by `EntityFields` and `CompactFieldList`.
 */
export function useFieldPopoverCoordination() {
  const closeHandlersRef = useRef<Record<string, () => void>>({})
  const openProviderIdRef = useRef<string | null>(null)

  const registerClose = useCallback((providerId: string, closeFn: () => void) => {
    closeHandlersRef.current[providerId] = closeFn
  }, [])

  const unregisterClose = useCallback((providerId: string) => {
    delete closeHandlersRef.current[providerId]
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  const onOpenChange = useCallback((providerId: string, nextOpen: boolean) => {
    if (nextOpen) {
      if (openProviderIdRef.current === providerId) return
      const activeId = openProviderIdRef.current
      if (activeId && activeId !== providerId) {
        closeHandlersRef.current[activeId]?.()
      }
      openProviderIdRef.current = providerId
      return
    }
    if (openProviderIdRef.current === providerId) {
      openProviderIdRef.current = null
    }
  }, [])

  return { onOpenChange, registerClose, unregisterClose }
}
