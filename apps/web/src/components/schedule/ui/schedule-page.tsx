// apps/web/src/components/schedule/ui/schedule-page.tsx
//
// The Schedule page (08-worker-surface.md §2): "my visits + my meetings" in one time-ordered,
// day-grouped list. Header mirrors the board toolbar's Today/prev/next cluster
// (`board-toolbar.tsx:47-74`) but lives in `MainPageHeader`'s `action` slot per the design
// (List view now; Calendar is a disabled placeholder for a later pass).

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, List } from 'lucide-react'
import { useRef, useState } from 'react'
import { LoadingContent } from '~/components/global/loading-content'
import { useMySchedule } from '../hooks/use-my-schedule'
import { MeetingSheet } from './meeting-sheet'
import { ScheduleList, type ScheduleListHandle } from './schedule-list'

export function SchedulePage() {
  const { groups, todayIndex, isLoading } = useMySchedule()
  const listRef = useRef<ScheduleListHandle>(null)
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null)

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-1'>
            <Button variant='outline' size='sm' onClick={() => listRef.current?.scrollToToday()}>
              Today
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => listRef.current?.scrollToPrevious()}
              aria-label='Previous'>
              <ChevronLeft />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => listRef.current?.scrollToNext()}
              aria-label='Next'>
              <ChevronRight />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm'>
                  <List />
                  List
                  <ChevronDown className='opacity-60' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem icon={<List />} selected>
                  List
                </DropdownMenuItem>
                <DropdownMenuItem icon={<CalendarDays />} disabled>
                  Calendar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Schedule' href='/app/schedule' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <LoadingContent loading={isLoading}>
          <ScheduleList
            ref={listRef}
            groups={groups}
            todayIndex={todayIndex}
            onMeetingClick={setOpenMeetingId}
          />
        </LoadingContent>
      </MainPageContent>

      <MeetingSheet
        meetingId={openMeetingId}
        open={openMeetingId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenMeetingId(null)
        }}
      />
    </MainPage>
  )
}
