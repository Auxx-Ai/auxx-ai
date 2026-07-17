// apps/web/src/components/schedule/ui/schedule-page.tsx
//
// The Schedule page (08-worker-surface.md §2, calendar view added by
// plans/calendar/02-schedule-calendar-view.md): "my visits + my meetings", either as a
// time-ordered day-grouped list or (desktop only, decision G′) an `EventCalendar` day/week/month
// grid — `/app/schedule` is the personal calendar home (decision A′), there is no separate
// `/app/calendar` route. Header mirrors the board toolbar's Today/prev/next cluster
// (`board-toolbar.tsx:47-74`) but lives in `MainPageHeader`'s `action` slot; the List/Calendar
// dropdown is now the full view switcher (List/Day/Week/Month), driving both the scroll-list
// cluster and the calendar's date nav depending on the active view.

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
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
import { addDays, addMonths, addWeeks, subDays, subMonths, subWeeks } from 'date-fns'
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useCalendarRange } from '~/components/calendar/core/use-calendar-range'
import type { TaskEvent } from '~/components/calendar/sources/tasks-source'
import { LoadingContent } from '~/components/global/loading-content'
import { TaskDialog } from '~/components/tasks/ui/task-dialog'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useIsMobile } from '~/hooks/use-mobile'
import { useDockStore } from '~/stores/dock-store'
import { useMySchedule } from '../hooks/use-my-schedule'
import { type ScheduleView, useScheduleSidebarStore } from '../stores/schedule-sidebar-store'
import { MeetingSheet } from './meeting-sheet'
import { ScheduleCalendar } from './schedule-calendar'
import { ScheduleList, type ScheduleListHandle } from './schedule-list'
import { VisitDrawer } from './visit-drawer'

/** Header dropdown rows — order doubles as display order. */
const VIEW_OPTIONS: { value: ScheduleView; label: string; icon: ReactNode }[] = [
  { value: 'list', label: 'List', icon: <List /> },
  { value: 'day', label: 'Day', icon: <CalendarDays /> },
  { value: 'week', label: 'Week', icon: <CalendarRange /> },
  { value: 'month', label: 'Month', icon: <Calendar /> },
]

export function SchedulePage() {
  const { groups, todayIndex, isLoading } = useMySchedule()
  const listRef = useRef<ScheduleListHandle>(null)
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null)
  const [openVisitId, setOpenVisitId] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<TaskEvent['task'] | null>(null)
  const router = useRouter()
  const isMobile = useIsMobile()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const storeView = useScheduleSidebarStore((s) => s.view)
  const setStoreView = useScheduleSidebarStore((s) => s.setView)
  // A desktop-persisted grid view must not render on the phone — decision G′.
  const effectiveView: ScheduleView = isMobile ? 'list' : storeView

  // Tiny state; fine to mount even while in list view (decision E′ — the list keeps its own
  // fixed-window hook, this range only feeds the calendar view's sources).
  const cal = useCalendarRange(effectiveView === 'list' ? 'week' : effectiveView)

  // View selection updates the persisted store AND `useCalendarRange`'s internal view in the
  // same batch — the range hook must know the new view before `EventCalendar` fires its first
  // `onRangeChange` for it (child effects run before parent effects, so an after-the-fact sync
  // would let one range through with the old view's quantization).
  const handleViewSelect = useCallback(
    (view: ScheduleView) => {
      setStoreView(view)
      if (view !== 'list') cal.setView(view)
    },
    [setStoreView, cal.setView]
  )

  // Backstop for view changes that bypass `handleViewSelect` (e.g. a mobile→desktop viewport
  // flip resurfacing a persisted grid view after `cal` mounted as 'week').
  useEffect(() => {
    if (effectiveView !== 'list' && cal.view !== effectiveView) {
      cal.setView(effectiveView)
    }
  }, [effectiveView, cal.view, cal.setView])

  const currentViewOption = VIEW_OPTIONS.find((o) => o.value === effectiveView) ?? VIEW_OPTIONS[0]!

  // Visit tap target: full page on phone, right-side drawer on desktop (08 §3 build call).
  const handleVisitClick = useCallback(
    (visitId: string) => {
      if (isMobile) {
        router.push(`/app/schedule/visit/${visitId}`)
      } else {
        setOpenVisitId(visitId)
      }
    },
    [isMobile, router]
  )

  const handleVisitDrawerOpenChange = useCallback((open: boolean) => {
    if (!open) setOpenVisitId(null)
  }, [])

  const { dockedPanels, overlays } = useDockedPanels(
    openVisitId
      ? [
          {
            key: 'visit-detail',
            open: true,
            content: (
              <VisitDrawer visitId={openVisitId} open onOpenChange={handleVisitDrawerOpenChange} />
            ),
            width: { value: dockedWidth, set: setDockedWidth, min: 400, max: 800 },
          },
        ]
      : []
  )

  // Today/prev/next is dual-mode: list view keeps the scroll-list handle calls, a calendar
  // view drives `cal.setDate` by the active view's date-fns unit.
  const handleToday = useCallback(() => {
    if (effectiveView === 'list') listRef.current?.scrollToToday()
    else cal.setDate(new Date())
  }, [effectiveView, cal.setDate])

  const handlePrevious = useCallback(() => {
    if (effectiveView === 'list') {
      listRef.current?.scrollToPrevious()
    } else if (effectiveView === 'day') {
      cal.setDate(subDays(cal.date, 1))
    } else if (effectiveView === 'week') {
      cal.setDate(subWeeks(cal.date, 1))
    } else {
      cal.setDate(subMonths(cal.date, 1))
    }
  }, [effectiveView, cal.date, cal.setDate])

  const handleNext = useCallback(() => {
    if (effectiveView === 'list') {
      listRef.current?.scrollToNext()
    } else if (effectiveView === 'day') {
      cal.setDate(addDays(cal.date, 1))
    } else if (effectiveView === 'week') {
      cal.setDate(addWeeks(cal.date, 1))
    } else {
      cal.setDate(addMonths(cal.date, 1))
    }
  }, [effectiveView, cal.date, cal.setDate])

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-1'>
            <Button variant='outline' size='sm' onClick={handleToday}>
              Today
            </Button>
            <Button variant='ghost' size='icon' onClick={handlePrevious} aria-label='Previous'>
              <ChevronLeft />
            </Button>
            <Button variant='ghost' size='icon' onClick={handleNext} aria-label='Next'>
              <ChevronRight />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm'>
                  {currentViewOption.icon}
                  {currentViewOption.label}
                  <ChevronDown className='opacity-60' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {VIEW_OPTIONS.map((option) => {
                  // Grid views are hidden entirely on mobile (decision G′), not disabled.
                  if (isMobile && option.value !== 'list') return null
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      icon={option.icon}
                      selected={option.value === effectiveView}
                      onClick={() => handleViewSelect(option.value)}>
                      {option.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Schedule' href='/app/schedule' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent dockedPanels={dockedPanels}>
        {effectiveView === 'list' ? (
          <LoadingContent loading={isLoading}>
            <ScheduleList
              ref={listRef}
              groups={groups}
              todayIndex={todayIndex}
              onVisitClick={handleVisitClick}
              onMeetingClick={setOpenMeetingId}
            />
          </LoadingContent>
        ) : (
          <ScheduleCalendar
            date={cal.date}
            onDateChange={cal.setDate}
            view={effectiveView}
            range={cal.range}
            onRangeChange={cal.handleRangeChange}
            onViewChange={handleViewSelect}
            onVisitClick={handleVisitClick}
            onMeetingClick={setOpenMeetingId}
            onTaskClick={setOpenTask}
            selectedEventId={openVisitId ?? openMeetingId ?? openTask?.id ?? null}
          />
        )}
      </MainPageContent>

      <MeetingSheet
        meetingId={openMeetingId}
        open={openMeetingId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenMeetingId(null)
        }}
      />

      {overlays}

      <TaskDialog
        open={openTask !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTask(null)
        }}
        mode='edit'
        // `task.list`'s row (via `RouterOutputs`) is structurally `TaskWithRelations` — the
        // dialog's server-side type, not importable client-side by value, only by type.
        task={(openTask ?? undefined) as TaskWithRelations | undefined}
      />
    </MainPage>
  )
}
