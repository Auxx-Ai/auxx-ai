// apps/web/src/app/(protected)/app/tickets/_components/use-ticket-mutations.tsx

'use client'

import type { TicketPriority, TicketStatus } from '@auxx/database/enums'
import { toastError } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'
import { api } from '~/trpc/react'

interface UseTicketMutationsOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Centralized hook for ticket mutations with record store invalidation
 */
export function useTicketMutations(options?: UseTicketMutationsOptions) {
  const utils = api.useUtils()
  const { onRecordUpdated, onRecordDeleted, onBulkUpdated, onBulkDeleted, onRecordCreated } =
    useRecordInvalidation()

  // Delete ticket
  const deleteTicket = api.ticket.deleteTicket.useMutation({
    onSuccess: (_, { ticketId }) => {
      onRecordDeleted('ticket', ticketId)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete ticket', description: error.message })
      options?.onError?.(error)
    },
  })

  // Bulk delete tickets
  const bulkDeleteTickets = api.ticket.deleteMultipleTickets.useMutation({
    onSuccess: (_, { ticketIds }) => {
      onBulkDeleted('ticket', ticketIds)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete tickets', description: error.message })
      options?.onError?.(error)
    },
  })

  // Update status
  const updateTicketStatus = api.ticket.updateStatus.useMutation({
    onSuccess: (_, { id }) => {
      onRecordUpdated('ticket', id)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update status', description: error.message })
      options?.onError?.(error)
    },
  })

  // Bulk update status
  const bulkUpdateStatus = api.ticket.updateMultipleStatus.useMutation({
    onSuccess: (_, { ticketIds }) => {
      onBulkUpdated('ticket', ticketIds)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update statuses', description: error.message })
      options?.onError?.(error)
    },
  })

  // Update priority
  const updateTicketPriority = api.ticket.updatePriority.useMutation({
    onSuccess: (_, { id }) => {
      onRecordUpdated('ticket', id)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update priority', description: error.message })
      options?.onError?.(error)
    },
  })

  // Bulk update priority
  const bulkUpdatePriority = api.ticket.updateMultiplePriority.useMutation({
    onSuccess: (_, { ticketIds }) => {
      onBulkUpdated('ticket', ticketIds)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update priorities', description: error.message })
      options?.onError?.(error)
    },
  })

  // Update assignments
  const updateTicketAssignments = api.ticket.updateAssignment.useMutation({
    onSuccess: (_, { ticketId }) => {
      onRecordUpdated('ticket', ticketId)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update assignments', description: error.message })
      options?.onError?.(error)
    },
  })

  // Bulk update assignments
  const bulkUpdateAssignments = api.ticket.updateMultipleAssignments.useMutation({
    onSuccess: (_, { ticketIds }) => {
      onBulkUpdated('ticket', ticketIds)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update assignments', description: error.message })
      options?.onError?.(error)
    },
  })

  // Update ticket (general)
  const updateTicket = api.ticket.update.useMutation({
    onSuccess: (_, { id }) => {
      onRecordUpdated('ticket', id)
      utils.ticket.list.invalidate()
      utils.ticket.byId.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update ticket', description: error.message })
      options?.onError?.(error)
    },
  })

  // Create ticket
  const createTicket = api.ticket.create.useMutation({
    onSuccess: () => {
      onRecordCreated('ticket')
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to create ticket', description: error.message })
      options?.onError?.(error)
    },
  })

  // Merge tickets
  const mergeTickets = api.ticket.mergeTickets.useMutation({
    onSuccess: (_, { primaryTicketId, ticketIdsToMerge }) => {
      // Merged tickets are deleted, primary is updated
      onBulkDeleted('ticket', ticketIdsToMerge)
      onRecordUpdated('ticket', primaryTicketId)
      utils.ticket.list.invalidate()
      options?.onSuccess?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to merge tickets', description: error.message })
      options?.onError?.(error)
    },
  })

  return {
    // Single mutations
    deleteTicket,
    updateTicketStatus,
    updateTicketPriority,
    updateTicketAssignments,
    updateTicket,
    createTicket,
    mergeTickets,
    // Bulk mutations
    bulkDeleteTickets,
    bulkUpdateStatus,
    bulkUpdatePriority,
    bulkUpdateAssignments,
    // Loading state
    isLoading:
      deleteTicket.isPending ||
      updateTicketStatus.isPending ||
      updateTicketPriority.isPending ||
      updateTicketAssignments.isPending ||
      updateTicket.isPending ||
      createTicket.isPending ||
      mergeTickets.isPending ||
      bulkDeleteTickets.isPending ||
      bulkUpdateStatus.isPending ||
      bulkUpdatePriority.isPending ||
      bulkUpdateAssignments.isPending,
  }
}
