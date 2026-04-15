// apps/web/src/components/calls/ui/recording-detail.tsx
'use client'

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import Loader from '@auxx/ui/components/loader'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { Clock, Trash2, UserCircle, Video, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  created: 'outline',
  joining: 'secondary',
  waiting: 'secondary',
  admitted: 'secondary',
  recording: 'default',
  processing: 'secondary',
  completed: 'default',
  failed: 'destructive',
  kicked: 'destructive',
  denied: 'destructive',
  timeout: 'destructive',
  cancelled: 'outline',
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

function getPlatformLabel(platform: string) {
  switch (platform) {
    case 'google_meet':
      return 'Google Meet'
    case 'teams':
      return 'Microsoft Teams'
    case 'zoom':
      return 'Zoom'
    default:
      return 'Unknown'
  }
}

// TODO: Remove mock data once real recordings exist
type MockRecording = {
  id: string
  status: string
  meetingPlatform: string
  botName: string
  provider: string
  durationSeconds: number | null
  startedAt: Date | null
  endedAt: Date | null
  failureReason: string | null
  videoAssetId: string | null
  createdAt: Date
  calendarEvent: { title: string } | null
  participants: { id: string; name: string | null; email: string | null }[]
}

const MOCK_RECORDINGS: Record<string, MockRecording> = {
  rec_001: {
    id: 'rec_001',
    status: 'completed',
    meetingPlatform: 'google_meet',
    botName: 'Auxx Recorder',
    provider: 'recall',
    durationSeconds: 2340,
    startedAt: new Date('2026-04-14T14:00:00Z'),
    endedAt: new Date('2026-04-14T14:39:00Z'),
    failureReason: null,
    videoAssetId: 'asset_video_1',
    createdAt: new Date('2026-04-14T13:58:00Z'),
    calendarEvent: { title: 'Q2 Product Roadmap Review' },
    participants: [
      { id: 'p1', name: 'Markus Klooth', email: 'markus@auxx-lift.com' },
      { id: 'p2', name: 'Sarah Chen', email: 'sarah@acme.com' },
      { id: 'p3', name: null, email: 'john@partner.co' },
    ],
  },
  rec_002: {
    id: 'rec_002',
    status: 'recording',
    meetingPlatform: 'zoom',
    botName: 'Auxx Recorder',
    provider: 'recall',
    durationSeconds: null,
    startedAt: new Date('2026-04-15T10:00:00Z'),
    endedAt: null,
    failureReason: null,
    videoAssetId: null,
    createdAt: new Date('2026-04-15T09:58:00Z'),
    calendarEvent: { title: 'Weekly Customer Success Sync' },
    participants: [
      { id: 'p4', name: 'Markus Klooth', email: 'markus@auxx-lift.com' },
      { id: 'p5', name: 'Emily Rodriguez', email: 'emily@client.com' },
    ],
  },
  rec_003: {
    id: 'rec_003',
    status: 'completed',
    meetingPlatform: 'teams',
    botName: 'Auxx Recorder',
    provider: 'recall',
    durationSeconds: 1800,
    startedAt: new Date('2026-04-13T16:00:00Z'),
    endedAt: new Date('2026-04-13T16:30:00Z'),
    failureReason: null,
    videoAssetId: null,
    createdAt: new Date('2026-04-13T15:58:00Z'),
    calendarEvent: { title: 'Sprint Retrospective' },
    participants: [
      { id: 'p6', name: 'Markus Klooth', email: 'markus@auxx-lift.com' },
      { id: 'p7', name: 'Alex Kim', email: 'alex@auxx-lift.com' },
      { id: 'p8', name: 'Jordan Lee', email: 'jordan@auxx-lift.com' },
      { id: 'p9', name: 'Priya Sharma', email: 'priya@auxx-lift.com' },
    ],
  },
  rec_004: {
    id: 'rec_004',
    status: 'failed',
    meetingPlatform: 'google_meet',
    botName: 'Auxx Recorder',
    provider: 'recall',
    durationSeconds: null,
    startedAt: null,
    endedAt: null,
    failureReason: 'Bot was denied entry to the meeting',
    videoAssetId: null,
    createdAt: new Date('2026-04-12T11:00:00Z'),
    calendarEvent: { title: 'Investor Update Call' },
    participants: [],
  },
  rec_005: {
    id: 'rec_005',
    status: 'created',
    meetingPlatform: 'google_meet',
    botName: 'Auxx Recorder',
    provider: 'recall',
    durationSeconds: null,
    startedAt: null,
    endedAt: null,
    failureReason: null,
    videoAssetId: null,
    createdAt: new Date('2026-04-15T15:00:00Z'),
    calendarEvent: { title: 'Design Review — Calls Page' },
    participants: [{ id: 'p10', name: 'Markus Klooth', email: 'markus@auxx-lift.com' }],
  },
}

const USE_MOCK_DATA = true

export function RecordingDetail({ recordingId }: { recordingId: string }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data: realRecording, isLoading } = api.recording.getById.useQuery(
    { id: recordingId },
    { enabled: !USE_MOCK_DATA }
  )
  const recording = USE_MOCK_DATA ? (MOCK_RECORDINGS[recordingId] ?? null) : realRecording

  const { data: videoSession } = api.recording.getVideoSession.useQuery(
    { id: recordingId },
    { enabled: !USE_MOCK_DATA && !!recording?.videoAssetId }
  )

  const cancelRecording = api.recording.cancel.useMutation({
    onSuccess: () => {
      utils.recording.getById.invalidate({ id: recordingId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to cancel recording', description: error.message })
    },
  })

  const deleteRecording = api.recording.delete.useMutation({
    onSuccess: () => {
      router.push('/app/calls')
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete recording', description: error.message })
    },
  })

  const breadcrumbTitle = recording?.calendarEvent?.title ?? recording?.botName ?? 'Recording'
  const isActive = recording ? !TERMINAL_STATUSES.includes(recording.status as BotStatus) : false
  const title = breadcrumbTitle

  if (isLoading && !USE_MOCK_DATA) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
            <MainPageBreadcrumbItem title='Recordings' href='/app/calls' />
            <MainPageBreadcrumbItem title='Loading...' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='flex h-full items-center justify-center'>
            <Loader size='sm' title='Loading recording...' subtitle='Please wait' />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (!recording) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
            <MainPageBreadcrumbItem title='Recordings' href='/app/calls' />
            <MainPageBreadcrumbItem title='Not Found' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState icon={Video} title='Recording not found' />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          <MainPageBreadcrumbItem title='Recordings' href='/app/calls' />
          <MainPageBreadcrumbItem title={breadcrumbTitle} last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='space-y-6 p-3 sm:p-6'>
          <ConfirmDialog />

          {/* Header */}
          <div className='flex items-start justify-between'>
            <div className='space-y-1'>
              <h1 className='text-2xl font-semibold'>{title}</h1>
              <div className='text-muted-foreground flex items-center gap-3 text-sm'>
                <span>{getPlatformLabel(recording.meetingPlatform)}</span>
                <span>·</span>
                <span>{formatDateTime(recording.createdAt)}</span>
                {recording.durationSeconds && (
                  <>
                    <span>·</span>
                    <div className='flex items-center gap-1'>
                      <Clock className='size-3.5' />
                      <span>{formatDuration(recording.durationSeconds)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className='flex items-center gap-2'>
              <Badge variant={STATUS_BADGE_VARIANT[recording.status] ?? 'outline'}>
                {isActive && (
                  <span className='mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current' />
                )}
                {recording.status}
              </Badge>

              {isActive && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => cancelRecording.mutate({ id: recordingId })}
                  loading={cancelRecording.isPending}
                  loadingText='Cancelling...'>
                  <XCircle />
                  Cancel
                </Button>
              )}

              <Button
                variant='outline'
                size='sm'
                onClick={async () => {
                  const confirmed = await confirm({
                    title: 'Delete recording?',
                    description:
                      'This will permanently delete the recording and all associated media.',
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                    destructive: true,
                  })
                  if (confirmed) {
                    deleteRecording.mutate({ id: recordingId })
                  }
                }}
                loading={deleteRecording.isPending}>
                <Trash2 />
              </Button>
            </div>
          </div>

          {/* Video Player */}
          {recording.status === 'completed' && videoSession?.url && (
            <div className='overflow-hidden rounded-lg border bg-black'>
              <video
                controls
                className='aspect-video w-full'
                src={videoSession.url}
                preload='metadata'>
                Your browser does not support the video tag.
              </video>
            </div>
          )}

          {recording.status === 'completed' && !recording.videoAssetId && (
            <div className='flex items-center justify-center rounded-lg border py-16'>
              <div className='text-muted-foreground text-sm'>
                Video not yet available — media is still being processed.
              </div>
            </div>
          )}

          {recording.status === 'processing' && (
            <div className='flex items-center justify-center rounded-lg border py-16'>
              <div className='text-muted-foreground text-sm'>Recording is being processed...</div>
            </div>
          )}

          {/* Recording Info */}
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-4 rounded-lg border p-4'>
              <h3 className='text-sm font-medium'>Recording Details</h3>
              <dl className='space-y-2 text-sm'>
                <div className='flex justify-between'>
                  <dt className='text-muted-foreground'>Bot Name</dt>
                  <dd>{recording.botName}</dd>
                </div>
                <div className='flex justify-between'>
                  <dt className='text-muted-foreground'>Provider</dt>
                  <dd className='capitalize'>{recording.provider}</dd>
                </div>
                <div className='flex justify-between'>
                  <dt className='text-muted-foreground'>Platform</dt>
                  <dd>{getPlatformLabel(recording.meetingPlatform)}</dd>
                </div>
                {recording.startedAt && (
                  <div className='flex justify-between'>
                    <dt className='text-muted-foreground'>Started</dt>
                    <dd>{formatDateTime(recording.startedAt)}</dd>
                  </div>
                )}
                {recording.endedAt && (
                  <div className='flex justify-between'>
                    <dt className='text-muted-foreground'>Ended</dt>
                    <dd>{formatDateTime(recording.endedAt)}</dd>
                  </div>
                )}
                {recording.failureReason && (
                  <div className='flex justify-between'>
                    <dt className='text-muted-foreground'>Failure Reason</dt>
                    <dd className='text-destructive'>{recording.failureReason}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Participants */}
            <div className='space-y-4 rounded-lg border p-4'>
              <h3 className='text-sm font-medium'>Participants</h3>
              {recording.participants.length > 0 ? (
                <ul className='space-y-2'>
                  {recording.participants.map((participant) => (
                    <li key={participant.id} className='flex items-center gap-2 text-sm'>
                      <UserCircle className='text-muted-foreground size-4' />
                      <span>{participant.name ?? participant.email ?? 'Unknown'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-muted-foreground text-sm'>No participant data available.</p>
              )}
            </div>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
