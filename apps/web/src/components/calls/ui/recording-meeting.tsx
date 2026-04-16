// apps/web/src/components/calls/ui/recording-meeting.tsx
'use client'

import { UserCircle } from 'lucide-react'
import type { MockRecording } from './recording-detail'

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

export function RecordingMeeting({ recording }: { recording: MockRecording }) {
  return (
    <div className='space-y-4 p-3 sm:p-6'>
      {/* Recording Details */}
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
  )
}
