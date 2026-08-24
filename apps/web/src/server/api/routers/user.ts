import { database as db, schema } from '@auxx/database'
import {
  getCachedMembers,
  getOrgCache,
  getUserCache,
  isAgentUser,
  onCacheEvent,
} from '@auxx/lib/cache'
import {
  createThumbnailCleanupPort,
  deleteAsset,
  getAssetDownloadRef,
} from '@auxx/lib/files/server'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { toFilesCtx, toFilesDownloadDeps, toFilesWriteDeps } from '~/server/lib/files-ctx'

export const userRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        /**
         * Set by the onboarding personal step. It belongs on THIS mutation rather
         * than better-auth's `updateUser` because only this path fires
         * `onCacheEvent('user.updated')` below — and `completedOnboarding` is read
         * back out of the cached `userProfile` to build the dehydrated state that
         * gates `/app`. Writing it anywhere else leaves that cache stale and loops
         * the user between `/app` and `/onboarding`.
         */
        completedOnboarding: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: any = {}

      // Update name directly if provided
      if (input.name !== undefined) updates.name = input.name

      // Update separate fields
      if (input.firstName !== undefined) updates.firstName = input.firstName
      if (input.lastName !== undefined) updates.lastName = input.lastName
      if (input.completedOnboarding !== undefined)
        updates.completedOnboarding = input.completedOnboarding

      // Update full name field as well for display purposes (only if name wasn't directly set)
      if (
        input.name === undefined &&
        (input.firstName !== undefined || input.lastName !== undefined)
      ) {
        const [user] = await db
          .select({ firstName: schema.User.firstName, lastName: schema.User.lastName })
          .from(schema.User)
          .where(eq(schema.User.id, ctx.session.user.id))
          .limit(1)
        updates.name =
          `${input.firstName || user?.firstName || ''} ${input.lastName || user?.lastName || ''}`.trim()
      }

      const [updatedUser] = await db
        .update(schema.User)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.User.id, ctx.session.user.id))
        .returning()

      await onCacheEvent('user.updated', {
        orgId: ctx.session.organizationId,
        userId: ctx.session.user.id,
      })

      return updatedUser
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session

    // Fetch user with selected fields
    const [user] = await db
      .select({
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
        emailVerified: schema.User.emailVerified,

        image: schema.User.image,
        avatarAssetId: schema.User.avatarAssetId,
        defaultOrganizationId: schema.User.defaultOrganizationId,
        completedOnboarding: schema.User.completedOnboarding,
        phoneNumber: schema.User.phoneNumber,
        phoneNumberVerified: schema.User.phoneNumberVerified,
        firstName: schema.User.firstName,
        lastName: schema.User.lastName,
        lastLoginAt: schema.User.lastLoginAt,
        preferredTimezone: schema.User.preferredTimezone,
      })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })

    // Fetch user memberships with organization details separately
    const memberships = await db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        organization: {
          id: schema.Organization.id,
          name: schema.Organization.name,
          website: schema.Organization.website,
          domains: schema.Organization.domains,
        },
      })
      .from(schema.OrganizationMember)
      .leftJoin(
        schema.Organization,
        eq(schema.Organization.id, schema.OrganizationMember.organizationId)
      )
      .where(eq(schema.OrganizationMember.userId, userId))

    // Fetch user settings from cache
    const settings = await getUserCache().get(userId, 'userSettings', organizationId)

    const featureService = new FeaturePermissionService(db)
    const features = await featureService.getOrganizationFeaturesMap(organizationId)

    const channels = await getOrgCache().get(organizationId, 'channels')
    const hasIntegrations = channels.length > 0

    // Fetch avatar URL if user has an avatar asset.
    //
    // BEST-EFFORT, deliberately: `MediaAssetService.getDownloadUrl` swallowed
    // every failure and returned `null`, because one broken avatar must not fail
    // the whole `me` query that gates the app shell. `getAssetDownloadRef`
    // returns a `Result`, so the swallow is explicit here rather than hidden in
    // a service — this is the one place it is correct not to rethrow.
    let avatarUrl: string | null = null
    if (user.avatarAssetId) {
      const ref = await getAssetDownloadRef(
        toFilesCtx(ctx),
        toFilesDownloadDeps(ctx),
        user.avatarAssetId
      )
      avatarUrl = ref.isOk() && ref.value.type === 'url' ? ref.value.url : null
    }

    // Return user object with settings property
    return { ...user, memberships, settings, features, hasIntegrations, image: avatarUrl }
  }),

  teamMembers: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required' })
    }

    const members = await getCachedMembers(organizationId)

    return members.map((m) => ({
      id: m.user?.id ?? null,
      name: m.user?.name ?? null,
      email: m.user?.email ?? null,
    }))
  }),

  removeAvatar: protectedProcedure
    .input(
      z
        .object({
          /**
           * When set, target the synthetic User backing an Agent in this org
           * instead of the calling user. Requires the caller to be an org
           * admin/owner — same authorization shape as the upload path in
           * `UserProfileProcessor.validateEntityAccess`.
           */
          targetUserId: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const targetUserId = input?.targetUserId ?? userId

      if (targetUserId !== userId) {
        const isAgent = await isAgentUser(organizationId, targetUserId)
        if (!isAgent) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "Cannot remove another user's avatar",
          })
        }
        // Masking/visibility — determining who can edit agent avatars (plan 21 §5.2).
        const callerIsAdmin = await isAdminOrOwner(organizationId, userId)
        if (!callerIsAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Admin required to update agent avatars',
          })
        }
      }

      const [user] = await db
        .select({ avatarAssetId: schema.User.avatarAssetId })
        .from(schema.User)
        .where(eq(schema.User.id, targetUserId))
        .limit(1)

      if (!user?.avatarAssetId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No avatar to remove' })
      }
      // Bound outside the transaction callback: TypeScript drops the narrowing
      // from the guard above once the property is read inside a closure.
      const avatarAssetId = user.avatarAssetId

      // The asset soft-delete and its thumbnail sweep are ONE transaction,
      // opened here. `MediaAssetService.delete` opened it inside lib and built
      // the thumbnail collaborator with a dynamic import; `deleteAsset` takes
      // the port as a parameter, so it is constructed at this composition site
      // and bound to the SAME `tx` — sweeping on the outer pool from inside the
      // transaction is the stale-read bug the refactor exists to kill.
      //
      // The `User.avatarAssetId` clear below stays OUTSIDE this transaction,
      // exactly where the facade left it. Widening the boundary is a correctness
      // improvement, but it is not this sweep's change to make.
      const filesCtx = toFilesCtx(ctx)
      const deleted = await ctx.db.transaction(async (tx) => {
        const txCtx = { ...filesCtx, db: tx }
        return deleteAsset(
          tx,
          txCtx,
          {
            ...toFilesWriteDeps(),
            thumbnails: createThumbnailCleanupPort(txCtx, {
              ...toFilesWriteDeps(),
              storage: toFilesDownloadDeps(ctx).storage,
            }),
          },
          avatarAssetId
        )
      })
      if (deleted.isErr()) throw deleted.error

      await db
        .update(schema.User)
        .set({ avatarAssetId: null, updatedAt: new Date() })
        .where(eq(schema.User.id, targetUserId))

      await onCacheEvent('user.updated', { orgId: organizationId, userId: targetUserId })

      return { success: true }
    }),

  updateTimezone: protectedProcedure
    .input(
      z.object({
        timezone: z.string().min(1, 'Timezone is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // Validate timezone string (basic check)
      const validTimezonePattern = /^[A-Za-z]+\/[A-Za-z_]+$/
      if (!validTimezonePattern.test(input.timezone) && input.timezone !== 'UTC') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid timezone format. Expected format: "America/Los_Angeles" or "UTC"',
        })
      }

      const [updatedUser] = await db
        .update(schema.User)
        .set({
          preferredTimezone: input.timezone,
          updatedAt: new Date(),
        })
        .where(eq(schema.User.id, userId))
        .returning()

      await onCacheEvent('user.updated', { orgId: ctx.session.organizationId, userId })

      return updatedUser
    }),
})
