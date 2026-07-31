// apps/web/src/server/api/routers/mailView.ts

import { getCachedUserInstanceGrants, onCacheEvent } from '@auxx/lib/cache'
import { conditionGroupsSchema } from '@auxx/lib/conditions/client'
import { MailViewService } from '@auxx/lib/mail-views'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { countSavedViewsUsed } from '@auxx/lib/table-views'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * The mail front door (plan 40 §5.3), the same one `thread.ts` and `draft.ts`
 * build on.
 *
 * §5.3's table names the thread router; saved mail views were never enumerated
 * and this file had **no front door at all** — every procedure was a bare
 * `protectedProcedure` with no `PermissionKey` anywhere in it. The worst of the
 * ten is `getThreads`: a paginated thread-reading surface, reachable by any
 * authenticated member of the org, including one whose profile sets
 * `inboxes: None`. `inboxes: None` is supposed to mean **none** (§1.4).
 *
 * Coarse and wholesale, exactly like `thread.ts`:
 *
 *  - **Every procedure, not most of them.** `permissionProcedure` asserts in
 *    MIDDLEWARE, before the handler body, so one procedure left on
 *    `protectedProcedure` leaves the surface open; mixing builders inside one
 *    router is how this repo has lost gates before.
 *  - **No tiering.** There is no thread-authority axis (§1.1) — seeing a thread
 *    at `full` lens IS the permission to act on it — so a saved view's create /
 *    update / delete take the same rung as its reads.
 *  - **No inbox-instance assert** (§1.4). A dispatch-org assignee holds no
 *    `ResourceAccess` row on the inbox by construction, and `getThreads` is
 *    exactly the surface they use; an instance gate here would deny precisely
 *    the people the model exists to serve. Thread content stays gated by
 *    `MailViewService`'s `UserInstanceGrants` lens predicate, which every
 *    procedure in this file already constructs.
 *
 * The per-view ownership checks below (`userId === caller`, `isShared`) are a
 * different question — who owns this saved filter — and are unchanged.
 *
 * `inboxes.view` carries no `featureKey` (`registry.ts`), so
 * `permissionProcedure`'s plan-AND is a no-op here.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

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
  create: mailProcedure.input(createMailViewSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id

    // Check saved view limit (only for shared/team views)
    if (input.isShared) {
      const featureService = new FeaturePermissionService(ctx.db)
      const viewLimit = await featureService.getLimit(organizationId, FeatureKey.savedViews)
      if (typeof viewLimit === 'number' && viewLimit >= 0) {
        const current = await countSavedViewsUsed(ctx.db, organizationId)
        if (current >= viewLimit) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You have reached your saved view limit (${viewLimit}). Upgrade your plan to create more views.`,
          })
        }
      }
    }

    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )
    const result = await mailViewService.createMailView(userId, input)
    await onCacheEvent('mail-view.changed', { orgId: organizationId, userId })
    return result
  }),

  // Get a mail view by ID
  getById: mailProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

    const mailView = await mailViewService.getMailView(input.id)

    if (!mailView) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
    }

    return mailView
  }),

  // Get all mail views for the current user
  getUserMailViews: mailProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

    return await mailViewService.getUserMailViews(userId)
  }),

  // Get shared mail views for the organization
  getSharedMailViews: mailProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

    return await mailViewService.getSharedMailViews()
  }),

  // Get all accessible mail views (user's own + shared)
  getAllAccessibleMailViews: mailProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

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
  update: mailProcedure.input(updateMailViewSchema).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

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

    const result = await mailViewService.updateMailView(input.id, input.data)
    await onCacheEvent('mail-view.changed', { orgId: organizationId, userId: ctx.session.user.id })
    return result
  }),

  // Delete a mail view
  delete: mailProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

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

    const result = await mailViewService.deleteMailView(input.id)
    await onCacheEvent('mail-view.changed', {
      orgId: organizationId,
      userId: ctx.session.user.id,
    })
    return result
  }),

  // Set a mail view as default
  setDefault: mailProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const mailViewService = new MailViewService(
      organizationId,
      ctx.db,
      await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
    )

    // Check if the user has access to this view
    const existingView = await mailViewService.getMailView(input.id)

    if (!existingView) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail view not found' })
    }

    return await mailViewService.setMailViewAsDefault(input.id, userId)
  }),

  // Toggle pinned status
  togglePinned: mailProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const mailViewService = new MailViewService(
        organizationId,
        ctx.db,
        await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
      )

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
  getThreads: mailProcedure
    .input(
      z.object({
        mailViewId: z.string(),
        page: z.number().default(1),
        pageSize: z.number().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const mailViewService = new MailViewService(
        organizationId,
        ctx.db,
        await getCachedUserInstanceGrants(ctx.session.user.id, organizationId)
      )

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

      return await mailViewService.getThreadsByMailView(
        input.mailViewId,
        {
          page: input.page,
          pageSize: input.pageSize,
        },
        ctx.session.user.id
      )
    }),
})
