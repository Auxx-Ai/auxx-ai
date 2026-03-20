// apps/web/src/server/api/routers/ticket.ts

import { schema } from '@auxx/database'
import { TicketPriority, TicketStatus, TicketType } from '@auxx/database/enums'
import { publisher } from '@auxx/lib/events'
import {
  addRelation,
  createTicketDashboardService,
  deleteMultipleTickets,
  removeRelation,
  ticketMergeService,
  ticketService,
  updateMultipleAssignments,
  updateMultiplePriority,
  updateMultipleStatus,
} from '@auxx/lib/tickets'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Simplified input schema for tickets with JSON-based type data
 */
const ticketInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3).max(255),
  description: z.string().optional(),
  type: z.enum(Object.values(TicketType) as [string, ...string[]]),
  priority: z
    .enum(Object.values(TicketPriority) as [string, ...string[]])
    .default(TicketPriority.MEDIUM),
  status: z.enum(Object.values(TicketStatus) as [string, ...string[]]).optional(),
  contactId: z.string(),
  assignedToId: z.string().optional(),
  dueDate: z.date().optional(),
  parentTicketId: z.string().optional(),
  typeData: z.record(z.string(), z.unknown()).optional(),
  typeStatus: z.string().optional(),
})

/**
 * Allowed periods for ticket dashboard rollups
 */
const dashboardPeriodSchema = z.enum(['day', 'week', 'month', 'year'])

/**
 * Simplified ticket router using the new service layer
 */
export const ticketRouter = createTRPCRouter({
  // Create ticket
  create: protectedProcedure
    .input(ticketInputSchema.omit({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      return await ticketService.createTicket({
        ...input,
        organizationId,
        userId,
      })
    }),

  // Update ticket
  update: protectedProcedure
    .input(ticketInputSchema.partial().required({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      return await ticketService.updateTicket({
        ...input,
        organizationId,
        userId,
      })
    }),

  // Get ticket by ID
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const ticket = await ticketService.getTicketById(input.id, organizationId)
    if (!ticket) {
      throw new Error('Ticket not found')
    }
    return ticket
  }),

  // Retrieve ticket dashboard summary
  dashboard: protectedProcedure
    .input(z.object({ period: dashboardPeriodSchema.default('week') }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const dashboardService = createTicketDashboardService(ctx.db)
      return await dashboardService.getSummary({
        organizationId,
        period: input?.period,
      })
    }),

  // Get all tickets for organization with filters (legacy endpoint)
  all: protectedProcedure
    .input(
      z.object({
        status: z
          .enum(['ALL', ...(Object.values(TicketStatus) as [string, ...string[]])])
          .optional(),
        type: z.enum(['ALL', ...(Object.values(TicketType) as [string, ...string[]])]).optional(),
        priority: z
          .enum(['ALL', ...(Object.values(TicketPriority) as [string, ...string[]])])
          .optional(),
        assignedToId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { status, type, priority, assignedToId, search, limit, cursor } = input
      const { organizationId, userId } = ctx.session

      return await ticketService.getTickets({
        organizationId,
        userId,
        status: status && status !== 'ALL' ? [status] : undefined,
        type: type && type !== 'ALL' ? [type] : undefined,
        priority: priority && priority !== 'ALL' ? [priority] : undefined,
        assignee: assignedToId ? [assignedToId] : undefined,
        search,
        cursor,
        limit,
      })
    }),

  // List tickets with filters
  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        type: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { status, type, priority, assignee, ...rest } = input

      return await ticketService.getTickets({
        organizationId,
        userId,
        status: status?.split(',').filter(Boolean),
        type: type?.split(',').filter(Boolean),
        priority: priority?.split(',').filter(Boolean),
        assignee: assignee?.split(',').filter(Boolean),
        ...rest,
      })
    }),

  // Delete ticket
  deleteTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await ticketService.deleteTicket(input.ticketId, organizationId, userId)
      return { success: true }
    }),

  // Update ticket status
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(Object.values(TicketStatus) as [string, ...string[]]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      return await ticketService.updateTicketStatus(input.id, input.status, organizationId, userId)
    }),

  // Update ticket assignments
  updateAssignment: protectedProcedure
    .input(z.object({ ticketId: z.string(), agentIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      return await ticketService.updateTicketAssignments(
        input.ticketId,
        input.agentIds,
        organizationId,
        userId
      )
    }),

  // Update ticket priority
  updatePriority: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        priority: z.enum(Object.values(TicketPriority) as [string, ...string[]]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const ticket = await ticketService.updateTicket({
        id: input.id,
        priority: input.priority,
        organizationId,
        userId,
      })

      return ticket
    }),

  // Get tickets by contact ID
  // TODO: Ticket table deleted; ticketService.getTickets does not yet support contactId filtering.
  // Returns all tickets for now; contactId filtering should be added to the service layer.
  byContactId: protectedProcedure
    .input(
      z.object({
        contactId: z.string(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(10),
        status: z.enum(Object.values(TicketStatus) as [string, ...string[]]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { contactId, page, pageSize, status } = input
      const { organizationId, userId } = ctx.session

      // TODO: ticketService.getTickets does not support contactId filtering yet.
      // Once supported, pass contactId to filter tickets by contact.
      const result = await ticketService.getTickets({
        organizationId,
        userId,
        status: status ? [status] : undefined,
        limit: pageSize,
      })

      const tickets = result.tickets ?? []

      return {
        tickets,
        total: tickets.length,
        totalPages: 1,
      }
    }),

  // Get agents assigned to a ticket
  // TODO: TicketAssignment table deleted; assignments are now field values on the ticket entity.
  getAgents: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { ticketId } = input
      const { organizationId } = ctx.session

      const ticket = await ticketService.getTicketById(ticketId, organizationId)
      if (!ticket) {
        throw new Error('Ticket not found')
      }

      // Assignments are now stored as field values; return empty array as stub
      // TODO: Extract assigned agent from ticket field values (assigned_to_id field)
      return [] as Array<{
        id: string
        agentId: string
        isActive: boolean
        agent: { id: string; name: string; email: string }
      }>
    }),

  // Update multiple tickets' status
  updateMultipleStatus: protectedProcedure
    .input(
      z.object({
        ticketIds: z.array(z.string()),
        status: z.enum(Object.values(TicketStatus) as [string, ...string[]]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { ticketIds, status } = input
      const { organizationId, userId } = ctx.session

      await updateMultipleStatus(ctx.db, {
        ticketIds,
        status: status as any,
        organizationId,
        userId,
      })

      return { success: true }
    }),

  // Update multiple tickets' priority
  updateMultiplePriority: protectedProcedure
    .input(
      z.object({
        ticketIds: z.array(z.string()),
        priority: z.enum(Object.values(TicketPriority) as [string, ...string[]]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { ticketIds, priority } = input
      const { organizationId, userId } = ctx.session

      await updateMultiplePriority(ctx.db, {
        ticketIds,
        priority: priority as any,
        organizationId,
        userId,
      })

      return { success: true }
    }),

  // Update multiple tickets' assignments
  updateMultipleAssignments: protectedProcedure
    .input(z.object({ ticketIds: z.array(z.string()), agentIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { ticketIds, agentIds } = input
      const { organizationId, userId } = ctx.session

      await updateMultipleAssignments(ctx.db, {
        ticketIds,
        agentIds,
        organizationId,
        userId,
      })

      return { success: true }
    }),

  // Delete multiple tickets
  deleteMultipleTickets: protectedProcedure
    .input(z.object({ ticketIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { ticketIds } = input
      const { organizationId, userId } = ctx.session

      return await deleteMultipleTickets(ctx.db, {
        ticketIds,
        organizationId,
        userId,
      })
    }),

  mergeTickets: protectedProcedure
    .input(z.object({ primaryTicketId: z.string(), ticketsToMergeIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { primaryTicketId, ticketsToMergeIds } = input
      const { organizationId, userId } = ctx.session

      const result = await ticketMergeService.mergeTickets(
        primaryTicketId,
        ticketsToMergeIds,
        userId
      )
      await publisher.publishLater({
        type: 'ticket:updated',
        data: { organizationId, ticketId: primaryTicketId, userId },
      })

      return result
    }),

  // Add a relation between tickets
  addRelation: protectedProcedure
    .input(
      z.object({
        ticketId: z.string(),
        relatedTicketId: z.string(),
        relation: z.string(), // e.g., "RELATED", "BLOCKED_BY", "PARENT_OF", "CHILD_OF", "BLOCKS", "DUPLICATE_OF"
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { ticketId, relatedTicketId, relation } = input

      return await addRelation(ctx.db, {
        ticketId,
        relatedTicketId,
        relation,
        organizationId,
        userId,
      })
    }),

  // Remove a relation between tickets
  removeRelation: protectedProcedure
    .input(z.object({ relationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { relationId } = input

      return await removeRelation(ctx.db, {
        relationId,
        organizationId,
        userId,
      })
    }),
})
