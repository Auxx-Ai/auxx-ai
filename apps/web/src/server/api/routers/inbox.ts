// apps/web/src/server/api/routers/inbox.ts

import { getCachedUserMailVisibility, getOrgCache } from '@auxx/lib/cache'
import { claimPersonalInbox, deletePersonalInbox } from '@auxx/lib/channels'
import { InboxService } from '@auxx/lib/inboxes'
import { inboxLensFor, type Lens } from '@auxx/lib/permissions/visibility'
import { ThreadMutationService } from '@auxx/lib/threads'
import { type RecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Inbox-manage gate: org admin or an inbox `admin` grant (Manager delegation).
 * Personal-channel owners hold the admin grant on their own personal inbox.
 */
async function requireInboxManageAccess(
  inboxService: InboxService,
  recordId: RecordId,
  userId: string
): Promise<void> {
  if (!(await inboxService.canManageInboxAccess(recordId, userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins or inbox managers can manage this inbox',
    })
  }
}

/** Schema for creating an inbox */
const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
  defaultLens: z.enum(['none', 'metadata', 'subject', 'full']).optional(),
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
   * The caller's effective lens per inbox (mail-permissions §6.4) — drives
   * the FE's per-lens realtime channel subscriptions and, later, redacted
   * rendering. Two org-cache reads, no DB. Inboxes at `none` are omitted.
   * `isAdmin` additionally authorizes the residual `none` (triage) channel.
   */
  myLenses: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const [viewer, inboxes] = await Promise.all([
      getCachedUserMailVisibility(userId, organizationId),
      getOrgCache().get(organizationId, 'inboxes'),
    ])
    const lenses: Record<string, Exclude<Lens, 'none'>> = {}
    for (const inbox of inboxes) {
      const lens = inboxLensFor(viewer, inbox.id)
      if (lens !== 'none') lenses[inbox.id] = lens
    }
    return { isAdmin: viewer.isAdmin, lenses }
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

      await requireInboxManageAccess(inboxService, toRecordId('inbox', input.inboxId), userId)

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
   * Claim an ORPHANED personal inbox (mail-permissions §11.4): clears the
   * personal marker + owner, converting it into a normal restricted org
   * inbox. Rejected while the owner is still a member.
   */
  claimPersonal: adminProcedure
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await claimPersonalInbox({
        organizationId,
        adminUserId: ctx.session.user.id,
        inboxId: input.inboxId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.personal.claimed',
        targetType: 'Inbox',
        targetId: input.inboxId,
      })
      return { success: true }
    }),

  /**
   * Delete an ORPHANED personal inbox (§11.4): destroys its channels'
   * threads/messages and the inbox itself. Rejected while the owner is
   * still a member.
   */
  deletePersonal: adminProcedure
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await deletePersonalInbox({
        organizationId,
        adminUserId: ctx.session.user.id,
        inboxId: input.inboxId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.personal.deleted',
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

    await requireInboxManageAccess(inboxService, input.recordId, userId)

    // Personal channels are permanently bound to their personal inbox (§11):
    // the only sanctioned exits are admin claim or delete, and nothing routes
    // INTO a personal inbox via this endpoint (provisioning links internally).
    const [targetInbox, currentInbox] = await Promise.all([
      inboxService.getInbox(input.recordId),
      inboxService.getIntegrationInbox(input.integrationId),
    ])
    if (currentInbox?.isPersonal) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Personal channels cannot be re-routed' })
    }
    if (targetInbox?.isPersonal) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Channels cannot be routed into a personal inbox',
      })
    }

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
   * Count an integration's threads currently sitting in a given inbox.
   * Used to size the "move existing conversations?" prompt when re-routing a
   * channel to a different inbox.
   */
  countMovableThreads: protectedProcedure
    .input(z.object({ integrationId: z.string(), fromInboxRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const viewer = await getCachedUserMailVisibility(userId, organizationId)
      const threadMutation = new ThreadMutationService(
        organizationId,
        ctx.db,
        undefined,
        userId,
        viewer
      )
      return threadMutation.countIntegrationThreadsInInbox(
        input.integrationId,
        input.fromInboxRecordId
      )
    }),

  /**
   * Move an integration's existing conversations from one inbox to another.
   * Re-routing the channel ({@link addIntegration}) only affects future mail;
   * this relocates the threads that are already in `fromInboxRecordId`.
   */
  moveIntegrationThreads: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        fromInboxRecordId: recordIdSchema,
        toInboxRecordId: recordIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const socketId = ctx.headers?.get?.('x-realtime-socket-id') ?? undefined

      // Moving threads touches both inboxes — require manage access on each side.
      const inboxService = new InboxService(ctx.db, organizationId, userId)
      await requireInboxManageAccess(inboxService, input.fromInboxRecordId, userId)
      await requireInboxManageAccess(inboxService, input.toInboxRecordId, userId)

      // Threads may not be moved into or out of a personal inbox (§11 isolation).
      const [fromInbox, toInbox] = await Promise.all([
        inboxService.getInbox(input.fromInboxRecordId),
        inboxService.getInbox(input.toInboxRecordId),
      ])
      if (fromInbox?.isPersonal || toInbox?.isPersonal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Conversations cannot be moved into or out of a personal inbox',
        })
      }

      const viewer = await getCachedUserMailVisibility(userId, organizationId)
      const threadMutation = new ThreadMutationService(
        organizationId,
        ctx.db,
        socketId,
        userId,
        viewer
      )

      const result = await threadMutation.moveIntegrationThreadsToInbox(
        input.integrationId,
        input.fromInboxRecordId,
        input.toInboxRecordId
      )
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.threads_moved',
        targetType: 'Inbox',
        targetId: String(input.toInboxRecordId),
        metadata: {
          integrationId: input.integrationId,
          fromInboxRecordId: String(input.fromInboxRecordId),
          count: result.count,
        },
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
      await requireInboxManageAccess(inboxService, recordId, userId)
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
