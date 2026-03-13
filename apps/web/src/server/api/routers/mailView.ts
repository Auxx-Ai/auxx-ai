// apps/web/src/server/api/routers/mailView.ts

import { schema } from '@auxx/database'
import { conditionGroupsSchema } from '@auxx/lib/conditions/client'
import { MailViewService } from '@auxx/lib/mail-views'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

// Create mail view input schema
const createMailViewSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  filterGroups: conditionGroupsSchema,
  isDefault: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  isShared: z.boolean().default(false),
  sortField: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
})

// Update mail view input schema
const updateMailViewSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().min(1, 'Name is required').max(100).optional(),
    description: z.string().optional(),
    filterGroups: conditionGroupsSchema.optional(),
    isDefault: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    isShared: z.boolean().optional(),
    sortField: z.string().optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
  }),
})

export const mailViewRouter = createTRPCRouter({
  // Create a new mail view
  create: protectedProcedure.input(createMailViewSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id

    // Check saved view limit (only for shared/team views)
    if (input.isShared) {
      const featureService = new FeaturePermissionService(ctx.db)
      const viewLimit = await featureService.getLimit(organizationId, FeatureKey.savedViews)
      if (typeof viewLimit === 'number' && viewLimit >= 0) {
        const [{ value: current }] = await ctx.db
          .select({ value: count() })
          .from(schema.MailView)
          .where(
            and(
              eq(schema.MailView.organizationId, organizationId),
              eq(schema.MailView.isShared, true)
            )
          )
        if (current >= viewLimit) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You have reached your saved view limit (${viewLimit}). Upgrade your plan to create more views.`,
          })
        }
      }
    }

    const mailViewService = new MailViewService(organizationId, ctx.db)
    return await mailViewService.createMailView(userId, input)
  }),

  // Get a mail view by ID
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(organizationId, ctx.db)

    const mailView = await mailViewService.getMailView(input.id)

    if (!mailView) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
    }

    return mailView
  }),

  // Get all mail views for the current user
  getUserMailViews: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const mailViewService = new MailViewService(organizationId, ctx.db)

    return await mailViewService.getUserMailViews(userId)
  }),

  // Get shared mail views for the organization
  getSharedMailViews: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(organizationId, ctx.db)

    return await mailViewService.getSharedMailViews()
  }),

  // Get all accessible mail views (user's own + shared)
  getAllAccessibleMailViews: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const mailViewService = new MailViewService(organizationId, ctx.db)

    const [userViews, sharedViews] = await Promise.all([
      mailViewService.getUserMailViews(userId),
      mailViewService.getSharedMailViews(),
    ])

    // Filter out duplicates if a user has both personal and shared versions
    const sharedViewIds = new Set(sharedViews.map((view) => view.id))
    const uniqueUserViews = userViews.filter((view) => !sharedViewIds.has(view.id))

    return [...uniqueUserViews, ...sharedViews]
  }),

  // Update an existing mail view
  update: protectedProcedure.input(updateMailViewSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(organizationId, ctx.db)

    // Check if the user has access to modify this view
    const existingView = await mailViewService.getMailView(input.id)

    if (!existingView) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
    }

    // Only the owner or an admin can modify a view (you might want to add additional permission checks)
    if (existingView.userId !== ctx.session.user.id && !ctx.session.user.isAdmin) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to modify this view',
      })
    }

    return await mailViewService.updateMailView(input.id, input.data)
  }),

  // Delete a mail view
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const mailViewService = new MailViewService(organizationId, ctx.db)

      // Check if the user has access to delete this view
      const existingView = await mailViewService.getMailView(input.id)

      if (!existingView) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
      }

      // Only the owner or an admin can delete a view
      if (existingView.userId !== ctx.session.user.id && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete this view',
        })
      }

      return await mailViewService.deleteMailView(input.id)
    }),

  // Set a mail view as default
  setDefault: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const mailViewService = new MailViewService(organizationId, ctx.db)

      // Check if the user has access to this view
      const existingView = await mailViewService.getMailView(input.id)

      if (!existingView) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
      }

      return await mailViewService.setMailViewAsDefault(input.id, userId)
    }),

  // Toggle pinned status
  togglePinned: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const mailViewService = new MailViewService(organizationId, ctx.db)

      // Check if the user has access to this view
      const existingView = await mailViewService.getMailView(input.id)

      if (!existingView) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
      }

      // Only the owner can pin/unpin a view
      if (existingView.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to modify this view',
        })
      }

      return await mailViewService.toggleMailViewPinned(input.id)
    }),

  // Get threads that match a mail view's filters
  getThreads: protectedProcedure
    .input(
      z.object({
        mailViewId: z.string(),
        page: z.number().default(1),
        pageSize: z.number().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const mailViewService = new MailViewService(organizationId, ctx.db)

      // Check if the mail view exists
      const mailView = await mailViewService.getMailView(input.mailViewId)

      if (!mailView) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
      }

      // Check if the user has access to this view
      const isOwner = mailView.userId === ctx.session.user.id
      const isShared = mailView.isShared

      if (!isOwner && !isShared) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this view' })
      }

      return await mailViewService.getThreadsByMailView(input.mailViewId, {
        page: input.page,
        pageSize: input.pageSize,
      })
    }),
})
