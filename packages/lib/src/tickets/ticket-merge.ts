// src/server/services/ticketMergeService.ts
// import { db } from '@/server/db'

import { database as db, schema, type Transaction } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Service for merging multiple tickets into a single primary ticket
 */
export const ticketMergeService = {
  /**
   * Merge multiple tickets into one primary ticket
   *
   * @param primaryTicketId - The ID of the ticket that will remain after merging
   * @param ticketsToMergeIds - Array of ticket IDs that will be merged into the primary ticket
   * @param userId - ID of the organization performing the merge
   * @returns The updated primary ticket
   */
  async mergeTickets(primaryTicketId: string, ticketsToMergeIds: string[], userId: string) {
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

    // Fetch all tickets involved in merge
    const ticketIds = [primaryTicketId, ...ticketsToMergeIds]
    const tickets = await db
      .select()
      .from(schema.Ticket)
      .where(inArray(schema.Ticket.id, ticketIds))

    // Verify all tickets exist
    if (tickets.length !== ticketIds.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more tickets could not be found' })
    }

    // Verify all tickets belong to the same organization
    const primaryTicket = tickets.find((t) => t.id === primaryTicketId)
    if (!primaryTicket) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Primary ticket not found' })
    }

    const organizationId = primaryTicket.organizationId
    const allSameOrg = tickets.every((t) => t.organizationId === organizationId)
    if (!allSameOrg) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot merge tickets from different organizations',
      })
    }

    // Begin transaction
    return await db.transaction(async (tx: Transaction) => {
      // Transfer data from merged tickets to primary ticket
      for (const ticket of tickets) {
        if (ticket.id !== primaryTicketId) {
          // Add agents from merged tickets to primary (if they're not already assigned)
          const assignments = await tx
            .select()
            .from(schema.TicketAssignment)
            .where(
              and(
                eq(schema.TicketAssignment.ticketId, ticket.id),
                eq(schema.TicketAssignment.isActive, true as any)
              )
            )
          for (const assignment of assignments) {
            // Check if agent is already assigned to primary ticket
            const [existingAssignment] = await tx
              .select({ id: schema.TicketAssignment.id })
              .from(schema.TicketAssignment)
              .where(
                and(
                  eq(schema.TicketAssignment.ticketId, primaryTicketId),
                  eq(schema.TicketAssignment.agentId, assignment.agentId),
                  eq(schema.TicketAssignment.isActive, true as any)
                )
              )
              .limit(1)

            if (!existingAssignment) {
              await tx.insert(schema.TicketAssignment).values({
                ticketId: primaryTicketId,
                agentId: assignment.agentId,
                isActive: true as any,
                updatedAt: new Date(),
              })
            }
          }

          // Update any child tickets to point to the primary ticket instead
          await tx
            .update(schema.Ticket)
            .set({ parentTicketId: primaryTicketId, updatedAt: new Date() })
            .where(eq(schema.Ticket.parentTicketId, ticket.id))

          // Update merged tickets to be children of the primary ticket and update their status
          await tx
            .update(schema.Ticket)
            .set({
              parentTicketId: primaryTicketId,
              status: 'MERGED',
              updatedAt: new Date(),
            })
            .where(eq(schema.Ticket.id, ticket.id))
        }
      }

      // Return the updated primary ticket
      const [primary] = await tx
        .select()
        .from(schema.Ticket)
        .where(eq(schema.Ticket.id, primaryTicketId))
        .limit(1)

      const assignRows = await tx
        .select({
          id: schema.TicketAssignment.id,
          ticketId: schema.TicketAssignment.ticketId,
          agentId: schema.TicketAssignment.agentId,
          isActive: schema.TicketAssignment.isActive,
        })
        .from(schema.TicketAssignment)
        .where(
          and(
            eq(schema.TicketAssignment.ticketId, primaryTicketId),
            eq(schema.TicketAssignment.isActive, true as any)
          )
        )

      const childTickets = await tx
        .select()
        .from(schema.Ticket)
        .where(eq(schema.Ticket.parentTicketId, primaryTicketId))

      return {
        ...primary,
        assignments: assignRows.map((a) => ({ ...a })),
        childTickets,
      } as any
    })
  },
}
