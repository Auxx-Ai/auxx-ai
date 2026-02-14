// apps/web/src/components/data-import/progress/resolution-progress.tsx

'use client'

import { Progress } from '@auxx/ui/components/progress'
import { Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { api } from '~/trpc/react'

interface ResolutionProgressProps {
  jobId: string
  /** Whether to poll for progress updates */
  enabled?: boolean
  /** Display variant - 'loading' shows a simpler loading state */
  variant?: 'loading' | 'resolving'
  /** Called when resolution completes (all values processed) */
  onComplete?: () => void
}

/**
 * Progress indicator for value resolution.
 * Supports 'loading' variant for initial load state to avoid layout shifts.
 */
export function ResolutionProgress({
  jobId,
  enabled = true,
  variant = 'resolving',
  onComplete,
}: ResolutionProgressProps) {
  const shouldPoll = enabled && variant === 'resolving'
  const hasCalledComplete = useRef(false)

  const { data: progress } = api.dataImport.getResolutionProgress.useQuery(
    { jobId },
    {
      enabled: shouldPoll,
      refetchInterval: (query) => {
        if (!shouldPoll) return false
        // Stop polling when resolution is complete
        const data = query.state.data
        if (data && data.totalValues > 0 && data.valuesProcessed >= data.totalValues) {
          return false
        }
        return 1000
      },
    }
  )

  // Call onComplete when all values are processed
  useEffect(() => {
    if (
      progress &&
      progress.totalValues > 0 &&
      progress.valuesProcessed >= progress.totalValues &&
      !hasCalledComplete.current
    ) {
      hasCalledComplete.current = true
      onComplete?.()
    }
  }, [progress, onComplete])

  const percentage = progress?.totalValues
    ? Math.round((progress.valuesProcessed / progress.totalValues) * 100)
    : 0

  const isLoading = variant === 'loading'

  return (
    <div className='flex flex-col items-center justify-center flex-1'>
      <div className='space-y-4 py-3 px-6 min-w-[300px] rounded-2xl border bg-primary-100'>
        <div className='flex items-center justify-center gap-3'>
          {isLoading ? (
            <Loader2 className='h-8 w-8 text-primary-500 animate-spin' />
          ) : (
            <RefreshCw className='h-8 w-8 text-primary-500 animate-spin' />
          )}
          <div>
            <p className='font-medium'>{isLoading ? 'Loading values...' : 'Resolving values...'}</p>
            <p className='text-sm text-muted-foreground'>
              {isLoading
                ? 'Preparing column data'
                : `Column ${progress?.columnsProcessed ?? 0} of ${progress?.totalColumns ?? 0}`}
            </p>
          </div>
        </div>

        <Progress value={isLoading ? undefined : percentage} className='w-full max-w-md mx-auto' />

        <p className='text-center text-sm text-muted-foreground'>
          {isLoading
            ? 'Please wait...'
            : `${progress?.valuesProcessed?.toLocaleString() ?? 0} values processed`}
        </p>
      </div>
    </div>
  )
}
