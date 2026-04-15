// apps/web/src/app/(protected)/app/_components/upcoming-meetings-widget.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { formatDistanceToNow } from 'date-fns'
import { CalendarDays, ExternalLink, Users, Video } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { api, type RouterOutputs } from '~/trpc/react'

type UpcomingMeeting = RouterOutputs['calendar']['getUpcoming'][number]

/**
 * Upcoming meetings summary panel for the Calls page.
 * Renders as a top section with rounded top corners and bottom border.
 */
export function UpcomingMeetingsWidget({ limit = 5 }: { limit?: number }) {
  const router = useRouter()
  const { data: meetings, isLoading } = api.calendar.getUpcoming.useQuery({ limit })
  const { data: syncStatus } = api.calendar.getSyncStatus.useQuery()

  const hasCalendarIntegration =
    syncStatus?.integrations.some((integration) => integration.calendarSyncEnabled) ?? false

  const handleOpenMeeting = (meetingId: string | null) => {
    if (meetingId) {
      router.push(`/app/custom/meetings/${meetingId}`)
      return
    }
    router.push('/app/calls')
  }

  const handleConnectCalendar = () => {
    router.push('/app/settings/channels')
  }

  return (
    <div className='bg-primary-50 border-b px-4 py-3 sm:px-6'>
      <div className='mb-2 flex items-center gap-2 text-sm font-medium'>
        <CalendarDays className='size-4' />
        Upcoming Meetings
      </div>

      {!hasCalendarIntegration && !isLoading ? (
        <div className='flex items-center gap-3 rounded-lg border border-dashed bg-background p-3'>
          <p className='text-sm text-muted-foreground'>
            Connect Google Calendar to start syncing meetings.
          </p>
          <Button variant='outline' size='sm' onClick={handleConnectCalendar}>
            <CalendarDays />
            Connect
          </Button>
        </div>
      ) : null}

      {isLoading ? <p className='text-sm text-muted-foreground'>Loading meetings...</p> : null}

      {hasCalendarIntegration && meetings?.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No upcoming meetings.</p>
      ) : null}

      {meetings && meetings.length > 0 ? (
        <div className='flex gap-2 overflow-x-auto'>
          {meetings.map((meeting: UpcomingMeeting) => (
            <button
              type='button'
              key={meeting.id}
              onClick={() => handleOpenMeeting(meeting.linkedMeetingId)}
              className='flex min-w-[220px] shrink-0 items-start justify-between gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-primary-100'>
              <div className='space-y-1'>
                <div className='text-sm font-medium leading-tight'>{meeting.title}</div>
                <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <span>
                    {formatDistanceToNow(new Date(meeting.startTime), { addSuffix: true })}
                  </span>
                  <span className='flex items-center gap-1'>
                    <Users className='size-3' />
                    {meeting.participantCount}
                  </span>
                  <span className='flex items-center gap-1'>
                    <Video className='size-3' />
                    {meeting.meetingPlatform ?? 'unknown'}
                  </span>
                </div>
              </div>
              <ExternalLink className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
