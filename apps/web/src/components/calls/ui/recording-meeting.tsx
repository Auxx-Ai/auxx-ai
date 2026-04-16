// apps/web/src/components/calls/ui/recording-meeting.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { CalendarClock, Clock, Link2, Users } from 'lucide-react'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import type { MockRecording, MockRecordingParticipant } from './recording-detail'

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function formatDuration(startTime: Date, endTime: Date): string {
  const ms = endTime.getTime() - startTime.getTime()
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function getInitials(name: string | null, email: string | null): string {
  const source = name ?? email ?? ''
  const parts = source.split(/[\s.@]+/).filter(Boolean)
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
  return letters.toUpperCase() || '?'
}

const ATTENDANCE_LABEL: Record<MockRecordingParticipant['rsvpStatus'], string> = {
  accepted: 'Attended',
  declined: 'Declined',
  tentative: 'Tentative',
  needs_action: 'No response',
}

const ATTENDANCE_DOT_CLASS: Record<MockRecordingParticipant['rsvpStatus'], string> = {
  accepted: 'bg-emerald-500',
  declined: 'bg-rose-500',
  tentative: 'bg-amber-500',
  needs_action: 'bg-muted-foreground/40',
}

function AttendancePill({ status }: { status: MockRecordingParticipant['rsvpStatus'] }) {
  return (
    <span className='flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground'>
      <span className={cn('inline-block size-1.5 rounded-full', ATTENDANCE_DOT_CLASS[status])} />
      {ATTENDANCE_LABEL[status]}
    </span>
  )
}

function ParticipantRow({ participant }: { participant: MockRecordingParticipant }) {
  const displayName = participant.name ?? participant.email ?? 'Unknown'
  const showEmailSeparately = !!participant.name && !!participant.email

  return (
    <li className='flex items-center gap-2 py-1.5'>
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        {participant.contactEntityInstanceId ? (
          <RecordBadge
            recordId={toRecordId('contact', participant.contactEntityInstanceId)}
            variant='link'
            link={true}
          />
        ) : (
          <div className='flex min-w-0 items-center gap-2'>
            <Avatar className='size-6'>
              <AvatarFallback className='text-[10px]'>
                {getInitials(participant.name, participant.email)}
              </AvatarFallback>
            </Avatar>
            <span className='truncate text-sm font-medium'>{displayName}</span>
          </div>
        )}

        {participant.isOrganizer && (
          <Badge variant='outline' className='h-5 shrink-0 px-1.5 text-[10px] font-normal'>
            Host
          </Badge>
        )}

        {showEmailSeparately && (
          <span className='truncate text-xs text-muted-foreground'>{participant.email}</span>
        )}
      </div>

      <AttendancePill status={participant.rsvpStatus} />
    </li>
  )
}

export function RecordingMeeting({ recording }: { recording: MockRecording }) {
  const event = recording.calendarEvent
  const startTime = event?.startTime ? new Date(event.startTime) : null
  const endTime = event?.endTime ? new Date(event.endTime) : null

  const participantCount = recording.participants.length

  return (
    <div>
      <Section title='Details' icon={<CalendarClock className='size-3.5' />} collapsible={false}>
        <div className='space-y-2'>
          {startTime && endTime && (
            <div className='flex items-center gap-2 text-sm'>
              <Clock className='size-4 shrink-0 text-muted-foreground' />
              <span>{formatDate(startTime)}</span>
              <span className='text-muted-foreground'>|</span>
              <span>{formatTime(startTime)}</span>
              <span className='text-muted-foreground'>→</span>
              <span>{formatTime(endTime)}</span>
              <span className='text-muted-foreground'>({formatDuration(startTime, endTime)})</span>
            </div>
          )}

          {event?.meetingUrl && (
            <div className='flex items-center gap-2 text-sm'>
              <Link2 className='size-4 shrink-0 text-muted-foreground' />
              <a
                href={event.meetingUrl}
                target='_blank'
                rel='noreferrer'
                className='truncate underline underline-offset-2 hover:text-foreground/80'>
                {event.meetingUrl}
              </a>
            </div>
          )}

          {recording.failureReason && (
            <div className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'>
              {recording.failureReason}
            </div>
          )}
        </div>
      </Section>

      <Section
        title={
          <span className='inline-flex items-center gap-1.5 leading-none'>
            Participants
            {participantCount > 0 && (
              <Badge variant='outline' className='h-4 px-1 text-[10px] font-normal leading-none'>
                {participantCount}
              </Badge>
            )}
          </span>
        }
        icon={<Users className='size-3.5' />}
        collapsible={false}>
        {participantCount > 0 ? (
          <ul className='divide-y'>
            {recording.participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} />
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>No participant data available.</p>
        )}
      </Section>
    </div>
  )
}
