// apps/web/src/components/calls/ui/recording-summary.tsx
'use client'

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
        const status = (query.state.data as { aiProcessingStatus?: string } | undefined)
          ?.aiProcessingStatus
        return status === 'processing' || status === 'pending' ? 3000 : false
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

  const status = recording?.aiProcessingStatus ?? 'pending'
  const summaryText = recording?.summaryText ?? ''

  return (
    <div className='flex flex-col'>
      <Section title='Summary' icon={<BookOpen className='size-3.5' />} collapsible={false}>
        {status === 'pending' || status === 'processing' ? (
          <div className='py-4 space-y-3'>
            <Skeleton className='h-4 w-3/4' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
            <p className='text-xs text-muted-foreground pt-2'>Generating summary...</p>
          </div>
        ) : status === 'failed' ? (
          <Alert variant='destructive' className=' flex justify-between py-1'>
            <div className='flex h-7 items-center'>
              <AlertCircle className='size-4 mr-2' />

              <span className=''>Summary generation failed. Please try again.</span>
            </div>
            <Button
              variant='outline'
              size='xs'
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate({ recordingId, scope: 'summary' })}
              className=' pl-2!'>
              <RefreshCw /> Retry
            </Button>
          </Alert>
        ) : summaryText ? (
          <p className='text-sm leading-relaxed text-muted-foreground'>{summaryText}</p>
        ) : (
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
        )}
      </Section>
      <RecordingChapters recordingId={recordingId} />
      <RecordingActionItems recordingId={recordingId} />
      <RecordingInsights recordingId={recordingId} />
    </div>
  )
}
