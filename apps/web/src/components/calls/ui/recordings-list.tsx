// apps/web/src/components/calls/ui/recordings-list.tsx
'use client'

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import Loader from '@auxx/ui/components/loader'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Monitor, Video } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '~/components/global/empty-state'
import { api, type RouterOutputs } from '~/trpc/react'

type RecordingItem = RouterOutputs['recording']['list']['items'][number]

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

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

function getPlatformIcon(platform: string) {
  switch (platform) {
    case 'google_meet':
      return <Video className='size-4 text-green-600' />
    case 'teams':
      return <Monitor className='size-4 text-blue-600' />
    case 'zoom':
      return <Video className='size-4 text-blue-500' />
    default:
      return <Video className='size-4 text-muted-foreground' />
  }
}

function getPlatformLabel(platform: string) {
  switch (platform) {
    case 'google_meet':
      return 'Google Meet'
    case 'teams':
      return 'Teams'
    case 'zoom':
      return 'Zoom'
    default:
      return 'Unknown'
  }
}

// TODO: Remove mock data once real recordings exist
const MOCK_RECORDINGS: RecordingItem[] = [
  {
    id: 'rec_001',
    organizationId: 'org_1',
    meetingId: null,
    calendarEventId: null,
    externalBotId: 'bot_abc',
    provider: 'recall',
    meetingPlatform: 'google_meet',
    status: 'completed',
    botName: 'Auxx Recorder',
    consentMessage: null,
    durationSeconds: 2340,
    startedAt: new Date('2026-04-14T14:00:00Z'),
    endedAt: new Date('2026-04-14T14:39:00Z'),
    failureReason: null,
    videoAssetId: null,
    audioAssetId: null,
    videoPreviewAssetId: null,
    videoStoryboardAssetId: null,
    createdById: 'user_1',
    createdAt: new Date('2026-04-14T13:58:00Z'),
    updatedAt: new Date('2026-04-14T14:39:00Z'),
    calendarEvent: { title: 'Q2 Product Roadmap Review' } as never,
  },
  {
    id: 'rec_002',
    organizationId: 'org_1',
    meetingId: null,
    calendarEventId: null,
    externalBotId: 'bot_def',
    provider: 'recall',
    meetingPlatform: 'zoom',
    status: 'recording',
    botName: 'Auxx Recorder',
    consentMessage: null,
    durationSeconds: null,
    startedAt: new Date('2026-04-15T10:00:00Z'),
    endedAt: null,
    failureReason: null,
    videoAssetId: null,
    audioAssetId: null,
    videoPreviewAssetId: null,
    videoStoryboardAssetId: null,
    createdById: 'user_1',
    createdAt: new Date('2026-04-15T09:58:00Z'),
    updatedAt: new Date('2026-04-15T10:00:00Z'),
    calendarEvent: { title: 'Weekly Customer Success Sync' } as never,
  },
  {
    id: 'rec_003',
    organizationId: 'org_1',
    meetingId: null,
    calendarEventId: null,
    externalBotId: 'bot_ghi',
    provider: 'recall',
    meetingPlatform: 'teams',
    status: 'completed',
    botName: 'Auxx Recorder',
    consentMessage: null,
    durationSeconds: 1800,
    startedAt: new Date('2026-04-13T16:00:00Z'),
    endedAt: new Date('2026-04-13T16:30:00Z'),
    failureReason: null,
    videoAssetId: 'asset_video_1',
    audioAssetId: null,
    videoPreviewAssetId: null,
    videoStoryboardAssetId: null,
    createdById: 'user_1',
    createdAt: new Date('2026-04-13T15:58:00Z'),
    updatedAt: new Date('2026-04-13T16:30:00Z'),
    calendarEvent: { title: 'Sprint Retrospective' } as never,
  },
  {
    id: 'rec_004',
    organizationId: 'org_1',
    meetingId: null,
    calendarEventId: null,
    externalBotId: 'bot_jkl',
    provider: 'recall',
    meetingPlatform: 'google_meet',
    status: 'failed',
    botName: 'Auxx Recorder',
    consentMessage: null,
    durationSeconds: null,
    startedAt: null,
    endedAt: null,
    failureReason: 'Bot was denied entry to the meeting',
    videoAssetId: null,
    audioAssetId: null,
    videoPreviewAssetId: null,
    videoStoryboardAssetId: null,
    createdById: 'user_1',
    createdAt: new Date('2026-04-12T11:00:00Z'),
    updatedAt: new Date('2026-04-12T11:02:00Z'),
    calendarEvent: { title: 'Investor Update Call' } as never,
  },
  {
    id: 'rec_005',
    organizationId: 'org_1',
    meetingId: null,
    calendarEventId: null,
    externalBotId: null,
    provider: 'recall',
    meetingPlatform: 'google_meet',
    status: 'created',
    botName: 'Auxx Recorder',
    consentMessage: null,
    durationSeconds: null,
    startedAt: null,
    endedAt: null,
    failureReason: null,
    videoAssetId: null,
    audioAssetId: null,
    videoPreviewAssetId: null,
    videoStoryboardAssetId: null,
    createdById: 'user_1',
    createdAt: new Date('2026-04-15T15:00:00Z'),
    updatedAt: new Date('2026-04-15T15:00:00Z'),
    calendarEvent: { title: 'Design Review — Calls Page' } as never,
  },
]

const USE_MOCK_DATA = true

export function RecordingsList() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    api.recording.list.useInfiniteQuery(
      { limit: 20 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !USE_MOCK_DATA,
      }
    )

  const recordings = USE_MOCK_DATA
    ? MOCK_RECORDINGS
    : (data?.pages.flatMap((page) => page.items) ?? [])

  if (isLoading && !USE_MOCK_DATA) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loader size='sm' title='Loading recordings...' subtitle='Please wait' />
      </div>
    )
  }

  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={Video}
        title='No recordings yet'
        description='Recordings will appear here when you record meetings.'
      />
    )
  }

  return (
    <div className='space-y-4'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Meeting</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recordings.map((recording) => (
            <RecordingRow key={recording.id} recording={recording} />
          ))}
        </TableBody>
      </Table>

      {!USE_MOCK_DATA && hasNextPage && (
        <div className='flex justify-center pt-4'>
          <Button
            variant='outline'
            onClick={() => fetchNextPage()}
            loading={isFetchingNextPage}
            loadingText='Loading more...'>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

function RecordingRow({ recording }: { recording: RecordingItem }) {
  const title = recording.calendarEvent?.title ?? recording.botName ?? 'Untitled Recording'
  const isActive = !TERMINAL_STATUSES.includes(recording.status as BotStatus)

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/app/calls/recordings/${recording.id}`}
          className='font-medium hover:underline'>
          {title}
        </Link>
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-1.5'>
          {getPlatformIcon(recording.meetingPlatform)}
          <span className='text-muted-foreground text-sm'>
            {getPlatformLabel(recording.meetingPlatform)}
          </span>
        </div>
      </TableCell>
      <TableCell className='text-muted-foreground text-sm'>
        {formatDate(recording.createdAt)}
      </TableCell>
      <TableCell className='text-muted-foreground text-sm'>
        {formatDuration(recording.durationSeconds)}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[recording.status] ?? 'outline'}>
          {isActive && (
            <span className='mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current' />
          )}
          {recording.status}
        </Badge>
      </TableCell>
    </TableRow>
  )
}
