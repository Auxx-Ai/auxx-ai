// packages/lib/src/tickets/ticket-service.ts

import type { Database } from '@auxx/database'
import {
  TicketPriority as TicketPriorityEnum,
  TicketStatus as TicketStatusEnum,
} from '@auxx/database/enums'
import type { TicketPriority, TicketStatus, TicketType } from '@auxx/database/types'
import { TRPCError } from '@trpc/server'
import { publisher } from '../events/publisher'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import { ticketNumbering } from './ticket-numbering'

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
 * Service class for handling ticket operations.
 * Delegates to UnifiedCrudHandler for EntityInstance-based storage.
 */
export class TicketService {
  constructor(private db: Database) {}

  /**
   * Create a new ticket via UnifiedCrudHandler
   */
  async createTicket(input: CreateTicketInput): Promise<any> {
    const {
      title,
      description,
      type,
      priority = TicketPriorityEnum.MEDIUM,
      status = TicketStatusEnum.OPEN,
      contactId,
      assignedToId,
      dueDate,
      typeData = {},
      typeStatus,
      organizationId,
      userId,
    } = input

    const handler = new UnifiedCrudHandler(organizationId, userId, this.db)

    const values: Record<string, unknown> = {
      title,
      description,
      ticket_type: type,
      priority,
      status,
      contact_id: contactId,
      type_data: typeData,
    }

    if (assignedToId) values.assigned_to_id = assignedToId
    if (dueDate) values.due_date = dueDate
    if (typeStatus) values.type_status = typeStatus

    const result = await handler.create('ticket', values)

    await publisher.publishLater({
      type: 'ticket:created',
      data: {
        organizationId,
        ticketId: result.instance.id,
        userId,
        contactId,
        ticketTitle: title,
        ticketType: type,
      },
    })

    return result.instance
  }

  /**
   * Update an existing ticket via UnifiedCrudHandler
   */
  async updateTicket(input: UpdateTicketInput): Promise<any> {
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

    const handler = new UnifiedCrudHandler(organizationId, userId || 'system', this.db)
    const recordId = toRecordId('ticket', id)

    const values: Record<string, unknown> = {}
    if (title !== undefined) values.title = title
    if (description !== undefined) values.description = description
    if (priority !== undefined) values.priority = priority
    if (status !== undefined) values.status = status
    if (dueDate !== undefined) values.due_date = dueDate
    if (typeData !== undefined) values.type_data = typeData
    if (typeStatus !== undefined) values.type_status = typeStatus

    await handler.update(recordId, values)

    await publisher.publishLater({
      type: 'ticket:updated',
      data: {
        organizationId,
        ticketId: id,
        userId: userId || 'system',
      },
    })

    // Return the updated instance
    return handler.getById(recordId)
  }

  /**
   * Get a ticket by ID via UnifiedCrudHandler
   */
  async getTicketById(id: string, organizationId: string): Promise<any | null> {
    const handler = new UnifiedCrudHandler(organizationId, 'system', this.db)
    const recordId = toRecordId('ticket', id)
    return handler.getById(recordId)
  }

  /**
   * Get tickets with filters and pagination via UnifiedCrudHandler
   */
  async getTickets(params: GetTicketsParams): Promise<{
    tickets: any[]
    nextCursor?: string
  }> {
    const { organizationId, limit = 20 } = params

    const handler = new UnifiedCrudHandler(organizationId, params.userId || 'system', this.db)

    // TODO: Implement full filter support (status, type, priority, assignee, search)
    // via handler.listFiltered() with ConditionGroup filters
    const result = await handler.list('ticket', { limit: limit + 1 })

    let nextCursor: string | undefined
    if (result.items.length > limit) {
      nextCursor = result.items[limit]?.id
    }
    const tickets = result.items.slice(0, limit)
    return { tickets, nextCursor }
  }

  /**
   * Delete a ticket via UnifiedCrudHandler
   */
  async deleteTicket(id: string, organizationId: string, userId: string): Promise<void> {
    const handler = new UnifiedCrudHandler(organizationId, userId, this.db)
    const recordId = toRecordId('ticket', id)

    const existing = await handler.getById(recordId)
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }

    await handler.delete(recordId)

    await publisher.publishLater({
      type: 'ticket:deleted',
      data: { organizationId, ticketId: id, userId },
    })
  }

  /**
   * Update ticket status via UnifiedCrudHandler
   */
  async updateTicketStatus(
    id: string,
    status: TicketStatus,
    organizationId: string,
    userId?: string
  ): Promise<any> {
    const handler = new UnifiedCrudHandler(organizationId, userId || 'system', this.db)
    const recordId = toRecordId('ticket', id)

    const existing = await handler.getById(recordId)
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }

    await handler.update(recordId, { status })

    await publisher.publishLater({
      type: 'ticket:updated',
      data: {
        organizationId,
        ticketId: id,
        userId: userId || 'system',
      },
    })

    await publisher.publishLater({
      type: 'ticket:status:changed',
      data: {
        organizationId,
        ticketId: id,
        userId: userId || 'system',
        status,
      },
    })

    return handler.getById(recordId)
  }

  /**
   * Update ticket assignment via UnifiedCrudHandler.
   * Assignments are now an ACTOR field `assigned_to_id` on the ticket entity.
   * This only supports a single assignee (the last provided agentId).
   */
  async updateTicketAssignments(
    ticketId: string,
    agentIds: string[],
    organizationId: string,
    userId: string
  ): Promise<any[]> {
    const handler = new UnifiedCrudHandler(organizationId, userId, this.db)
    const recordId = toRecordId('ticket', ticketId)

    const existing = await handler.getById(recordId)
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' })
    }

    // Assignments are now a single ACTOR field; use the first agent or null
    const assignedToId = agentIds.length > 0 ? agentIds[0] : null
    await handler.update(recordId, { assigned_to_id: assignedToId })

    if (agentIds.length > 0) {
      await publisher.publishLater({
        type: 'ticket:assignee:added',
        data: { organizationId, ticketId, userId, assigneeIds: agentIds },
      })
    }

    return agentIds.map((agentId) => ({ ticketId, agentId }))
  }
}
