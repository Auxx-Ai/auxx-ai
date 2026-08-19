// apps/web/src/server/api/routers/organization.ts

import { RESERVED_ORGANIZATION_HANDLES } from '@auxx/config'
import { schema } from '@auxx/database'
import { OrganizationType } from '@auxx/database/enums'
import { onCacheEvent } from '@auxx/lib/cache'
import { DehydrationService } from '@auxx/lib/dehydration'
import {
  getMembership,
  getOrganizationMembers,
  getPendingInvitations,
  isMember,
} from '@auxx/lib/members'
import { OrganizationService } from '@auxx/lib/organizations'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import { seedDocumentBusinessFromProfile } from '@auxx/lib/settings'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import {
  createTRPCRouter,
  notDemo,
  ownerProcedure,
  protectedProcedure,
  publicProcedure,
} from '~/server/api/trpc'
import { setUserDefaultOrganization } from '~/server/auth/set-default-organization'

const logger = createScopedLogger('api-organization')

export const organizationRouter = createTRPCRouter({
  /** Create a new organization */
  create: protectedProcedure
    .use(notDemo('create organizations'))
    .input(
      z.object({
        name: z.string().min(1, 'Organization name is required'),
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .max(32, 'Handle must be at most 32 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens'),
        type: z.enum(OrganizationType).default('TEAM'),
        website: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const userEmail = ctx.session.user.email
      const { name, handle, type, website } = input

      try {
        const orgService = new OrganizationService(ctx.db)
        const result = await orgService.createOrganization({
          userId,
          userEmail: userEmail ?? undefined,
          name,
          handle,
          type,
          website,
        })
        await recordAuditFromCtx(ctx, {
          organizationId: result.id,
          category: 'settings',
          action: 'org.created',
          targetType: 'Organization',
          targetId: result.id,
          metadata: { name, handle, type },
        })
        return result
      } catch (error) {
        logger.error('Failed to create organization', { error, userId, name, handle })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create organization. Please try again.',
        })
      }
    }),

  /** Update organization details */
  update: protectedProcedure
    .use(notDemo('update organizations'))
    .input(
      z.object({
        name: z.string().min(1).optional(),
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .max(32, 'Handle must be at most 32 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens')
          .optional(),
        type: z.enum(OrganizationType).optional(),
        website: z.string().optional(),
        domains: z.array(z.string()).optional(),
        completedOnboarding: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const userEmail = ctx.session.user.email
      const { organizationId } = ctx.session
      const { name, handle, type, website, domains, completedOnboarding } = input

      // Capability gate, not role (plan 21 §4.1/§4.2): the settings area's own
      // key is what a profile turns off.
      await requirePermission(userId, organizationId, PermissionKey.settingsManage)

      // Validate handle is not reserved
      if (handle !== undefined && RESERVED_ORGANIZATION_HANDLES.includes(handle as any)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This handle is reserved and cannot be used',
        })
      }

      if (handle !== undefined) {
        const [existingHandle] = await ctx.db
          .select({ id: schema.Organization.id })
          .from(schema.Organization)
          .where(eq(schema.Organization.handle, handle))
          .limit(1)

        if (existingHandle && existingHandle.id !== organizationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This handle is already taken',
          })
        }
      }

      // Build update data object
      const updateData: any = {}
      if (name !== undefined) updateData.name = name
      if (handle !== undefined) updateData.handle = handle
      if (type !== undefined) updateData.type = type
      if (website !== undefined) updateData.website = website
      if (domains !== undefined) updateData.domains = domains
      if (completedOnboarding !== undefined) updateData.completedOnboarding = completedOnboarding

      const [organization] = await ctx.db
        .update(schema.Organization)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(schema.Organization.id, organizationId))
        .returning()

      if (organization?.handle) {
        const orgService = new OrganizationService(ctx.db)
        await orgService.ensureForwardingAddressIntegration({
          organizationId,
          userId,
          userEmail: userEmail ?? undefined,
          handle: organization.handle,
        })
      }

      // Onboarding's last step is the first moment the org profile actually holds a name and
      // website — the signup path created the row with `name: ''`, so `seedNewOrganization`'s
      // pass had nothing to copy. Fill the blank `documents.business` fields now, before the
      // first quote or invoice is ever rendered. Fill-blanks-only, so it can never clobber a
      // name typed in Dispatch → General; fires its own `org.settings.changed`.
      if (name !== undefined || website !== undefined) {
        await seedDocumentBusinessFromProfile({ organizationId, db: ctx.db })
      }

      // Deliberately does NOT touch `User.completedOnboarding`. The user-level flag
      // is owned by the onboarding personal step (`user.updateProfile`), which is
      // the only write that fires `onCacheEvent('user.updated')`. This handler emits
      // `org.updated` → ['orgProfile'] only, so writing the user flag here updated
      // the row while leaving the cached `userProfile` stale — which loops the user
      // between `/app` (reads the cache) and `/onboarding` (reads the DB).
      // Organization onboarding and personal onboarding are independent gates.

      // Invalidate dehydration cache for all org members (org data visible to all)
      await onCacheEvent('org.updated', { orgId: organizationId })

      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'organization.updated',
        targetType: 'Organization',
        targetId: organizationId,
        newState: updateData,
      })

      return organization
    }),

  /** Get current user's organizations */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const memberships = await ctx.db.query.OrganizationMember.findMany({
      where: eq(schema.OrganizationMember.userId, userId),
      with: {
        organization: true,
      },
    })
    return memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    }))
  }),

  /** Get organization details by ID */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id
    const orgId = input.id

    // Verify user is part of this organization first
    const membership = await getMembership(userId, orgId, ctx.db)

    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' })
    }

    // Fetch organization details
    const [organization] = await ctx.db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        type: schema.Organization.type,
        website: schema.Organization.website,
        domains: schema.Organization.domains,
        createdAt: schema.Organization.createdAt,
        updatedAt: schema.Organization.updatedAt,
        createdById: schema.Organization.createdById,
      })
      .from(schema.Organization)
      .where(eq(schema.Organization.id, orgId))
      .limit(1)

    if (!organization) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
    }

    // Fetch active members and pending invitations using the service
    const [members, pendingInvitations] = await Promise.all([
      getOrganizationMembers(orgId, ctx.db),
      getPendingInvitations(orgId, ctx.db),
    ])

    return {
      ...organization,
      members,
      pendingInvitations,
      userRole: membership.role,
    }
  }),

  /** Get organization by creator */
  getOrganization: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const [org] = await ctx.db
      .select()
      .from(schema.Organization)
      .where(eq(schema.Organization.createdById, userId))
      .limit(1)
    return org
  }),

  /** Get onboarding status for current organization and user */
  getOnboardingStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const { organizationId } = ctx.session

    // Fetch user and organization in parallel
    const [[user], [org]] = await Promise.all([
      ctx.db
        .select({ completedOnboarding: schema.User.completedOnboarding })
        .from(schema.User)
        .where(eq(schema.User.id, userId))
        .limit(1),
      ctx.db
        .select({
          completedOnboarding: schema.Organization.completedOnboarding,
          handle: schema.Organization.handle,
        })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1),
    ])

    const userCompletedOnboarding = user?.completedOnboarding ?? false
    const orgCompletedOnboarding = org?.completedOnboarding ?? false
    const orgHasHandle = !!org?.handle

    // Determine starting step based on completion status
    let startStep: 1 | 2 | 3 = 1
    if (userCompletedOnboarding) {
      startStep = orgHasHandle ? 3 : 2
    }

    return {
      userCompletedOnboarding,
      orgCompletedOnboarding,
      orgHasHandle,
      startStep,
    }
  }),

  /** Check if a handle is available (uses publicProcedure — no org context needed, just auth) */
  checkHandleAvailability: publicProcedure
    .input(
      z.object({
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .max(32, 'Handle must be at most 32 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens'),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.session?.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' })
      }
      // Check if handle is reserved
      if (RESERVED_ORGANIZATION_HANDLES.includes(input.handle as any)) {
        return {
          available: false,
          reserved: true,
        }
      }

      const [existing] = await ctx.db
        .select({ id: schema.Organization.id })
        .from(schema.Organization)
        .where(eq(schema.Organization.handle, input.handle))
        .limit(1)

      return {
        available: !existing,
        reserved: false,
        currentOrgId: existing?.id,
      }
    }),

  /** Switch user's default organization */
  setDefault: protectedProcedure
    .use(notDemo('switch organizations'))
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId: currentOrganizationId } = ctx.session
      const { organizationId } = input

      console.log('SWITCH TO:', organizationId, 'FROM:', currentOrganizationId)
      // Verify membership
      const isOrgMember = await isMember(userId, organizationId, ctx.db)

      if (!isOrgMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' })
      }

      // Update default organization + bust the user cache so the next session read
      // (customSession derives defaultOrganizationId from the cached userProfile) reflects it.
      await setUserDefaultOrganization(ctx.db, userId, organizationId)

      await recordAuditFromCtx(ctx, {
        category: 'auth',
        action: 'organization.switched',
        targetType: 'Organization',
        targetId: organizationId,
        metadata: { fromOrganizationId: currentOrganizationId, toOrganizationId: organizationId },
      })

      return { success: true, organizationId }
    }),

  /** Leave organization */
  leave: protectedProcedure
    .use(notDemo('leave organizations'))
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const { organizationId } = input

      // Check if user is a member
      const membership = await getMembership(userId, organizationId, ctx.db)

      if (!membership) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'You are not a member of this organization',
        })
      }

      // Check if user is the only owner
      if (membership.role === 'OWNER') {
        const owners = await ctx.db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.organizationId, organizationId),
              eq(schema.OrganizationMember.role, 'OWNER')
            )
          )

        if (owners.length <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You are the only owner. Transfer ownership before leaving.',
          })
        }
      }

      // Remove the membership
      await ctx.db
        .delete(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.userId, userId),
            eq(schema.OrganizationMember.organizationId, organizationId)
          )
        )

      // If this was the user's default organization, set a new default if available
      const [user] = await ctx.db
        .select({ defaultOrganizationId: schema.User.defaultOrganizationId })
        .from(schema.User)
        .where(eq(schema.User.id, userId))
        .limit(1)

      if (user?.defaultOrganizationId === organizationId) {
        const [anotherMembership] = await ctx.db
          .select({ organizationId: schema.OrganizationMember.organizationId })
          .from(schema.OrganizationMember)
          .where(eq(schema.OrganizationMember.userId, userId))
          .limit(1)

        await ctx.db
          .update(schema.User)
          .set({
            defaultOrganizationId: anotherMembership?.organizationId || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.User.id, userId))
      }

      // Offboarding (mail-permissions §11.4): stop sync on the leaver's
      // personal channels; their personal inbox stays for admin claim/delete.
      try {
        const { disconnectPersonalChannelsForUser } = await import('@auxx/lib/channels')
        await disconnectPersonalChannelsForUser(organizationId, userId)
      } catch (error) {
        logger.error('Failed to disconnect personal channels for leaving member', {
          organizationId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      await onCacheEvent('member.removed', { orgId: organizationId, userId })

      await recordAuditFromCtx(ctx, {
        organizationId,
        category: 'members',
        action: 'member.left',
        targetType: 'User',
        targetId: userId,
      })

      return { success: true }
    }),

  /** Delete organization — rank-shaped, Owner only (plan 21 §2.b.4). The
   * service re-verifies ownership (`verifyOwnerOrFail`); this gate makes the
   * rank requirement explicit at the router. */
  delete: ownerProcedure
    .input(
      z.object({
        organizationId: z.string(),
        confirmationEmail: z.string().email('Invalid email format for confirmation.'),
      })
    )
    .use(notDemo('delete organizations'))
    .mutation(async ({ ctx, input }) => {
      const { user: sessionUser } = ctx.session
      const orgService = new OrganizationService(ctx.db)

      try {
        const result = await orgService.deleteOrganization({
          organizationId: input.organizationId,
          requestingUserId: sessionUser.id,
          confirmationEmail: input.confirmationEmail,
        })

        // Invalidate dehydration cache if user was not deleted
        if (!result.userDeleted) {
          const dehydrationService = new DehydrationService()
          await dehydrationService.invalidateUser(sessionUser.id)
        }

        await recordAuditFromCtx(ctx, {
          organizationId: input.organizationId,
          category: 'settings',
          action: 'org.delete_requested',
          targetType: 'Organization',
          targetId: input.organizationId,
        })

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during delete:', {
          error,
          organizationId: input.organizationId,
          userId: sessionUser.id,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete organization.',
        })
      }
    }),
})
