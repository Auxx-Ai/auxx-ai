// apps/web/src/components/threads/hooks/use-selection-reset.ts
'use client'

import { useEffect, useRef } from 'react'
import { useThreadSelectionStore } from '../store/thread-selection-store'

interface FilterContext {
  contextType?: string
  contextId?: string
  statusSlug?: string
}

/**
 * Resets thread selection when the list context changes.
 * Should be used at the list level where filter is defined.
 */
export function useSelectionReset(filter: FilterContext) {
  const reset = useThreadSelectionStore((s) => s.reset)
  const prevFilterRef = useRef<string>('')

  useEffect(() => {
    const filterKey = `${filter.contextType}-${filter.contextId}-${filter.statusSlug}`

    // Only reset if filter actually changed (not on initial mount)
    if (prevFilterRef.current && prevFilterRef.current !== filterKey) {
      reset()
    }

    prevFilterRef.current = filterKey
  }, [filter.contextType, filter.contextId, filter.statusSlug, reset])
}
