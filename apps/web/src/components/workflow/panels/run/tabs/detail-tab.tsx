// apps/web/src/components/workflow/panels/run/tabs/detail-tab.tsx

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Timestamp } from '@auxx/ui/components/timestamp'
import { useRunStore } from '~/components/workflow/store/run-store'

/**
 * Detail tab showing workflow run metadata and statistics
 */
export function DetailTab() {
  const activeRun = useRunStore((state) => state.activeRun)

  if (!activeRun) {
    return (
      <Alert>
        <AlertDescription>
          No workflow run selected. Run a workflow to see details.
        </AlertDescription>
      </Alert>
    )
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return 'N/A'
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
    if (seconds < 60) return `${seconds.toFixed(2)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`
  }

  return (
    <div className='space-y-4'>
      {/* Run Information */}
      <div className='space-y-3'>
        <h4 className='text-sm font-medium'>Run Information</h4>

        <div className='space-y-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Run ID</span>
            <span className='font-mono text-xs'>{activeRun.id}</span>
          </div>

          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Sequence Number</span>
            <span>#{activeRun.sequenceNumber}</span>
          </div>

          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Version</span>
            <span>{activeRun.version}</span>
          </div>

          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Trigger Source</span>
            <span className='capitalize'>
              {activeRun.triggeredFrom.toLowerCase().replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Timing */}
      <div className='space-y-3'>
        <h4 className='text-sm font-medium'>Timing</h4>

        <div className='space-y-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Started</span>
            <Timestamp date={activeRun.createdAt} />
          </div>

          {activeRun.finishedAt && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>Finished</span>
              <Timestamp date={activeRun.finishedAt} />
            </div>
          )}

          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Duration</span>
            <span>{formatDuration(activeRun.elapsedTime)}</span>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className='space-y-3'>
        <h4 className='text-sm font-medium'>Statistics</h4>

        <div className='space-y-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Total Steps</span>
            <span>{activeRun.totalSteps}</span>
          </div>

          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Total Tokens</span>
            <span>{activeRun.totalTokens || 0}</span>
          </div>
        </div>
      </div>

      {/* Error Details */}
      {activeRun.error && (
        <div className='space-y-3'>
          <h4 className='text-sm font-medium text-destructive'>Error Details</h4>
          <Alert variant='destructive'>
            <AlertDescription className='whitespace-pre-wrap'>{activeRun.error}</AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  )
}
