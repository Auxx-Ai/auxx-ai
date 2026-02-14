// packages/lib/src/tickets/ticket-mutations.ts

import { type Database, schema } from '@auxx/database'
import {
  TicketPriority as TicketPriorityEnum,
  TicketStatus as TicketStatusEnum,
} from '@auxx/database/enums'
import type { TicketPriority, TicketStatus } from '@auxx/database/types'
import { publisher } from '@auxx/lib/events'
import { TRPCError } from '@trpc/server'
import { eq, inArray, or } from 'drizzle-orm'

/**
 * Input for updating multiple tickets' status
 */
export interface UpdateMultipleStatusInput {
  ticketIds: string[]
  status: TicketStatus
  organizationId: string
  userId: string
}

/**
 * Input for updating multiple tickets' priority
 */
export interface UpdateMultiplePriorityInput {
  ticketIds: string[]
  priority: TicketPriority
  organizationId: string
  userId: string
}

/**
 * Input for updating multiple tickets' assignments
 */
export interface UpdateMultipleAssignmentsInput {
  ticketIds: string[]
  agentIds: string[]
  organizationId: string
  userId: string
}

/**
 * Input for deleting multiple tickets
 */
export interface DeleteMultipleTicketsInput {
  ticketIds: string[]
  organizationId: string
  userId: string
}

/**
 * Update multiple tickets' status
 */
export async function updateMultipleStatus(
  db: Database,
  input: UpdateMultipleStatusInput
): Promise<void> {
  const { ticketIds, status, organizationId, userId } = input

  // Check if all tickets exist and belong to the organization
  const tickets = await db.query.Ticket.findMany({
    where: (ticket, { and, eq, inArray }) =>
      and(inArray(ticket.id, ticketIds), eq(ticket.organizationId, organizationId)),
  })

  if (tickets.length !== ticketIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  // Update in batches using a transaction
  await db.transaction(async (tx) => {
    await Promise.all(
      tickets.map(async (ticket) => {
        const updatedData: Partial<typeof schema.Ticket.$inferInsert> = {
          status,
          updatedAt: new Date(),
        }

        // Add timestamps for resolved or closed statuses
        if (status === TicketStatusEnum.RESOLVED && !ticket.resolvedAt) {
          ;(updatedData as any).resolvedAt = new Date()
        }

        if (status === TicketStatusEnum.CLOSED && !ticket.closedAt) {
          ;(updatedData as any).closedAt = new Date()
        }

        // If reopening a ticket, clear resolved/closed timestamps
        if (
          (ticket.status === TicketStatusEnum.RESOLVED ||
            ticket.status === TicketStatusEnum.CLOSED) &&
          (status === TicketStatusEnum.OPEN || status === TicketStatusEnum.IN_PROGRESS)
        ) {
          ;(updatedData as any).resolvedAt = null
          ;(updatedData as any).closedAt = null
        }

        // Update the ticket
        await tx
          .update(schema.Ticket)
          .set(updatedData as any)
          .where(eq(schema.Ticket.id, ticket.id))
      })
    )
  })

  await Promise.all(
    tickets.map(async (ticket) => {
      await publisher.publishLater({
        type: 'ticket:updated',
        data: { organizationId, ticketId: ticket.id, userId },
      })
    })
  )
}

/**
 * Update multiple tickets' priority
 */
export async function updateMultiplePriority(
  db: Database,
  input: UpdateMultiplePriorityInput
): Promise<void> {
  const { ticketIds, priority, organizationId, userId } = input

  // Check if all tickets exist and belong to the organization
  const tickets = await db.query.Ticket.findMany({
    where: (ticket, { and, eq, inArray }) =>
      and(inArray(ticket.id, ticketIds), eq(ticket.organizationId, organizationId)),
  })

  if (tickets.length !== ticketIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  // Update in batches using a transaction
  await db.transaction(async (tx) => {
    await Promise.all(
      ticketIds.map(async (id) => {
        await tx
          .update(schema.Ticket)
          .set({ priority, updatedAt: new Date() })
          .where(eq(schema.Ticket.id, id))
      })
    )
  })

  await Promise.all(
    tickets.map(async (ticket) => {
      await publisher.publishLater({
        type: 'ticket:updated',
        data: { organizationId, ticketId: ticket.id, userId },
      })
    })
  )
}

/**
 * Update multiple tickets' assignments
 */
export async function updateMultipleAssignments(
  db: Database,
  input: UpdateMultipleAssignmentsInput
): Promise<void> {
  const { ticketIds, agentIds, organizationId, userId } = input

  // Check if all tickets exist and belong to the organization
  const tickets = await db.query.Ticket.findMany({
    where: (ticket, { and, eq, inArray }) =>
      and(inArray(ticket.id, ticketIds), eq(ticket.organizationId, organizationId)),
  })

  if (tickets.length !== ticketIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  // Use a transaction to update all assignments
  await db.transaction(async (tx) => {
    await Promise.all(
      ticketIds.map(async (ticketId) => {
        // Get current assignments for this ticket
        const currentAssignments = await tx
          .select({
            id: schema.TicketAssignment.id,
            agentId: schema.TicketAssignment.agentId,
          })
          .from(schema.TicketAssignment)
          .where(eq(schema.TicketAssignment.ticketId, ticketId))

        // Determine which assignments to add and which to remove
        const currentAgentIds = currentAssignments.map((a) => a.agentId)
        const agentIdsToAdd = agentIds.filter((id) => !currentAgentIds.includes(id))
        const assignmentsToRemove = currentAssignments.filter((a) => !agentIds.includes(a.agentId))

        // Remove assignments that are no longer needed
        if (assignmentsToRemove.length > 0) {
          await tx.delete(schema.TicketAssignment).where(
            inArray(
              schema.TicketAssignment.id,
              assignmentsToRemove.map((a) => a.id)
            )
          )
        }

        // Add new assignments
        if (agentIdsToAdd.length > 0) {
          await tx
            .insert(schema.TicketAssignment)
            .values(agentIdsToAdd.map((agentId) => ({ ticketId, agentId, updatedAt: new Date() })))
        }

        // Mark ticket as updated
        await tx
          .update(schema.Ticket)
          .set({ updatedAt: new Date() })
          .where(eq(schema.Ticket.id, ticketId))
      })
    )
  })
}

/**
 * Delete multiple tickets and all related data
 */
export async function deleteMultipleTickets(
  db: Database,
  input: DeleteMultipleTicketsInput
): Promise<{ success: boolean; count: number }> {
  const { ticketIds, organizationId, userId } = input

  // Check if all tickets exist and belong to the organization
  const tickets = await db.query.Ticket.findMany({
    where: (ticket, { and, eq, inArray }) =>
      and(inArray(ticket.id, ticketIds), eq(ticket.organizationId, organizationId)),
  })

  if (tickets.length !== ticketIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'One or more tickets not found or do not belong to your organization',
    })
  }

  // Use a transaction to delete tickets and all related data
  await db.transaction(async (tx) => {
    for (const ticketId of ticketIds) {
      // Delete ticket replies
      await tx.delete(schema.TicketReply).where(eq(schema.TicketReply.ticketId, ticketId))

      // Delete ticket assignments
      await tx.delete(schema.TicketAssignment).where(eq(schema.TicketAssignment.ticketId, ticketId))

      // Delete related ticket relationships
      await tx
        .delete(schema.TicketRelation)
        .where(
          or(
            eq(schema.TicketRelation.ticketId, ticketId),
            eq(schema.TicketRelation.relatedTicketId, ticketId)
          )
        )

      // Finally, delete the ticket itself
      await tx.delete(schema.Ticket).where(eq(schema.Ticket.id, ticketId))
    }
  })

  await Promise.all(
    tickets.map(async (ticket) => {
      await publisher.publishLater({
        type: 'ticket:deleted',
        data: { organizationId, ticketId: ticket.id, userId },
      })
    })
  )

  return { success: true, count: tickets.length }
}
