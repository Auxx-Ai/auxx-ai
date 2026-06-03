// apps/web/src/server/api/routers/inbox.ts

import { InboxService } from '@auxx/lib/inboxes'
import { recordIdSchema, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
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

/** Schema for managing integrations - uses RecordId for consistency */
const integrationSchema = z.object({
  recordId: recordIdSchema,
  integrationId: z.string(),
  isDefault: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

export const inboxRouter = createTRPCRouter({
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
   * Create a new inbox
   */
  create: protectedProcedure.input(createInboxSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    const created = await inboxService.createInbox(input)
    await recordAuditFromCtx(ctx, {
      category: 'integrations',
      action: 'inbox.created',
      targetType: 'Inbox',
      targetId: (created as { id?: string } | null)?.id ?? null,
      metadata: { name: input.name },
    })
    return created
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
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.deleted',
        targetType: 'Inbox',
        targetId: input.inboxId,
      })
      return { success: true }
    }),

  /**
   * Add an integration to an inbox
   */
  addIntegration: protectedProcedure.input(integrationSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const inboxService = new InboxService(ctx.db, organizationId, userId)

    const result = await inboxService.addIntegration(
      input.recordId,
      input.integrationId,
      input.isDefault,
      input.settings
    )
    await recordAuditFromCtx(ctx, {
      category: 'integrations',
      action: 'inbox.integration_added',
      targetType: 'Inbox',
      targetId: String(input.recordId),
      metadata: { integrationId: input.integrationId },
    })
    return result
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
      const result = await inboxService.removeIntegration(recordId, input.integrationId)
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.integration_removed',
        targetType: 'Inbox',
        targetId: input.inboxId,
        metadata: { integrationId: input.integrationId },
      })
      return result
    }),
})
