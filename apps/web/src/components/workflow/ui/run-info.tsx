import { Badge } from '@auxx/ui/components/badge'
import { X } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { memo, useCallback } from 'react'
import { formatRelativeDate } from '~/utils/date'
import { useRunStore } from '../store/run-store'

// apps/web/src/components/workflow/ui/run-info.tsx

/**
 * RunInfo component displays workflow run information
 */
export const RunInfo = memo(function RunInfo() {
  const activeRun = useRunStore((state) => state.activeRun)
  const [, setRunId] = useQueryState('runId', { history: 'replace' })

  const handleClearActiveRun = useCallback(() => {
    useRunStore.getState().clearRun()
    setRunId(null)
  }, [setRunId])

  if (!activeRun) {
    return null
  }

  return (
    <div className='run-info'>
      <Badge variant='orange'>
        <span>
          Test Run #{activeRun.sequenceNumber} ({formatRelativeDate(activeRun.createdAt)})
        </span>
        <button className='ml-1 cursor-pointer' type='button' onClick={handleClearActiveRun}>
          <X className='size-4 text-muted-foreground' />
        </button>
      </Badge>
    </div>
  )
})
