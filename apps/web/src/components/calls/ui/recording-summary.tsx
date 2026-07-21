// apps/web/src/components/calls/ui/recording-summary.tsx
'use client'

import {
  type BotStatus,
  deriveRecordingOutcome,
  TERMINAL_STATUSES,
} from '@auxx/lib/recording/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { AlertCircle, BookOpen, RefreshCw } from 'lucide-react'
import { api } from '~/trpc/react'
import { RecordingActionItems } from './recording-action-items'
import { RecordingChapters } from './recording-chapters'
import { RecordingInsights } from './recording-insights'

export function RecordingSummary({ recordingId }: { recordingId: string }) {
  const { data: recording } = api.recording.getById.useQuery(
    { id: recordingId },
    {
      refetchInterval: (query) => {
        const data = query.state.data as
          | { aiProcessingStatus?: string; hasTranscript?: boolean; status?: string }
          | undefined
        if (!data) return false
        const aiStatus = data.aiProcessingStatus
        const botTerminal = TERMINAL_STATUSES.includes(data.status as BotStatus)
        // Poll while AI work is running or can still start; a terminal bot
        // without a transcript will never produce a summary — stop polling.
        if (aiStatus === 'processing') return 3000
        if (aiStatus === 'pending' && (data.hasTranscript || !botTerminal)) return 3000
        return false
      },
    }
  )

  const utils = api.useUtils()
  const regenerate = api.recording.regenerate.useMutation({
    onSuccess: () => {
      utils.recording.getById.invalidate({ id: recordingId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to regenerate summary', description: error.message })
    },
  })

  const aiStatus = recording?.aiProcessingStatus ?? 'pending'
  const summaryText = recording?.summaryText ?? ''
  const hasTranscript = recording?.hasTranscript ?? false
  const botTerminal = recording ? TERMINAL_STATUSES.includes(recording.status as BotStatus) : false

  // Nothing was ever captured — the parent renders the no-recording state.
  if (recording && deriveRecordingOutcome(recording) === 'no_recording') {
    return null
  }

  // Only claim work is happening when it actually is: post-processing running,
  // or a transcript exists and processing is about to start.
  const isGenerating = aiStatus === 'processing' || (aiStatus === 'pending' && hasTranscript)
  const isUpcomingOrLive = aiStatus === 'pending' && !hasTranscript && !botTerminal

  return (
    <div className='flex flex-col'>
      <Section title='Summary' icon={<BookOpen className='size-3.5' />} collapsible={false}>
        {isGenerating ? (
          <div className='py-4 space-y-3'>
            <Skeleton className='h-4 w-3/4' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
            <p className='text-xs text-muted-foreground pt-2'>Generating summary...</p>
          </div>
        ) : isUpcomingOrLive ? (
          <p className='py-4 text-sm text-muted-foreground'>Summary will appear after the call.</p>
        ) : aiStatus === 'failed' ? (
          <Alert variant='destructive' className='flex justify-between py-1'>
            <div className='flex min-h-7 items-center'>
              <AlertCircle className='size-4 mr-2 shrink-0' />
              <AlertDescription>
                {recording?.aiProcessingError?.split('\n')[0] ??
                  'Summary generation failed. Please try again.'}
              </AlertDescription>
            </div>
            {hasTranscript && (
              <Button
                variant='outline'
                size='xs'
                loading={regenerate.isPending}
                onClick={() => regenerate.mutate({ recordingId, scope: 'summary' })}
                className=' pl-2!'>
                <RefreshCw /> Retry
              </Button>
            )}
          </Alert>
        ) : summaryText ? (
          <p className='text-sm leading-relaxed text-muted-foreground'>{summaryText}</p>
        ) : hasTranscript ? (
          <div className='flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground'>
            <span>No summary available yet.</span>
            <Button
              variant='outline'
              size='sm'
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate({ recordingId, scope: 'summary' })}>
              <RefreshCw /> Generate summary
            </Button>
          </div>
        ) : (
          <p className='py-4 text-sm text-muted-foreground'>
            No transcript available for this recording.
          </p>
        )}
      </Section>
      {hasTranscript && (
        <>
          <RecordingChapters recordingId={recordingId} />
          <RecordingActionItems recordingId={recordingId} />
          <RecordingInsights recordingId={recordingId} />
        </>
      )}
    </div>
  )
}
