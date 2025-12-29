// app/tickets/page.tsx
'use client'
import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useInView } from 'react-intersection-observer'
import { Toggle } from '@auxx/ui/components/toggle'

import { Card, CardContent } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { ArrowLeft, Filter, PlusIcon } from 'lucide-react'

import TicketForm from './new-ticket-form'
import { api } from '~/trpc/react'
import { Separator } from '@auxx/ui/components/separator'
import { Tooltip } from '~/components/global/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { TicketFilters } from './ticket-filters'
// import { TicketTable } from './ticket-table'
import type { RowSelectionState } from '@tanstack/react-table'
import { TicketTable } from './tickets-table'
import { MassAssignDialog } from './dialog-mass-assign'
import { MassStatusDialog } from './dialog-mass-status'
import { MassPriorityDialog } from './dialog-mass-priority'
import { MassDeleteDialog } from './dialog-mass-deleting'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

export default function TicketsList() {
  const router = useRouter()
  // Use nuqs for create dialog open state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useQueryState(
    'create',
    parseAsBoolean.withDefault(false)
  )
  const loadMoreRef = useRef<HTMLTableRowElement>(null)

  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [showMassActions, setShowMassActions] = useState(false)
  const [previousCursors, setPreviousCursors] = useState<string[]>([])

  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false)
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false)
  const [isPriorityDialogOpen, setIsPriorityDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const [showFilter, setShowFilter] = useQueryState('filter', parseAsBoolean.withDefault(false))

  const [height, setHeight] = useState(118)

  // Use nuqs for all URL parameters
  const [cursor, setCursor] = useQueryState('cursor', parseAsString.withDefault(''))
  const [statusFilter] = useQueryState('status', parseAsString.withDefault(''))
  const [typeFilter] = useQueryState('type', parseAsString.withDefault(''))
  const [priorityFilter] = useQueryState('priority', parseAsString.withDefault(''))
  const [assigneeFilter] = useQueryState('assignee', parseAsString.withDefault(''))
  const [searchQuery] = useQueryState('q', parseAsString.withDefault(''))

  // Add cursor to history when it changes
  useEffect(() => {
    if (cursor) {
      setPreviousCursors((prev) => {
        // Only add the cursor if it's not already the last item
        if (prev[prev.length - 1] !== cursor) {
          return [...prev, cursor]
        }
        return prev
      })
    } else {
      // Reset cursor history when going back to first page
      setPreviousCursors([])
    }
  }, [cursor])

  // Fetch tickets with filters
  const {
    data: ticketsData,
    isLoading,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = api.ticket.list.useInfiniteQuery(
    {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      priority: priorityFilter || undefined,
      assignee: assigneeFilter || undefined,
      search: searchQuery || undefined,
      limit: 20,
    },
    { getNextPageParam: (lastPage) => lastPage.nextCursor, placeholderData: keepPreviousData }
  )

  // Infinite scroll using IntersectionObserver
  const { ref, inView } = useInView()

  useEffect(() => {
    const height = showFilter ? 195 : 118
    setHeight(height)
  }, [showFilter])

  // Handle row selection changes
  const handleRowSelectionChange = (selection: string[]) => {
    // console.log(selection)
    setSelectedRows(selection)
    setShowMassActions(Object.keys(selection).length > 0)
  }

  // Load more when scrolling to the bottom
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Flatten the pages data
  const tickets = ticketsData?.pages.flatMap((page) => page.tickets) || []

  // Get count of selected tickets
  const selectedCount = Object.keys(selectedRows).length

  return (
    <>
      <MainPage>
        <MainPageHeader
          action={
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="info" size="sm" className="px-2">
                  <PlusIcon className="h-4 w-4" />
                  New Ticket
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-screen max-w-3xl overflow-y-scroll">
                <DialogHeader className="mb-4">
                  <DialogTitle>Create New Support Ticket</DialogTitle>
                  <DialogDescription>
                    Fill out the form below to create a new support ticket.
                  </DialogDescription>
                </DialogHeader>
                <TicketForm
                  onSuccess={() => {
                    refetch()
                    setIsCreateDialogOpen(false)
                  }}
                />
              </DialogContent>
            </Dialog>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Support Tickets" href="/app/tickets/list" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className="">
            <div className="bg-slate-50 p-2 dark:bg-black rounded-t-lg border-b">
              <div className="flex items-center gap-2">
                <Tooltip content="Go Back">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.back()}
                    className="px-2">
                    <ArrowLeft />
                  </Button>
                </Tooltip>
                <Toggle
                  className="data-[state=on]:border-ring"
                  aria-label="Filter tickets"
                  pressed={showFilter}
                  onPressedChange={setShowFilter}>
                  <Filter size={16} aria-hidden="true" />
                </Toggle>
              </div>

              {/* Mass actions bar */}
              {showMassActions && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {selectedCount} {selectedCount === 1 ? 'ticket' : 'tickets'} selected
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setIsAssignDialogOpen(true)}>
                    Assign
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setIsStatusDialogOpen(true)}>
                    Change Status
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setIsPriorityDialogOpen(true)}>
                    Change Priority
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => setIsDeleteDialogOpen(true)}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
            {showFilter && <TicketFilters />}
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-muted/10 rounded-b-lg">
            <TicketTable
              tickets={tickets}
              isLoading={isLoading}
              isFetchingNextPage={isFetchingNextPage}
              onRowSelectionChange={handleRowSelectionChange}
              loadMoreRef={loadMoreRef}
            />
            {/* Hidden element for IntersectionObserver */}
            <div ref={ref} className=" w-full" />
          </div>
        </MainPageContent>
      </MainPage>
      {/* Mass action dialogs */}
      <MassAssignDialog
        open={isAssignDialogOpen}
        onOpenChange={setIsAssignDialogOpen}
        ticketIds={selectedRows}
        onSuccess={() => {
          refetch()
          setSelectedRows([])
          setShowMassActions(false)
        }}
      />

      <MassStatusDialog
        open={isStatusDialogOpen}
        onOpenChange={setIsStatusDialogOpen}
        ticketIds={selectedRows}
        onSuccess={() => {
          refetch()
          setSelectedRows([])
          setShowMassActions(false)
        }}
      />

      <MassPriorityDialog
        open={isPriorityDialogOpen}
        onOpenChange={setIsPriorityDialogOpen}
        ticketIds={selectedRows}
        onSuccess={() => {
          refetch()
          setSelectedRows({})
          setShowMassActions(false)
        }}
      />

      <MassDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        ticketIds={selectedRows}
        onSuccess={() => {
          refetch()
          setSelectedRows([])
          setShowMassActions(false)
        }}
      />
    </>
  )
}
