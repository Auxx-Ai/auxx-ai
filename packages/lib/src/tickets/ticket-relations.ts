// packages/lib/src/tickets/ticket-relations.ts

import { type Database, schema } from '@auxx/database'
import { publisher } from '@auxx/lib/events'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'

/**
 * Input for adding a relation between tickets
 */
export interface AddRelationInput {
  ticketId: string
  relatedTicketId: string
  relation: string
  organizationId: string
  userId: string
}

/**
 * Input for removing a relation between tickets
 */
export interface RemoveRelationInput {
  relationId: string
  organizationId: string
  userId: string
}

/**
 * Add a relation between tickets with bidirectional support
 */
export async function addRelation(
  db: Database,
  input: AddRelationInput
): Promise<{ id: string; ticketId: string; relatedTicketId: string; relation: string }> {
  const { ticketId, relatedTicketId, relation, organizationId, userId } = input

  // Check if both tickets exist and belong to the organization
  const ticket = await db.query.Ticket.findFirst({
    columns: { id: true, organizationId: true },
    where: (t, { eq }) => eq(t.id, ticketId),
  })

  const relatedTicket = await db.query.Ticket.findFirst({
    columns: { id: true, organizationId: true },
    where: (t, { eq }) => eq(t.id, relatedTicketId),
  })

  if (!ticket || !relatedTicket) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'One or both tickets not found' })
  }

  // Check if the tickets belong to the same organization
  if (ticket.organizationId !== relatedTicket.organizationId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Cannot relate tickets from different organizations',
    })
  }

  // Check if the user has permission
  const isMember = await db.query.OrganizationMember.findFirst({
    where: (om, { and, eq }) =>
      and(eq(om.userId, userId), eq(om.organizationId, ticket.organizationId)),
  })

  if (!isMember) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "You don't have permission to relate these tickets",
    })
  }

  // Prevent relating a ticket to itself
  if (ticketId === relatedTicketId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot relate a ticket to itself' })
  }

  // Check if this relation already exists
  const existingRelation = await db.query.TicketRelation.findFirst({
    where: (tr, { and, eq }) =>
      and(eq(tr.ticketId, ticketId), eq(tr.relatedTicketId, relatedTicketId)),
  })

  if (existingRelation) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'These tickets are already related' })
  }

  // Create the relation in a transaction
  const result = await db.transaction(async (tx) => {
    // Create the primary relation
    const [createRelation] = await tx
      .insert(schema.TicketRelation)
      .values({
        ticketId,
        relatedTicketId,
        relation,
      })
      .returning()

    // Handle bidirectional and inverse relations
    if (relation === 'RELATED') {
      // Bidirectional relation
      await tx.insert(schema.TicketRelation).values({
        ticketId: relatedTicketId,
        relatedTicketId: ticketId,
        relation,
      })
    } else if (relation === 'DUPLICATE_OF') {
      // Update the duplicate ticket status to CLOSED
      await tx
        .update(schema.Ticket)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(eq(schema.Ticket.id, ticketId))
    } else if (relation === 'PARENT_OF') {
      // Create the inverse relation
      await tx.insert(schema.TicketRelation).values({
        ticketId: relatedTicketId,
        relatedTicketId: ticketId,
        relation: 'CHILD_OF',
      })
    } else if (relation === 'CHILD_OF') {
      // Create the inverse relation
      await tx.insert(schema.TicketRelation).values({
        ticketId: relatedTicketId,
        relatedTicketId: ticketId,
        relation: 'PARENT_OF',
      })
    } else if (relation === 'BLOCKED_BY') {
      // Create the inverse relation
      await tx.insert(schema.TicketRelation).values({
        ticketId: relatedTicketId,
        relatedTicketId: ticketId,
        relation: 'BLOCKS',
      })
    } else if (relation === 'BLOCKS') {
      // Create the inverse relation
      await tx.insert(schema.TicketRelation).values({
        ticketId: relatedTicketId,
        relatedTicketId: ticketId,
        relation: 'BLOCKED_BY',
      })
    }

    return createRelation!
  })

  // Publish event
  await publisher.publishLater({
    type: 'ticket:updated',
    data: { organizationId, ticketId, userId },
  })

  return result
}

/**
 * Remove a relation between tickets and handle inverse relations
 */
export async function removeRelation(
  db: Database,
  input: RemoveRelationInput
): Promise<{ success: true }> {
  const { relationId, organizationId, userId } = input

  // Find the relation with ticket organization info
  const relation = await db.query.TicketRelation.findFirst({
    where: (tr, { eq }) => eq(tr.id, relationId),
    with: {
      ticket: {
        columns: { organizationId: true },
      },
    },
  })

  if (!relation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Relation not found' })
  }

  // Check if the user has permission
  const isMember = await db.query.OrganizationMember.findFirst({
    where: (om, { and, eq }) =>
      and(eq(om.userId, userId), eq(om.organizationId, relation.ticket.organizationId)),
  })

  if (!isMember) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "You don't have permission to remove this relation",
    })
  }

  // Delete the relation and its inverse in a transaction
  await db.transaction(async (tx) => {
    // Determine the inverse relation type
    let inverseRelation = relation.relation

    if (relation.relation === 'PARENT_OF') {
      inverseRelation = 'CHILD_OF'
    } else if (relation.relation === 'CHILD_OF') {
      inverseRelation = 'PARENT_OF'
    } else if (relation.relation === 'BLOCKED_BY') {
      inverseRelation = 'BLOCKS'
    } else if (relation.relation === 'BLOCKS') {
      inverseRelation = 'BLOCKED_BY'
    }

    // For bidirectional relations, find and delete the inverse relation
    if (
      relation.relation === 'RELATED' ||
      relation.relation === 'PARENT_OF' ||
      relation.relation === 'CHILD_OF' ||
      relation.relation === 'BLOCKED_BY' ||
      relation.relation === 'BLOCKS'
    ) {
      await tx
        .delete(schema.TicketRelation)
        .where(
          and(
            eq(schema.TicketRelation.ticketId, relation.relatedTicketId),
            eq(schema.TicketRelation.relatedTicketId, relation.ticketId),
            eq(schema.TicketRelation.relation, inverseRelation)
          )
        )
    }

    // Delete the primary relation
    await tx.delete(schema.TicketRelation).where(eq(schema.TicketRelation.id, relationId))
  })

  return { success: true }
}
