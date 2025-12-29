// apps/web/src/app/(protected)/app/tickets/_components/ticket-provider.tsx
'use client'
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { TicketStatus, TicketPriority } from '@auxx/database/enums'
export interface Ticket {
  id: string
  number: string
  title: string
  description?: string | null
  contact: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  }
  type: string
  status: string
  priority: string
  dueDate?: string | null
  assignments: {
    id: string
    agent: {
      id: string
      name: string | null
      email: string
    }
  }[]
  updatedAt: string
  createdAt: string
}
export interface TicketFilterState {
  status?: string
  type?: string
  priority?: string
  assignee?: string
  search?: string
}
interface TicketProviderState {
  tickets: Ticket[]
  isTicketsLoading: boolean
  ticketFilter: TicketFilterState
  setTicketFilter: (filter: TicketFilterState) => void
  deleteTicket: (id: string) => Promise<void>
  updateTicketStatus: (id: string, status: TicketStatus) => Promise<void>
  updateTicketPriority: (id: string, priority: TicketPriority) => Promise<void>
  updateTicketAssignments: (id: string, agentIds: string[]) => Promise<void>
  refetch: () => void
  refetchTickets: () => void
  totalTickets: number
  createDialogOpen: boolean
  setCreateDialogOpen: (open: boolean) => void
  hasNextPage?: boolean
  fetchNextPage?: () => void
  isFetchingNextPage?: boolean
}
const TicketContext = createContext<TicketProviderState | undefined>(undefined)
export function useTicketProvider() {
  const context = useContext(TicketContext)
  if (!context) {
    throw new Error('useTicketProvider must be used within TicketProvider')
  }
  return context
}
interface TicketProviderProps {
  children: React.ReactNode
}
export function TicketProvider({ children }: TicketProviderProps) {
  const router = useRouter()
  // URL state management
  const [statusFilter, setStatusFilter] = useQueryState('status', parseAsString.withDefault(''))
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault(''))
  const [priorityFilter, setPriorityFilter] = useQueryState(
    'priority',
    parseAsString.withDefault('')
  )
  const [assigneeFilter, setAssigneeFilter] = useQueryState(
    'assignee',
    parseAsString.withDefault('')
  )
  const [searchQuery, setSearchQuery] = useQueryState('q', parseAsString.withDefault(''))
  const [createDialogOpen, setCreateDialogOpen] = useQueryState(
    'create',
    parseAsBoolean.withDefault(false)
  )
  // Combine filters into state
  const ticketFilter = useMemo<TicketFilterState>(
    () => ({
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      priority: priorityFilter || undefined,
      assignee: assigneeFilter || undefined,
      search: searchQuery || undefined,
    }),
    [statusFilter, typeFilter, priorityFilter, assigneeFilter, searchQuery]
  )
  // Set filter with URL update
  const setTicketFilter = useCallback(
    (filter: TicketFilterState) => {
      setStatusFilter(filter.status || null)
      setTypeFilter(filter.type || null)
      setPriorityFilter(filter.priority || null)
      setAssigneeFilter(filter.assignee || null)
      setSearchQuery(filter.search || null)
    },
    [setStatusFilter, setTypeFilter, setPriorityFilter, setAssigneeFilter, setSearchQuery]
  )
  // Fetch tickets with filters
  const {
    data: ticketsData,
    isLoading: isTicketsLoading,
    refetch: refetchTickets,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = api.ticket.list.useInfiniteQuery(
    {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      priority: priorityFilter || undefined,
      assignee: assigneeFilter || undefined,
      search: searchQuery || undefined,
      limit: 50,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  )
  // Flatten tickets from pages
  const tickets = useMemo(
    () => ticketsData?.pages.flatMap((page) => page.tickets) || [],
    [ticketsData]
  )
  // Total count (estimate based on pagination)
  const totalTickets = tickets.length
  // Delete ticket mutation
  const deleteTicketMutation = api.ticket.deleteTicket.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Ticket deleted',
        description: 'The ticket has been deleted successfully.',
      })
      refetchTickets()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete ticket',
        description: error.message,
      })
    },
  })
  // Update status mutation
  const updateStatusMutation = api.ticket.updateStatus.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Status updated',
        description: 'Ticket status has been updated successfully.',
      })
      refetchTickets()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update status',
        description: error.message,
      })
    },
  })
  // Update priority mutation
  const updatePriorityMutation = api.ticket.updatePriority.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Priority updated',
        description: 'Ticket priority has been updated successfully.',
      })
      refetchTickets()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update priority',
        description: error.message,
      })
    },
  })
  // Update assignments mutation
  const updateAssignmentsMutation = api.ticket.updateAssignment.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Assignments updated',
        description: 'Ticket assignments have been updated successfully.',
      })
      refetchTickets()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update assignments',
        description: error.message,
      })
    },
  })
  // Provider methods
  const deleteTicket = useCallback(
    async (id: string) => {
      await deleteTicketMutation.mutateAsync({ ticketId: id })
    },
    [deleteTicketMutation]
  )
  const updateTicketStatus = useCallback(
    async (id: string, status: TicketStatus) => {
      await updateStatusMutation.mutateAsync({ id, status })
    },
    [updateStatusMutation]
  )
  const updateTicketPriority = useCallback(
    async (id: string, priority: TicketPriority) => {
      await updatePriorityMutation.mutateAsync({ id, priority })
    },
    [updatePriorityMutation]
  )
  const updateTicketAssignments = useCallback(
    async (id: string, agentIds: string[]) => {
      await updateAssignmentsMutation.mutateAsync({ ticketId: id, agentIds })
    },
    [updateAssignmentsMutation]
  )
  const value = useMemo<TicketProviderState>(
    () => ({
      tickets,
      isTicketsLoading,
      ticketFilter,
      setTicketFilter,
      deleteTicket,
      updateTicketStatus,
      updateTicketPriority,
      updateTicketAssignments,
      refetch: refetchTickets,
      refetchTickets,
      totalTickets,
      createDialogOpen: createDialogOpen || false,
      setCreateDialogOpen,
      hasNextPage,
      fetchNextPage,
      isFetchingNextPage,
    }),
    [
      tickets,
      isTicketsLoading,
      ticketFilter,
      setTicketFilter,
      deleteTicket,
      updateTicketStatus,
      updateTicketPriority,
      updateTicketAssignments,
      refetchTickets,
      totalTickets,
      createDialogOpen,
      setCreateDialogOpen,
      hasNextPage,
      fetchNextPage,
      isFetchingNextPage,
    ]
  )
  return <TicketContext.Provider value={value}>{children}</TicketContext.Provider>
}
