// apps/web/src/server/api/routers/inbox.ts

import { InboxService } from '@auxx/lib/inboxes'
import { recordIdSchema, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/** Schema for creating an inbox */
const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
  visibility: z.enum(['org_members', 'private', 'custom']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

/** Schema for updating an inbox */
const updateInboxSchema = z.object({
  inboxId: z.string(),
  data: z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
    visibility: z.enum(['org_members', 'private', 'custom']).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
})

/** Schema for updating inbox access */
const inboxAccessSchema = z.object({
  inboxId: z.string(),
  visibility: z.enum(['org_members', 'private', 'custom']).optional(),
  memberIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
})

/** Schema for managing integrations - uses RecordId for consistency */
const integrationSchema = z.object({
  recordId: recordIdSchema,
  integrationId: z.string(),
  isDefault: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

export const inboxRouter = createTRPCRouter({
  /**
   * Get all inboxes for the organization
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)
    return inboxService.getInboxes()
  }),

  /**
   * Search inboxes by name for autocomplete.
   * Returns inboxes accessible to the user with id and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)
      const userInboxes = await inboxService.getInboxesForUser(userId)

      // Filter inboxes by query (case-insensitive)
      const query = input.query.toLowerCase()
      const filtered = userInboxes
        .filter((inbox) => inbox.name.toLowerCase().includes(query))
        .slice(0, 10)
        .map((inbox) => ({
          id: inbox.id,
          name: inbox.name,
        }))

      return filtered
    }),

  /**
   * Get inboxes accessible to the current user
   */
  getUserInboxes: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)
    return inboxService.getInboxesForUser(userId)
  }),

  /**
   * Get a specific inbox by ID
   */
  getById: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const inbox = await inboxService.getInboxById(input.inboxId)

      if (!inbox) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox not found' })
      }

      return inbox
    }),

  /**
   * Get inbox with integrations (legacy - use getById + getIntegrations instead)
   */
  getByIdWithIntegrations: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const inbox = await inboxService.getInboxWithIntegrationsById(input.inboxId)

      if (!inbox) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox not found' })
      }

      return inbox
    }),

  /**
   * Get integrations for an inbox
   */
  getIntegrations: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const inbox = await inboxService.getInboxWithIntegrationsById(input.inboxId)

      if (!inbox) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox not found' })
      }

      return inbox.integrations
    }),

  /**
   * Check if current user has access to an inbox
   */
  checkUserAccess: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      return inboxService.hasUserAccessById(input.inboxId, userId)
    }),

  /**
   * Create a new inbox
   */
  create: protectedProcedure.input(createInboxSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    return inboxService.createInbox(input)
  }),

  /**
   * Update an existing inbox
   */
  update: protectedProcedure.input(updateInboxSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    return inboxService.updateInboxById(input.inboxId, input.data)
  }),

  /**
   * Delete an inbox
   */
  delete: protectedProcedure
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      await inboxService.deleteInboxById(input.inboxId)
      return { success: true }
    }),

  /**
   * Add an integration to an inbox
   */
  addIntegration: protectedProcedure.input(integrationSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    return inboxService.addIntegration(
      input.recordId,
      input.integrationId,
      input.isDefault,
      input.settings
    )
  }),

  /**
   * Remove an integration from an inbox
   */
  removeIntegration: protectedProcedure
    .input(z.object({ inboxId: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const recordId = toRecordId('inbox', input.inboxId)
      return inboxService.removeIntegration(recordId, input.integrationId)
    }),

  /**
   * Update inbox access settings
   */
  updateAccess: protectedProcedure.input(inboxAccessSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    const { inboxId, ...accessData } = input
    const recordId = toRecordId('inbox', inboxId)

    return inboxService.updateInboxAccess(recordId, accessData)
  }),
})
