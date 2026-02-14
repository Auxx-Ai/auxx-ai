// packages/lib/src/tickets/ticket-service.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import {
  TicketPriority as TicketPriorityEnum,
  TicketStatus as TicketStatusEnum,
} from '@auxx/database/enums'
import type { TicketEntity as Ticket } from '@auxx/database/models'
import type { TicketPriority, TicketStatus, TicketType } from '@auxx/database/types'
import { publisher } from '@auxx/lib/events'
import { TRPCError } from '@trpc/server'
import { and, eq, exists, ilike, inArray, lt, not, or } from 'drizzle-orm'
import { ticketNumbering } from './ticket-numbering'
import type { TicketWithTypeData } from './types'
import { validateTicketTypeData } from './validation'
/**
 * Interface for creating a new ticket
 */
export interface CreateTicketInput {
  title: string
  description?: string
  type: TicketType
  priority?: TicketPriority
  status?: TicketStatus
  contactId: string
  assignedToId?: string
  dueDate?: Date
  parentTicketId?: string
  typeData?: Record<string, any>
  typeStatus?: string
  organizationId: string
  userId: string
}
/**
 * Interface for updating an existing ticket
 */
export interface UpdateTicketInput extends Partial<CreateTicketInput> {
  organizationId: string
  userId?: string
  id: string
}
/**
 * Interface for querying tickets with filters
 */
export interface GetTicketsParams {
  organizationId: string
  userId?: string
  status?: string[]
  type?: string[]
  priority?: string[]
  assignee?: string[]
  search?: string
  cursor?: string
  limit?: number
}
/**
 * Service class for handling ticket operations
 */
export class TicketService {
  constructor(private db: Database) {}
  /**
   * Create a new ticket with type-specific data
   */
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const {
      title,
      description,
      type,
      priority = TicketPriorityEnum.MEDIUM,
      status = TicketStatusEnum.OPEN,
      contactId,
      assignedToId,
      dueDate,
      parentTicketId,
      typeData = {},
      typeStatus,
      organizationId,
      userId,
    } = input
    // Validate type-specific data
    const validatedTypeData = validateTicketTypeData(type, typeData)
    return await this.db.transaction(async (tx: Transaction) => {
      const { ticketNumber } = await ticketNumbering.create(organizationId)
      const [ticket] = await tx
        .insert(schema.Ticket)
        .values({
          number: ticketNumber,
          title,
          description,
          type,
          priority,
          status,
          organizationId,
          contactId,
          dueDate,
          createdById: userId,
          parentTicketId,
          typeData: validatedTypeData,
          typeStatus,
          updatedAt: new Date(),
        })
        .returning()
      // Create assignment if assignedToId is provided
      if (assignedToId) {
        await tx.insert(schema.TicketAssignment).values({
          ticketId: ticket!.id,
          agentId: assignedToId,
          updatedAt: new Date(),
        })
      }
      await publisher.publishLater({
        type: 'ticket:created',
        data: {
          organizationId,
          ticketId: ticket!.id,
          userId,
          // Timeline metadata
          contactId,
          ticketNumber,
          ticketTitle: title,
          ticketType: type,
        },
      })
      return ticket
    })
  }
  /**
   * Update an existing ticket
   */
  async updateTicket(input: UpdateTicketInput): Promise<Ticket> {
    const {
      id,
      title,
      description,
      priority,
      status,
      dueDate,
      typeData,
      typeStatus,
      organizationId,
      userId,
    } = input
    // Check if ticket exists and user has permission
    const existingTicket = await this.db.query.Ticket.findFirst({
      columns: { id: true, organizationId: true, type: true },
      where: (t, { eq, and }) => and(eq(t.id, id), eq(t.organizationId, organizationId)),
    })
    if (!existingTicket) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }
    // Validate type-specific data if provided
    const validatedTypeData = typeData
      ? validateTicketTypeData(existingTicket.type as any, typeData)
      : undefined
    const updateData: Partial<typeof schema.Ticket.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (priority !== undefined) updateData.priority = priority
    if (status !== undefined) updateData.status = status
    if (dueDate !== undefined) updateData.dueDate = dueDate
    if (validatedTypeData !== undefined) updateData.typeData = validatedTypeData
    if (typeStatus !== undefined) updateData.typeStatus = typeStatus
    const [ticket] = await this.db
      .update(schema.Ticket)
      .set(updateData)
      .where(eq(schema.Ticket.id, id))
      .returning()

    // Get ticket details for timeline metadata
    const fullTicket = await this.db.query.Ticket.findFirst({
      columns: { contactId: true, number: true },
      where: (t, { eq }) => eq(t.id, id),
    })

    await publisher.publishLater({
      type: 'ticket:updated',
      data: {
        organizationId,
        ticketId: ticket!.id,
        userId: userId || 'system',
        // Timeline metadata
        contactId: fullTicket?.contactId,
        ticketNumber: fullTicket?.number,
      },
    })
    return ticket!
  }
  /**
   * Get a ticket by ID with all related data
   */
  async getTicketById(id: string, organizationId: string): Promise<TicketWithTypeData | null> {
    const ticket = await this.db.query.Ticket.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, organizationId)),
      with: {
        contact: true,
        assignments: {
          columns: { id: true, agentId: true },
          with: { agent: { columns: { id: true, name: true, email: true } } },
        },
        createdBy: { columns: { id: true, name: true } },
        childTickets: {
          with: { contact: { columns: { firstName: true, lastName: true } } },
        },
        parentTicket: {
          with: { contact: { columns: { firstName: true, lastName: true } } },
        },
        relatedTickets: {
          with: {
            relatedTicket: {
              columns: { id: true, number: true, title: true, status: true },
            },
          },
        },
        replies: {
          columns: {
            id: true,
            content: true,
            messageId: true,
            ticketId: true,
            isFromCustomer: true,
            senderEmail: true,
            createdAt: true,
          },
        },
      },
    })
    return ticket as unknown as TicketWithTypeData | null
  }
  /**
   * Get tickets with filters and pagination
   */
  async getTickets(params: GetTicketsParams): Promise<{
    tickets: Ticket[]
    nextCursor?: string
  }> {
    const {
      organizationId,
      userId,
      status,
      type,
      priority,
      assignee,
      search,
      cursor,
      limit = 20,
    } = params
    // Build Drizzle where predicate
    // Optional assignee predicate using exists on TicketAssignment
    const assigneePredicate = (t: typeof schema.Ticket) => {
      if (!assignee || assignee.length === 0) return undefined
      const base = (agentId?: string) =>
        exists(
          this.db
            .select({ id: schema.TicketAssignment.id })
            .from(schema.TicketAssignment)
            .where(
              and(
                eq(schema.TicketAssignment.ticketId, t.id),
                agentId ? eq(schema.TicketAssignment.agentId, agentId) : undefined
              )
            )
        )
      return or(
        assignee.includes('UNASSIGNED') ? not(base()) : undefined,
        assignee.includes('ME') && userId ? base(userId) : undefined,
        ...assignee.filter((a) => a !== 'UNASSIGNED' && a !== 'ME').map((id) => base(id))
      )
    }

    // Keyset pagination: use createdAt/id of cursor row if provided
    let cursorCreatedAt: string | undefined
    if (cursor) {
      const row = await this.db.query.Ticket.findFirst({
        columns: { id: true, createdAt: true },
        where: (t, { eq }) => eq(t.id, cursor),
      })
      cursorCreatedAt = row?.createdAt as any
    }

    const rows = await this.db.query.Ticket.findMany({
      where: (t, ops) =>
        and(
          eq(t.organizationId, organizationId),
          status?.length ? inArray(t.status as any, status as any) : undefined,
          type?.length ? inArray(t.type as any, type as any) : undefined,
          priority?.length ? inArray(t.priority as any, priority as any) : undefined,
          search
            ? or(
                ilike(t.title, `%${search}%`),
                ilike(t.description, `%${search}%`),
                ilike(t.number, `%${search}%`)
              )
            : undefined,
          assigneePredicate(t),
          cursor && cursorCreatedAt
            ? or(
                lt(t.createdAt as any, cursorCreatedAt as any),
                and(eq(t.createdAt as any, cursorCreatedAt as any), lt(t.id, cursor))
              )
            : undefined
        ),
      orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
      limit: limit + 1,
      with: {
        contact: true,
        assignments: { with: { agent: { columns: { id: true, name: true, email: true } } } },
      },
    })

    let nextCursor: string | undefined
    if (rows.length > limit) {
      // extra row indicates a next page; mirror previous behavior by using the extra row's id
      nextCursor = rows[limit]?.id
    }
    const tickets = rows.slice(0, limit) as any
    return { tickets, nextCursor }
  }
  /**
   * Delete a ticket and all its related data
   */
  async deleteTicket(id: string, organizationId: string, userId: string): Promise<void> {
    // Check if ticket exists and user has permission
    const ticket = await this.db.query.Ticket.findFirst({
      columns: { id: true, organizationId: true },
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, organizationId)),
    })
    if (!ticket) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }
    await this.db.transaction(async (tx) => {
      // Delete related data
      await tx.delete(schema.TicketReply).where(eq(schema.TicketReply.ticketId, id))
      await tx.delete(schema.TicketAssignment).where(eq(schema.TicketAssignment.ticketId, id))
      await tx
        .delete(schema.TicketRelation)
        .where(
          or(eq(schema.TicketRelation.ticketId, id), eq(schema.TicketRelation.relatedTicketId, id))
        )
      // Delete the ticket itself
      await tx.delete(schema.Ticket).where(eq(schema.Ticket.id, id))
    })
    await publisher.publishLater({
      type: 'ticket:deleted',
      data: { organizationId, ticketId: id, userId },
    })
  }
  /**
   * Update ticket status with proper timestamp handling
   */
  async updateTicketStatus(
    id: string,
    status: TicketStatus,
    organizationId: string,
    userId?: string
  ): Promise<Ticket> {
    const ticket = await this.db.query.Ticket.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, id), eq(t.organizationId, organizationId)),
    })
    if (!ticket) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }
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
      (ticket.status === TicketStatusEnum.RESOLVED || ticket.status === TicketStatusEnum.CLOSED) &&
      (status === TicketStatusEnum.OPEN || status === TicketStatusEnum.IN_PROGRESS)
    ) {
      ;(updatedData as any).resolvedAt = null
      ;(updatedData as any).closedAt = null
    }
    const oldStatus = ticket.status
    const [updatedTicket] = await this.db
      .update(schema.Ticket)
      .set(updatedData as any)
      .where(eq(schema.Ticket.id, id))
      .returning()
    await publisher.publishLater({
      type: 'ticket:updated',
      data: {
        organizationId,
        ticketId: ticket.id as string,
        userId: userId || 'system',
        // Timeline metadata
        contactId: ticket.contactId,
        ticketNumber: ticket.number,
      },
    })
    await publisher.publishLater({
      type: 'ticket:status:changed',
      data: {
        organizationId,
        ticketId: id,
        userId: userId || 'system',
        status,
        // Timeline metadata
        contactId: ticket.contactId,
        ticketNumber: ticket.number,
        oldStatus,
      },
    })
    return updatedTicket as unknown as Ticket
  }
  /**
   * Update ticket assignments
   */
  async updateTicketAssignments(
    ticketId: string,
    agentIds: string[],
    organizationId: string,
    userId: string
  ): Promise<any[]> {
    const ticket = await this.db.query.Ticket.findFirst({
      columns: { id: true, organizationId: true },
      where: (t, { and, eq }) => and(eq(t.id, ticketId), eq(t.organizationId, organizationId)),
    })
    if (!ticket) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }
    // Get current assignments
    const currentAssignments = await this.db
      .select({ id: schema.TicketAssignment.id, agentId: schema.TicketAssignment.agentId })
      .from(schema.TicketAssignment)
      .where(eq(schema.TicketAssignment.ticketId, ticketId))
    // Determine changes
    const currentAgentIds = currentAssignments.map((a) => a.agentId)
    const agentIdsToAdd = agentIds.filter((id) => !currentAgentIds.includes(id))
    const assignmentsToRemove = currentAssignments.filter((a) => !agentIds.includes(a.agentId))
    // Update assignments in transaction
    const result = await this.db.transaction(async (tx) => {
      // Remove old assignments
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

      const assignments = await tx.query.TicketAssignment.findMany({
        where: (ta, { eq }) => eq(ta.ticketId, ticketId),
        with: { agent: { columns: { id: true, name: true, email: true } } },
      })
      return assignments
    })
    // Publish events
    if (agentIdsToAdd.length > 0) {
      await publisher.publishLater({
        type: 'ticket:assignee:added',
        data: { organizationId, ticketId, userId, assigneeIds: agentIdsToAdd },
      })
    }
    if (assignmentsToRemove.length > 0) {
      await publisher.publishLater({
        type: 'ticket:assignee:removed',
        data: {
          organizationId,
          ticketId,
          userId,
          assigneeIds: assignmentsToRemove.map((a) => a.agentId),
        },
      })
    }
    return result
  }
}
