// apps/web/src/components/schedule/ui/meeting-sheet.tsx
//
// Read-only meeting sheet (08-worker-surface.md §4) — the Schedule page's meeting tap target.
// Cross-agent interface: exported with the exact props `{ meetingId, open, onOpenChange }` so
// 1B's `schedule-page.tsx` (and `visit-detail-page.tsx`, if a visit ever wants to surface a
// linked meeting) can mount it without knowing anything about its internals.

'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerTitle,
} from '@auxx/ui/components/drawer'
import { Link2, Video } from 'lucide-react'
import { api } from '~/trpc/react'

interface MeetingSheetProps {
  meetingId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const RSVP_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
  needs_action: 'No response',
}

/** Bottom-sheet positioning override — see `visit-close-chooser.tsx`'s identical comment. */
const BOTTOM_SHEET_CLASS =
  'inset-x-0 bottom-0 top-auto right-auto left-0 max-h-[85vh] w-full rounded-t-2xl border-t max-sm:w-screen!'

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

/** `EEE, MMM d · h:mm a – h:mm a (tz)` in the meeting's own timezone. */
function formatMeetingWindow(start: Date, end: Date, timezone: string): string {
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)} (${timezone})`
}

/**
 * Bottom `Drawer`, read-only: title, time+tz, attendees (name/email + organizer/RSVP hint), a
 * `meetingUrl` button when present, and a linked-record chip when `linkedRecordId` present. Guards
 * `getMyMeeting` on `meetingId !== null` via `enabled` so it never fires while closed.
 */
export function MeetingSheet({ meetingId, open, onOpenChange }: MeetingSheetProps) {
  const { data: meeting, isLoading } = api.calendar.getMyMeeting.useQuery(
    { meetingId: meetingId ?? '' },
    { enabled: meetingId !== null }
  )

  return (
    <Drawer direction='bottom' open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={BOTTOM_SHEET_CLASS}>
        <DrawerHandle />
        <div className='flex flex-col gap-4 p-4'>
          {isLoading ? (
            <div className='py-8 text-center text-sm text-muted-foreground'>Loading meeting…</div>
          ) : !meeting ? (
            <div className='py-8 text-center text-sm text-muted-foreground'>Meeting not found.</div>
          ) : (
            <>
              <div>
                <DrawerTitle>{meeting.title}</DrawerTitle>
                <DrawerDescription>
                  {formatMeetingWindow(meeting.startTime, meeting.endTime, meeting.timezone)}
                </DrawerDescription>
              </div>

              {meeting.meetingUrl && (
                <Button asChild variant='outline'>
                  <a href={meeting.meetingUrl} target='_blank' rel='noreferrer'>
                    <Video /> Join meeting
                  </a>
                </Button>
              )}

              {meeting.linkedRecordId && (
                <Badge variant='outline' className='w-fit gap-1'>
                  <Link2 className='size-3' /> Linked record
                </Badge>
              )}

              <div>
                <div className='mb-2 text-xs font-medium uppercase text-muted-foreground'>
                  Attendees
                </div>
                <ul className='flex flex-col gap-2'>
                  {meeting.attendees.map((attendee) => (
                    <li key={attendee.email} className='flex items-center gap-2'>
                      <Avatar className='size-7'>
                        <AvatarFallback className='text-xs'>
                          {getInitials(attendee.name || attendee.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-sm'>{attendee.name || attendee.email}</div>
                        <div className='truncate text-xs text-muted-foreground'>
                          {attendee.email}
                        </div>
                      </div>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {attendee.isOrganizer
                          ? 'Organizer'
                          : (RSVP_LABEL[attendee.rsvpStatus] ?? attendee.rsvpStatus)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
