// server/api/routers/ticketViews.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { database as db, schema } from '@auxx/database'
import { and, eq, or, not, desc, asc } from 'drizzle-orm'

// Define the schema for our filters
const filtersSchema = z.object({
  status: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  priority: z.array(z.string()).optional(),
  assigneeIds: z.array(z.string()).optional(),
  searchQuery: z.string().optional(),
})

export const ticketViewsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session
    // Find both:
    // 1. All views created by the current user
    // 2. All public views in the user's organization created by other users
    return await db
      .select({
        id: schema.TicketView.id,
        name: schema.TicketView.name,
        filters: schema.TicketView.filters,
        isPublic: schema.TicketView.isPublic,
        userId: schema.TicketView.userId,
        organizationId: schema.TicketView.organizationId,
        createdAt: schema.TicketView.createdAt,
        updatedAt: schema.TicketView.updatedAt,
        user: {
          id: schema.User.id,
          name: schema.User.name,
        },
      })
      .from(schema.TicketView)
      .leftJoin(schema.User, eq(schema.TicketView.userId, schema.User.id))
      .where(
        or(
          // The user's own views (both public and private)
          eq(schema.TicketView.userId, userId),
          // Public views from other users in the same organization
          and(
            eq(schema.TicketView.organizationId, organizationId),
            eq(schema.TicketView.isPublic, true),
            not(eq(schema.TicketView.userId, userId))
          )
        )
      )
      .orderBy(
        // Sort by creation date (newest first)
        desc(schema.TicketView.createdAt)
      )
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'View name is required'),
        filters: filtersSchema,
        isPublic: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if a view with this name already exists for this user
      const { organizationId, userId } = ctx.session

      const { filters, name, isPublic } = input

      const [existingView] = await db
        .select()
        .from(schema.TicketView)
        .where(
          and(
            eq(schema.TicketView.name, input.name),
            eq(schema.TicketView.userId, userId)
          )
        )
        .limit(1)

      if (existingView) {
        // Update the existing view instead of creating a new one
        const [updatedView] = await db
          .update(schema.TicketView)
          .set({ filters, isPublic, updatedAt: new Date() })
          .where(eq(schema.TicketView.id, existingView.id))
          .returning()

        return updatedView
      }

      // Create a new view
      const [newView] = await db
        .insert(schema.TicketView)
        .values({ name, filters, isPublic, userId, organizationId })
        .returning()

      return newView
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        filters: filtersSchema.optional(),
        isPublic: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session

      const { id, filters, name, isPublic } = input

      // Check if the view exists and belongs to the user
      const [view] = await db
        .select()
        .from(schema.TicketView)
        .where(
          and(
            eq(schema.TicketView.id, id),
            eq(schema.TicketView.userId, userId)
          )
        )
        .limit(1)

      if (!view) {
        throw new Error('View not found or you do not have permission to update it')
      }

      // Update the view
      const [updatedView] = await db
        .update(schema.TicketView)
        .set({ name, filters, isPublic, updatedAt: new Date() })
        .where(eq(schema.TicketView.id, id))
        .returning()

      return updatedView
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session

      const { id } = input

      // Check if the view exists and belongs to the user
      const [view] = await db
        .select()
        .from(schema.TicketView)
        .where(
          and(
            eq(schema.TicketView.id, id),
            eq(schema.TicketView.userId, userId)
          )
        )
        .limit(1)

      if (!view) {
        throw new Error('View not found or you do not have permission to delete it')
      }

      // Delete the view
      await db
        .delete(schema.TicketView)
        .where(eq(schema.TicketView.id, input.id))

      return { success: true }
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { userId } = ctx.session

    const { id } = input

    // Get a specific view by ID
    // TODO: filter by organizationId if needed
    const [view] = await db
      .select()
      .from(schema.TicketView)
      .where(
        and(
          eq(schema.TicketView.id, id),
          eq(schema.TicketView.userId, userId)
        )
      )
      .limit(1)

    if (!view) {
      throw new Error('View not found or you do not have permission to access it')
    }

    return view
  }),

  // Add a procedure to toggle the public status of a view
  togglePublic: protectedProcedure
    .input(z.object({ id: z.string(), isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session

      const { id, isPublic } = input

      // Check if the view exists and belongs to the user
      const [view] = await db
        .select()
        .from(schema.TicketView)
        .where(
          and(
            eq(schema.TicketView.id, id),
            eq(schema.TicketView.userId, userId)
          )
        )
        .limit(1)

      if (!view) {
        throw new Error('View not found or you do not have permission to update it')
      }

      // Update just the isPublic field
      const [updatedView] = await db
        .update(schema.TicketView)
        .set({ isPublic, updatedAt: new Date() })
        .where(eq(schema.TicketView.id, id))
        .returning()

      return updatedView
    }),

  // Add a procedure to get the default view for the user
  getDefault: protectedProcedure.query(async ({ ctx }) => {
    // Get the first view by latest creation date as default
    // You could add a 'isDefault' field to the model later for explicit defaults
    const { userId } = ctx.session

    const [view] = await db
      .select()
      .from(schema.TicketView)
      .where(eq(schema.TicketView.userId, userId))
      .orderBy(desc(schema.TicketView.createdAt))
      .limit(1)

    return view || null
  }),
})
