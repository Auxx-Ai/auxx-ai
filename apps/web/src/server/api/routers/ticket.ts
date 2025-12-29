// apps/web/src/server/api/routers/ticket.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TicketPriority, TicketStatus, TicketType } from '@auxx/database/enums'
import { schema } from '@auxx/database'
import { and, count, eq, inArray } from 'drizzle-orm'
import {
  createTicketDashboardService,
  ticketService,
  updateMultipleStatus,
  updateMultiplePriority,
  updateMultipleAssignments,
  deleteMultipleTickets,
  addRelation,
  removeRelation,
  ticketMergeService,
} from '@auxx/lib/tickets'
import { publisher } from '@auxx/lib/events'

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

  // Add a note to a ticket
  addNote: protectedProcedure
    .input(
      z.object({
        ticketId: z.string(),
        content: z.string().min(1),
        isInternal: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { ticketId, content, isInternal } = input
      const { organizationId, userId } = ctx.session

      const authorId = ctx.session.user.id

      const ticket = await ctx.db.query.Ticket.findFirst({
        columns: { id: true },
        where: (ticket, { eq }) =>
          and(eq(ticket.id, ticketId), eq(ticket.organizationId, organizationId)),
      })

      if (!ticket) {
        throw new Error('Ticket not found')
      }

      const [insertedNote] = await ctx.db
        .insert(schema.TicketNote)
        .values({ content, isInternal, authorId, ticketId, updatedAt: new Date() })
        .returning()

      const noteWithAuthor = await ctx.db.query.TicketNote.findFirst({
        where: (note, { eq }) => eq(note.id, insertedNote.id),
        with: {
          author: { columns: { id: true, name: true } },
        },
      })

      // Update the ticket's updatedAt timestamp
      await ctx.db
        .update(schema.Ticket)
        .set({ updatedAt: new Date() })
        .where(eq(schema.Ticket.id, ticketId))

      if (!noteWithAuthor) {
        throw new Error('Failed to create note')
      }

      const { author, ...noteData } = noteWithAuthor

      return {
        ...noteData,
        author: author ?? null,
      }
    }),

  // Delete a note
  deleteNote: protectedProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { noteId } = input
      const { organizationId } = ctx.session

      const note = await ctx.db.query.TicketNote.findFirst({
        columns: { id: true, ticketId: true },
        where: (note, { eq }) => eq(note.id, noteId),
        with: {
          ticket: { columns: { organizationId: true } },
        },
      })

      if (!note || note.ticket?.organizationId !== organizationId) {
        throw new Error('Note not found')
      }

      await ctx.db.delete(schema.TicketNote).where(eq(schema.TicketNote.id, noteId))

      // Update the ticket's updatedAt timestamp
      await ctx.db
        .update(schema.Ticket)
        .set({ updatedAt: new Date() })
        .where(eq(schema.Ticket.id, note.ticketId))

      return true
    }),

  // Get tickets by contact ID
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
      const { organizationId } = ctx.session

      const skip = (page - 1) * pageSize

      const baseWhere = and(
        eq(schema.Ticket.organizationId, organizationId),
        eq(schema.Ticket.contactId, contactId),
        status ? eq(schema.Ticket.status, status as any) : undefined
      )

      const totalResult = await ctx.db
        .select({ count: count() })
        .from(schema.Ticket)
        .where(baseWhere)
      const totalValue = totalResult[0]?.count ?? 0
      const total = typeof totalValue === 'number' ? totalValue : Number(totalValue)

      const rows = await ctx.db.query.Ticket.findMany({
        where: (ticket) =>
          and(
            eq(ticket.organizationId, organizationId),
            eq(ticket.contactId, contactId),
            status ? eq(ticket.status, status as any) : undefined
          ),
        with: {
          contact: true,
          assignments: {
            columns: { id: true, agentId: true, isActive: true },
            where: (assignment, { eq }) => eq(assignment.isActive, true),
            with: { agent: { columns: { id: true, name: true, email: true } } },
          },
        },
        orderBy: (ticket, { desc }) => [desc(ticket.updatedAt)],
        limit: pageSize,
        offset: skip,
      })

      const ticketIds = rows.map((ticket) => ticket.id)

      let repliesCountMap: Record<string, number> = {}
      let notesCountMap: Record<string, number> = {}

      if (ticketIds.length > 0) {
        const replyCounts = await ctx.db
          .select({ ticketId: schema.TicketReply.ticketId, value: count() })
          .from(schema.TicketReply)
          .where(inArray(schema.TicketReply.ticketId, ticketIds))
          .groupBy(schema.TicketReply.ticketId)

        repliesCountMap = Object.fromEntries(
          replyCounts.map(({ ticketId, value }) => [ticketId, Number(value)])
        )

        const noteCounts = await ctx.db
          .select({ ticketId: schema.TicketNote.ticketId, value: count() })
          .from(schema.TicketNote)
          .where(inArray(schema.TicketNote.ticketId, ticketIds))
          .groupBy(schema.TicketNote.ticketId)

        notesCountMap = Object.fromEntries(
          noteCounts.map(({ ticketId, value }) => [ticketId, Number(value)])
        )
      }

      const tickets = rows.map(({ contact, assignments, ...ticket }) => ({
        ...ticket,
        contact,
        assignments,
        _count: {
          replies: repliesCountMap[ticket.id] ?? 0,
          notes: notesCountMap[ticket.id] ?? 0,
        },
      }))

      return { tickets, total, totalPages: Math.ceil(total / pageSize) }
    }),

  // Get agents assigned to a ticket
  getAgents: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { ticketId } = input
      const { organizationId } = ctx.session

      const ticket = await ctx.db.query.Ticket.findFirst({
        where: (ticket, { eq }) =>
          and(eq(ticket.id, ticketId), eq(ticket.organizationId, organizationId)),
        with: {
          assignments: {
            columns: { id: true, agentId: true, isActive: true },
            with: {
              agent: { columns: { id: true, name: true, email: true } },
            },
          },
        },
      })

      if (!ticket) {
        throw new Error('Ticket not found')
      }

      return ticket.assignments
    }),

  // Update a reply's content
  updateReply: protectedProcedure
    .input(z.object({ id: z.string(), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const reply = await ctx.db.query.TicketReply.findFirst({
        where: (reply, { eq }) => eq(reply.id, input.id),
        with: { ticket: { columns: { organizationId: true } } },
      })

      if (!reply) {
        throw new Error('Reply not found')
      }

      const { organizationId } = ctx.session
      if (reply.ticket?.organizationId !== organizationId) {
        throw new Error("You don't have permission to update this reply")
      }

      const [updatedReply] = await ctx.db
        .update(schema.TicketReply)
        .set({ content: input.content })
        .where(eq(schema.TicketReply.id, input.id))
        .returning()

      if (!updatedReply) {
        throw new Error('Failed to update reply')
      }

      return updatedReply
    }),

  // Delete a reply
  deleteReply: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const reply = await ctx.db.query.TicketReply.findFirst({
        where: (reply, { eq }) => eq(reply.id, input.id),
        with: { ticket: { columns: { organizationId: true } } },
      })

      if (!reply) {
        throw new Error('Reply not found')
      }

      const { organizationId } = ctx.session
      if (reply.ticket?.organizationId !== organizationId) {
        throw new Error("You don't have permission to delete this reply")
      }

      await ctx.db.delete(schema.TicketReply).where(eq(schema.TicketReply.id, input.id))
      return { success: true }
    }),

  // Get all replies for a ticket
  getReplies: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { ticketId } = input
      const { organizationId } = ctx.session

      // Verify ticket belongs to organization
      const ticket = await ctx.db.query.Ticket.findFirst({
        where: (ticket, { eq, and }) =>
          and(eq(ticket.id, ticketId), eq(ticket.organizationId, organizationId)),
        columns: { id: true },
      })

      if (!ticket) {
        throw new Error('Ticket not found')
      }

      // Fetch all replies for this ticket
      const replies = await ctx.db.query.TicketReply.findMany({
        where: (reply, { eq }) => eq(reply.ticketId, ticketId),
        with: {
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
        orderBy: (reply, { asc }) => [asc(reply.createdAt)],
      })

      return { replies }
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
