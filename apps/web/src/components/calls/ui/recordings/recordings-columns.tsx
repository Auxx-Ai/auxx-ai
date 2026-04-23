// apps/web/src/components/calls/ui/recordings/recordings-columns.tsx

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import {
  CalendarClock,
  CircleDot,
  Clock,
  Monitor,
  PanelRight,
  Play,
  StopCircle,
  Trash2,
  Video,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { ExpandableCell, FormattedCell, PrimaryCell } from '~/components/dynamic-table'
import { ItemsCellView } from '~/components/ui/items-list-view'
import { RecordingStatusBadge } from './recording-status-badge'
import type { Recording } from './recordings-types'

export interface RecordingsColumnActions {
  onView: (recording: Recording) => void
  onCancel: (recording: Recording) => void
  onDelete: (recording: Recording) => void
}

function getRecordingTitle(recording: Recording): string {
  return recording.calendarEvent?.title ?? recording.botName ?? 'Untitled Recording'
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const PLATFORM_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  google_meet: {
    icon: <Video className='size-4 text-green-600' />,
    label: 'Google Meet',
  },
  teams: {
    icon: <Monitor className='size-4 text-blue-600' />,
    label: 'Teams',
  },
  zoom: {
    icon: <Video className='size-4 text-blue-500' />,
    label: 'Zoom',
  },
}

function getPlatform(platform: string): { icon: React.ReactNode; label: string } {
  return (
    PLATFORM_CONFIG[platform] ?? {
      icon: <Video className='size-4 text-muted-foreground' />,
      label: 'Unknown',
    }
  )
}

export const createRecordingsColumns = (
  actions: RecordingsColumnActions
): ExtendedColumnDef<Recording>[] => [
  {
    id: 'title',
    header: 'Meeting',
    icon: Video,
    accessorFn: (row) => getRecordingTitle(row),
    cell: ({ row }) => {
      const recording = row.original
      const title = getRecordingTitle(recording)
      const isTerminal = TERMINAL_STATUSES.includes(recording.status as BotStatus)

      return (
        <PrimaryCell
          value={title}
          prefixIcon={<Video className='size-3 text-muted-foreground' />}
          onTitleClick={() => actions.onView(recording)}>
          <DropdownMenuItem onClick={() => actions.onView(recording)}>
            <PanelRight />
            View Details
          </DropdownMenuItem>
          {!isTerminal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => actions.onCancel(recording)}>
                <StopCircle />
                Cancel Recording
              </DropdownMenuItem>
            </>
          )}
          {isTerminal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => actions.onDelete(recording)}>
                <Trash2 />
                Delete Recording
              </DropdownMenuItem>
            </>
          )}
        </PrimaryCell>
      )
    },
    enableSorting: false,
    enableHiding: false,
    defaultVisible: true,
    minSize: 240,
    maxSize: 480,
    primaryCell: true,
  },
  {
    id: 'meetingPlatform',
    header: 'Platform',
    icon: Monitor,
    accessorFn: (row) => row.meetingPlatform,
    cell: ({ getValue }) => {
      const platform = getValue<string>()
      const config = getPlatform(platform)
      return (
        <ItemsCellView
          item={platform}
          renderItem={() => (
            <div className='flex items-center gap-1.5'>
              {config.icon}
              <span className='text-muted-foreground text-sm'>{config.label}</span>
            </div>
          )}
        />
      )
    },
    enableSorting: true,
    filterFn: 'equals',
    defaultVisible: true,
    minSize: 140,
    maxSize: 180,
  },
  {
    id: 'status',
    header: 'Status',
    icon: CircleDot,
    accessorFn: (row) => row.status,
    cell: ({ getValue }) => {
      const status = getValue<BotStatus>()
      return (
        <ItemsCellView item={status} renderItem={() => <RecordingStatusBadge status={status} />} />
      )
    },
    enableSorting: true,
    filterFn: 'equals',
    defaultVisible: true,
    minSize: 120,
    maxSize: 160,
  },
  {
    id: 'durationSeconds',
    header: 'Duration',
    icon: Clock,
    accessorFn: (row) => row.durationSeconds,
    cell: ({ getValue }) => {
      const seconds = getValue<number | null>()
      return (
        <ExpandableCell>
          <div className='flex items-center gap-1 text-sm text-muted-foreground'>
            <Clock className='size-3' />
            <span>{formatDuration(seconds)}</span>
          </div>
        </ExpandableCell>
      )
    },
    enableSorting: true,
    sortingFn: 'basic',
    defaultVisible: true,
    minSize: 100,
    maxSize: 140,
  },
  {
    id: 'startedAt',
    header: 'Started',
    icon: Play,
    fieldType: 'DATETIME',
    accessorFn: (row) => row.startedAt,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType='DATETIME' columnId='startedAt' />
    ),
    enableSorting: true,
    sortingFn: 'datetime',
    defaultVisible: false,
    minSize: 140,
    maxSize: 200,
  },
  {
    id: 'createdAt',
    header: 'Created',
    icon: CalendarClock,
    fieldType: 'DATETIME',
    accessorFn: (row) => row.createdAt,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType='DATETIME' columnId='createdAt' />
    ),
    enableSorting: true,
    sortingFn: 'datetime',
    defaultVisible: true,
    minSize: 140,
    maxSize: 200,
  },
]
