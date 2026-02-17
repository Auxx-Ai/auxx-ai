// packages/lib/src/tickets/ticket-merge.ts

import { TRPCError } from '@trpc/server'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../resources/resource-id'

/**
 * Service for merging multiple tickets into a single primary ticket.
 * Delegates to UnifiedCrudHandler.merge() which handles EntityInstance merging.
 */
export const ticketMergeService = {
  /**
   * Merge multiple tickets into one primary ticket
   *
   * @param primaryTicketId - The ID of the ticket that will remain after merging
   * @param ticketsToMergeIds - Array of ticket IDs that will be merged into the primary ticket
   * @param userId - ID of the user performing the merge
   * @param organizationId - Organization ID (required for UnifiedCrudHandler)
   * @returns The updated primary ticket instance
   */
  async mergeTickets(
    primaryTicketId: string,
    ticketsToMergeIds: string[],
    userId: string,
    organizationId?: string
  ) {
    // Validate inputs
    if (!primaryTicketId || !ticketsToMergeIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Primary ticket ID and at least one ticket to merge are required',
      })
    }

    // Ensure primary ticket is not in the tickets to merge
    if (ticketsToMergeIds.includes(primaryTicketId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Primary ticket cannot be merged into itself',
      })
    }

    if (!organizationId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'organizationId is required for ticket merge',
      })
    }

    const handler = new UnifiedCrudHandler(organizationId, userId)

    const targetRecordId = toRecordId('ticket', primaryTicketId) as RecordId
    const sourceRecordIds = ticketsToMergeIds.map((id) => toRecordId('ticket', id) as RecordId)

    await handler.merge(targetRecordId, sourceRecordIds)

    // Return the merged primary ticket
    return handler.getById(targetRecordId)
  },
}
