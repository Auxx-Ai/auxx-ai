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
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, List } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { LoadingContent } from '~/components/global/loading-content'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useIsMobile } from '~/hooks/use-mobile'
import { useDockStore } from '~/stores/dock-store'
import { useMySchedule } from '../hooks/use-my-schedule'
import { MeetingSheet } from './meeting-sheet'
import { ScheduleList, type ScheduleListHandle } from './schedule-list'
import { VisitDrawer } from './visit-drawer'

export function SchedulePage() {
  const { groups, todayIndex, isLoading } = useMySchedule()
  const listRef = useRef<ScheduleListHandle>(null)
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null)
  const [openVisitId, setOpenVisitId] = useState<string | null>(null)
  const router = useRouter()
  const isMobile = useIsMobile()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

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

  // Standard docked-panel wiring (`files/page.tsx` pattern): when docked, the drawer renders
  // inside MainPageContent's panel frame; when not, it mounts below as the overlay drawer.
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isDocked || !openVisitId) return []
    return [
      {
        key: 'visit-detail',
        content: (
          <VisitDrawer visitId={openVisitId} open onOpenChange={handleVisitDrawerOpenChange} />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth: 400,
        maxWidth: 800,
      },
    ]
  }, [isDocked, openVisitId, handleVisitDrawerOpenChange, dockedWidth, setDockedWidth])

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

      <MainPageContent dockedPanels={dockedPanels}>
        <LoadingContent loading={isLoading}>
          <ScheduleList
            ref={listRef}
            groups={groups}
            todayIndex={todayIndex}
            onVisitClick={handleVisitClick}
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

      {!isDocked && (
        <VisitDrawer
          visitId={openVisitId}
          open={openVisitId !== null}
          onOpenChange={handleVisitDrawerOpenChange}
        />
      )}
    </MainPage>
  )
}
