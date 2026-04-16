// apps/web/src/components/calls/ui/recording-detail.tsx
'use client'

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError } from '@auxx/ui/components/toast'
import {
  BookOpen,
  CalendarDays,
  FileText,
  Trash2,
  Users,
  Video,
  VideoOff,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { Tooltip } from '~/components/global/tooltip'
import { getOrCreateStore, VideoPlayer } from '~/components/video-player'
import { useConfirm } from '~/hooks/use-confirm'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { RecordingMeeting } from './recording-meeting'
import { RecordingSpeakers } from './recording-speakers'
import { RecordingSummary } from './recording-summary'
import { RecordingTranscript } from './recording-transcript'
import { useRecordingPlayer } from './use-recording-player'

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

// TODO: Remove mock data once real recordings exist
export type MockRecording = {
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

import { USE_MOCK_DATA } from '../constants'

/**
 * RecordingDetail — main recording detail page component
 */
export function RecordingDetail({ recordingId }: { recordingId: string }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'transcript' })
  const [showVideo, setShowVideo] = useState(true)
  const utils = api.useUtils()
  const setCurrentTimeMs = useRecordingPlayer((s) => s.setCurrentTimeMs)
  const registerSeekTo = useRecordingPlayer((s) => s.registerSeekTo)
  const unregisterSeekTo = useRecordingPlayer((s) => s.unregisterSeekTo)

  // Sidebar visible on desktop — Summary tab takes over on mobile
  const isDesktop = useMedia('(min-width: 1024px)')

  // When expanding to desktop, switch off the summary tab (sidebar handles it)
  useEffect(() => {
    if (isDesktop && tab === 'summary') {
      setTab('transcript')
    }
  }, [isDesktop, tab, setTab])
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const { data: realRecording, isLoading } = api.recording.getById.useQuery(
    { id: recordingId },
    { enabled: !USE_MOCK_DATA }
  )
  const recording = USE_MOCK_DATA ? (MOCK_RECORDINGS[recordingId] ?? null) : realRecording

  const { data: videoSession } = api.recording.getVideoSession.useQuery(
    { id: recordingId },
    { enabled: !USE_MOCK_DATA && !!recording?.videoAssetId }
  )

  // Sync VideoPlayer store → useRecordingPlayer bridge
  useEffect(() => {
    if (!videoSession?.url) return

    const store = getOrCreateStore(recordingId)
    const unsub = store.subscribe((state) => {
      setCurrentTimeMs(Math.floor(state.played * 1000))
    })

    registerSeekTo((ms: number) => {
      const store = getOrCreateStore(recordingId)
      store.setState({ pendingSeek: ms / 1000, videoLoadRequested: true })
    })

    return () => {
      unsub()
      unregisterSeekTo()
    }
  }, [recordingId, videoSession?.url, setCurrentTimeMs, registerSeekTo, unregisterSeekTo])

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

  if (isLoading && !USE_MOCK_DATA) {
    return <RecordingDetailSkeleton />
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
      <MainPageHeader
        action={
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
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          <MainPageBreadcrumbItem title='Recordings' href='/app/calls' />
          <MainPageBreadcrumbItem title={breadcrumbTitle} last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent
        dockedPanels={
          isDesktop
            ? [
                {
                  key: 'summary-sidebar',
                  content: (
                    <>
                      <DrawerHeader icon={<BookOpen className='size-4' />} title='Summary' />
                      <div className='h-full overflow-y-auto'>
                        <RecordingSummary />
                      </div>
                    </>
                  ),
                  width: dockedWidth,
                  onWidthChange: setDockedWidth,
                  minWidth,
                  maxWidth,
                },
              ]
            : []
        }>
        <ConfirmDialog />

        <div className='flex-1 h-full flex flex-col min-h-0'>
          {/* Video Player — 16:9 placeholder with collapse animation */}
          <AnimatePresence initial={false}>
            {showVideo && (
              <motion.div
                initial={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                animate={{
                  height: 'auto',
                  opacity: 1,
                  filter: 'blur(0px)',
                  overflow: 'hidden',
                  transitionEnd: { overflow: 'visible' },
                }}
                exit={{ height: 0, opacity: 0, filter: 'blur(3px)', overflow: 'hidden' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                <div className='p-3'>
                  {recording.status === 'completed' && videoSession?.url ? (
                    <div className='overflow-hidden rounded-lg border'>
                      <VideoPlayer
                        videoId={recordingId}
                        sourceUrl={videoSession.url}
                        borderRadius='8'
                        hasBorder={false}
                      />
                    </div>
                  ) : (
                    <div className='flex items-center justify-center rounded-lg border bg-muted aspect-video'>
                      <div className='flex flex-col items-center gap-2 text-muted-foreground'>
                        <Video className='size-10' />
                        <span className='text-sm'>
                          {recording.status === 'processing'
                            ? 'Recording is being processed...'
                            : recording.status === 'completed' && !recording.videoAssetId
                              ? 'Video not yet available'
                              : 'Video player'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tabs */}
          <Tabs
            value={tab ?? 'transcript'}
            onValueChange={setTab}
            className='flex-1 flex flex-col min-h-0'>
            <motion.div
              animate={{
                borderTopLeftRadius: showVideo ? 0 : 8,
                borderTopRightRadius: showVideo ? 0 : 8,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
              <TabsList className='border-b w-full justify-start rounded-none bg-primary-150 px-3 sm:px-6'>
                <TabsTrigger value='summary' variant='outline' className='lg:hidden'>
                  <BookOpen /> Summary
                </TabsTrigger>
                <TabsTrigger value='transcript' variant='outline'>
                  <FileText /> Transcript
                </TabsTrigger>
                <TabsTrigger value='speakers' variant='outline'>
                  <Users /> Speakers
                </TabsTrigger>
                <TabsTrigger value='meeting' variant='outline'>
                  <CalendarDays /> Meeting
                </TabsTrigger>

                {/* Video toggle */}
                <div className='ml-auto flex items-center'>
                  <Tooltip content={showVideo ? 'Hide video' : 'Show video'}>
                    <Button variant='ghost' size='icon-sm' onClick={() => setShowVideo((v) => !v)}>
                      {showVideo ? <VideoOff /> : <Video />}
                    </Button>
                  </Tooltip>
                </div>
              </TabsList>
            </motion.div>

            <TabsContent value='summary' className='flex flex-col flex-1 min-h-0 overflow-y-auto'>
              <RecordingSummary />
            </TabsContent>

            <TabsContent value='transcript' className='flex flex-col flex-1 min-h-0'>
              <RecordingTranscript recordingId={recordingId} />
            </TabsContent>

            <TabsContent value='speakers' className='flex flex-col flex-1 min-h-0'>
              <RecordingSpeakers recordingId={recordingId} />
            </TabsContent>

            <TabsContent value='meeting' className='flex flex-col flex-1 min-h-0 overflow-y-auto'>
              <RecordingMeeting recording={recording} />
            </TabsContent>
          </Tabs>
        </div>
      </MainPageContent>
    </MainPage>
  )
}

/**
 * RecordingDetailSkeleton — loading skeleton
 */
function RecordingDetailSkeleton() {
  const isDesktop = useMedia('(min-width: 1024px)')
  const dockedWidth = useDockStore((state) => state.dockedWidth)

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          <MainPageBreadcrumbItem title='Recordings' href='/app/calls' />
          <MainPageBreadcrumbItem title='Loading...' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent
        dockedPanels={
          isDesktop
            ? [
                {
                  key: 'summary-sidebar',
                  content: (
                    <div className='p-4 space-y-4'>
                      <Skeleton className='h-6 w-24' />
                      <Skeleton className='h-20 w-full' />
                      <Skeleton className='h-6 w-24' />
                      <Skeleton className='h-20 w-full' />
                    </div>
                  ),
                  width: dockedWidth,
                },
              ]
            : []
        }>
        <div className='p-6 space-y-4'>
          <Skeleton className='aspect-video w-full rounded-lg' />
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      </MainPageContent>
    </MainPage>
  )
}
