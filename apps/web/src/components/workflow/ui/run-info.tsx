import React, { memo, useCallback } from 'react'
import { Badge } from '@auxx/ui/components/badge'
import { useRunStore } from '../store/run-store'
import { formatRelativeDate } from '~/utils/date'
import { X } from 'lucide-react'

// apps/web/src/components/workflow/ui/run-info.tsx

/**
 * RunInfo component displays workflow run information
 */
export const RunInfo = memo(function RunInfo() {
  const activeRun = useRunStore((state) => state.activeRun)

  const handleClearActiveRun = useCallback(() => {
    useRunStore.getState().clearRun()
  }, [useRunStore])

  if (!activeRun) {
    return null
  }

  return (
    <div className="run-info">
      <Badge variant="orange">
        <span>
          Test Run #{activeRun.sequenceNumber} ({formatRelativeDate(activeRun.createdAt)})
        </span>
        <button className="ml-1 cursor-pointer" type="button" onClick={handleClearActiveRun}>
          <X className="size-4 text-muted-foreground" />
        </button>
      </Badge>
    </div>
  )
})
