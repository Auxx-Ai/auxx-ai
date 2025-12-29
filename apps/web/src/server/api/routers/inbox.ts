// ~/server/api/routers/inbox.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { InboxService } from '@auxx/lib/inboxes'

// Input validation schemas
const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
  settings: z.record(z.string(), z.any()).optional(),
  allowAllMembers: z.boolean().optional(),
  enableMemberAccess: z.boolean().optional(),
  enableGroupAccess: z.boolean().optional(),
})

const updateInboxSchema = z.object({
  inboxId: z.string(),
  data: z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
    settings: z.record(z.string(), z.any()).optional(),
  }),
})

const inboxAccessSchema = z.object({
  inboxId: z.string(),
  allowAllMembers: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
})

const integrationSchema = z.object({
  inboxId: z.string(),
  integrationId: z.string(),
  isDefault: z.boolean().optional(),
  settings: z.record(z.string(), z.any()).optional(),
})

export const inboxRouter = createTRPCRouter({
  // Get all inboxes for the organization
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)
    return await inboxService.getInboxes()
  }),

  // Get inboxes for the current user
  getUserInboxes: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId)
    return await inboxService.getInboxesForUser(userId)
  }),

  // Get user inboxes with group details
  getUserInboxesWithGroups: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId)
    return await inboxService.getInboxesWithGroupDetails(userId)
  }),

  // Get a specific inbox by ID
  getById: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const inboxService = new InboxService(ctx.db, organizationId)

      const inbox = await inboxService.getInbox(input.inboxId)

      if (!inbox) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox not found' })
      }

      return inbox
    }),

  // Check if user has access to an inbox
  checkUserAccess: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId)

      return await inboxService.hasUserAccess(input.inboxId, userId)
    }),

  // Create a new inbox
  create: protectedProcedure.input(createInboxSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)

    return await inboxService.createInbox(input)
  }),

  // Update an existing inbox
  update: protectedProcedure.input(updateInboxSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)

    return await inboxService.updateInbox(input.inboxId, input.data)
  }),

  // Delete an inbox
  delete: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const inboxService = new InboxService(ctx.db, organizationId)

      return await inboxService.deleteInbox(input.inboxId)
    }),

  // Add an integration to an inbox
  addIntegration: protectedProcedure.input(integrationSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)

    return await inboxService.addIntegration(
      input.inboxId,
      input.integrationId,
      input.isDefault,
      input.settings
    )
  }),

  // Remove an integration from an inbox
  removeIntegration: protectedProcedure
    .input(z.object({ inboxId: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const inboxService = new InboxService(ctx.db, organizationId)

      return await inboxService.removeIntegration(input.inboxId, input.integrationId)
    }),

  // Update inbox access settings
  updateAccess: protectedProcedure.input(inboxAccessSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)

    const { inboxId, ...accessData } = input

    return await inboxService.updateInboxAccess(inboxId, accessData)
  }),

  // Invalidate cache for a user
  invalidateUserCache: protectedProcedure.mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId)

    await inboxService.invalidateUserInboxCache(userId)
    return { success: true }
  }),

  // Invalidate all organization inbox caches
  invalidateAllCaches: protectedProcedure.mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const inboxService = new InboxService(ctx.db, organizationId)

    await inboxService.invalidateAllInboxCaches()
    return { success: true }
  }),
})
