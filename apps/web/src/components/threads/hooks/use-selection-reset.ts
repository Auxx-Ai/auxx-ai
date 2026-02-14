// apps/web/src/components/threads/hooks/use-selection-reset.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions'
import { useEffect, useRef } from 'react'
import { useThreadSelectionStore } from '../store/thread-selection-store'

/**
 * Resets thread selection when the list filter changes.
 * Accepts the filter (ConditionGroup[]) and creates a stable key from it.
 */
export function useSelectionReset(filter: ConditionGroup[]) {
  const reset = useThreadSelectionStore((s) => s.reset)
  const prevFilterRef = useRef<string>('')

  useEffect(() => {
    // Create a stable key from the filter
    const filterKey = JSON.stringify(filter)

    // Only reset if filter actually changed (not on initial mount)
    if (prevFilterRef.current && prevFilterRef.current !== filterKey) {
      reset()
    }

    prevFilterRef.current = filterKey
  }, [filter, reset])
}
