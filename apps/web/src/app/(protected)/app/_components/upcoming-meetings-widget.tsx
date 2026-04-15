// apps/web/src/app/(protected)/app/_components/upcoming-meetings-widget.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { formatDistanceToNow } from 'date-fns'
import { CalendarDays, ExternalLink, Users, Video } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { api, type RouterOutputs } from '~/trpc/react'

/**
 * Meeting widget props.
 */
interface UpcomingMeetingsWidgetProps {
  limit?: number
}

/**
 * Single upcoming meeting item returned by the calendar router.
 */
type UpcomingMeeting = RouterOutputs['calendar']['getUpcoming'][number]

/**
 * Upcoming meetings summary card backed by the calendar router.
 */
export function UpcomingMeetingsWidget({ limit = 5 }: UpcomingMeetingsWidgetProps) {
  const router = useRouter()
  const { data: meetings, isLoading } = api.calendar.getUpcoming.useQuery({ limit })
  const { data: syncStatus } = api.calendar.getSyncStatus.useQuery()

  const hasCalendarIntegration =
    syncStatus?.integrations.some((integration) => integration.calendarSyncEnabled) ?? false

  /**
   * Navigate to either the linked Meeting record or the meetings index.
   */
  const handleOpenMeeting = (meetingId: string | null) => {
    if (meetingId) {
      router.push(`/app/meetings/${meetingId}`)
      return
    }

    router.push('/app/meetings')
  }

  /**
   * Navigate to channel settings when the user needs to connect Google Calendar.
   */
  const handleConnectCalendar = () => {
    router.push('/app/settings/channels')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <CalendarDays />
          Upcoming Meetings
        </CardTitle>
        <CardDescription>
          The next synced meetings with attendees and linked Meeting records.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {!hasCalendarIntegration && !isLoading ? (
          <div className='flex flex-col gap-3 rounded-lg border border-dashed p-4'>
            <p className='text-sm text-muted-foreground'>
              Connect Google Calendar on a channel to start syncing meetings.
            </p>
            <Button variant='outline' onClick={handleConnectCalendar}>
              <CalendarDays />
              Connect Calendar
            </Button>
          </div>
        ) : null}

        {isLoading ? <p className='text-sm text-muted-foreground'>Loading meetings...</p> : null}

        {hasCalendarIntegration && meetings?.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No upcoming synced meetings yet.</p>
        ) : null}

        {meetings?.map((meeting: UpcomingMeeting) => (
          <button
            type='button'
            key={meeting.id}
            onClick={() => handleOpenMeeting(meeting.linkedMeetingId)}
            className='flex w-full items-start justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted/50'>
            <div className='space-y-2'>
              <div className='font-medium'>{meeting.title}</div>
              <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
                <span>{formatDistanceToNow(new Date(meeting.startTime), { addSuffix: true })}</span>
                <span className='flex items-center gap-1'>
                  <Users />
                  {meeting.participantCount}
                </span>
                <span className='flex items-center gap-1'>
                  <Video />
                  {meeting.meetingPlatform ?? 'unknown'}
                </span>
              </div>
            </div>
            <ExternalLink />
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
