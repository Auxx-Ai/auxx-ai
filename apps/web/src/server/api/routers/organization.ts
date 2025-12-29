import { z } from 'zod'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc'
import { schema } from '@auxx/database'
import { and, eq, ilike, desc, asc, inArray, gt, or } from 'drizzle-orm'
import { OrganizationRole, OrganizationType } from '@auxx/database/enums'
import { TRPCError } from '@trpc/server'
import { createScopedLogger } from '@auxx/logger'
import { MemberService } from '@auxx/lib/members'
import { OrganizationService } from '@auxx/lib/organizations'

const logger = createScopedLogger('api-organization')

/** Reserved handles that cannot be used for organization URLs */
const RESERVED_HANDLES = [
  'api',
  'auxx',
  'auxxai',
  'welcome',
  'integrations',
  'auth',
  'admin',
  'awac',
  'atac',
  'redirect',
  'workspaces',
  'authorize',
  'app-invites',
  '2fa-recovery',
  '2fa',
  'account-lock',
  'account-recover',
  'account-recovery',
  'account-unlock',
  'account-verify',
  'account',
  'activate',
  'auth-callback',
  'auth-login',
  'auth-logout',
  'auth-register',
  'auth-reset-password',
  'auth-signup',
  'auth-token',
  'auth-verify',
  'change-password',
  'confirm-email',
  'consent',
  'email-confirm',
  'email-verification',
  'forgot-password',
  'jwks-json',
  'jwks',
  'login',
  'logout',
  'oauth-access-token',
  'oauth-authorize',
  'oauth-callback',
  'oauth-consent',
  'oauth-error',
  'oauth-introspect',
  'oauth-login',
  'oauth-redirect',
  'oauth-refresh-token',
  'oauth-revoke',
  'oauth-token',
  'oauth-userinfo',
  'oauth',
  'openid-authorize',
  'openid-callback',
  'openid-config',
  'openid-configuration',
  'openid-connect',
  'openid-introspect',
  'openid-jwks',
  'openid-logout',
  'openid-redirect',
  'openid-revoke',
  'openid-token',
  'openid-userinfo',
  'openid',
  'password-change',
  'password-recovery',
  'password-reset',
  'profile',
  'recover-password',
  'refresh-token',
  'register',
  'reset-password',
  'saml-acs',
  'saml-idp',
  'saml-login',
  'saml-metadata',
  'saml-slo',
  'saml-sp',
  'saml-sso-login',
  'saml-sso',
  'saml',
  'session',
  'sessions',
  'signin',
  'signout',
  'signup',
  'token',
  'tokens',
  'two-factor-recovery',
  'two-factor',
  'user-2fa',
  'user-account',
  'user-activate',
  'user-change-password',
  'user-forgot-password',
  'user-lock',
  'user-login',
  'user-logout',
  'user-profile',
  'user-recover-account',
  'user-recover-password',
  'user-recover',
  'user-register',
  'user-reset-password',
  'user-signin',
  'user-signout',
  'user-signup',
  'user-unlock',
  'user-verify-email',
  'user-verify',
  'verify-2fa',
  'verify-email',
  'verify',
  'well-known',
  'admin-dashboard',
  'administrator',
  'api-v1',
  'api-v2',
  'backend',
  'backup',
  'backups',
  'bin',
  'cgi-bin',
  'cmd',
  'config',
  'configuration',
  'control-panel',
  'controlpanel',
  'dashboard',
  'database',
  'db',
  'debug',
  'env',
  'graphql',
  'hidden',
  'internal-api',
  'log',
  'logs',
  'manage',
  'management',
  'private-api',
  'private',
  'script',
  'scripts',
  'secret',
  'secure',
  'service',
  'services',
  'settings',
  'super-user',
  'superuser',
  'system-config',
  'system',
  '404',
  '500',
  'error',
  'download',
  'downloads',
  'faq',
  'help',
  'privacy',
  'security',
  'terms',
  'uploads',
  'ds-store',
  'git',
  'hg',
  'htaccess',
  'htpasswd',
  'svn',
] as const
export const organizationRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Organization name is required'),
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens'),
        type: z.enum(OrganizationType).default('TEAM'),
        website: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const userEmail = ctx.session.user.email
      const { name, handle, type, website } = input

      logger.info('Creating new organization', { userId, name, handle, type })

      try {
        // Validate handle is not reserved
        if (RESERVED_HANDLES.includes(handle as any)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This handle is reserved and cannot be used',
          })
        }

        // Verify handle is available (double-check server-side)
        const [existingHandle] = await ctx.db
          .select({ id: schema.Organization.id })
          .from(schema.Organization)
          .where(eq(schema.Organization.handle, handle))
          .limit(1)

        if (existingHandle) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This handle is already taken',
          })
        }

        // Step 1 & 2: Create organization and membership in transaction
        const organization = await ctx.db.transaction(async (tx) => {
          // Create organization
          const [org] = await tx
            .insert(schema.Organization)
            .values({
              name,
              handle,
              type,
              website: website || null,
              createdById: userId,
              updatedAt: new Date(),
            })
            .returning()

          // Create organization membership with OWNER role
          await tx.insert(schema.OrganizationMember).values({
            userId,
            organizationId: org!.id,
            role: OrganizationRole.OWNER,
            status: 'ACTIVE',
            updatedAt: new Date(),
          })

          return org
        })

        const organizationId = organization!.id
        logger.info('Organization and membership created', { organizationId, handle })

        // Step 3: Create system user for the organization
        const { SystemUserService } = await import('@auxx/lib/users')
        await SystemUserService.createSystemUserForOrganization(
          organizationId,
          organization!.name || undefined
        )
        logger.info('System user created', { organizationId })

        // Step 4: Set as default organization for the user
        await ctx.db
          .update(schema.User)
          .set({
            defaultOrganizationId: organizationId,
            updatedAt: new Date(),
          })
          .where(eq(schema.User.id, userId))

        logger.info('Set as default organization', { organizationId, userId })

        // Step 5: Seed organization with defaults (async, don't block response)
        // Use OrganizationHooks instead of directly calling seeder
        const { OrganizationHooks } = await import('@auxx/lib/organizations')
        const hooks = new OrganizationHooks(ctx.db)

        // Run seeding asynchronously - don't await
        hooks
          .afterOrganizationCreated(organizationId, userId, userEmail ?? undefined)
          .catch((error) => {
            logger.error('Failed to seed organization (non-blocking)', {
              organizationId,
              error,
            })
          })

        logger.info('Organization creation complete', { organizationId, handle })

        return {
          id: organization!.id,
          name: organization!.name,
          handle: organization!.handle,
          type: organization!.type,
          website: organization!.website,
        }
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
  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens')
          .optional(),
        type: z.enum(OrganizationType).optional(),
        website: z.string().optional(),
        emailDomain: z.string().optional(),
        completedOnboarding: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const { organizationId } = ctx.session
      const { name, handle, type, website, emailDomain, completedOnboarding } = input

      // Validate handle is not reserved
      if (handle !== undefined && RESERVED_HANDLES.includes(handle as any)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This handle is reserved and cannot be used',
        })
      }

      // Build update data object
      const updateData: any = {}
      if (name !== undefined) updateData.name = name
      if (handle !== undefined) updateData.handle = handle
      if (type !== undefined) updateData.type = type
      if (website !== undefined) updateData.website = website
      if (emailDomain !== undefined) updateData.email_domain = emailDomain
      // Update the organization (Drizzle)
      const [organization] = await ctx.db
        .update(schema.Organization)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(schema.Organization.id, organizationId))
        .returning()
      // Update user onboarding status if specified
      if (completedOnboarding) {
        await ctx.db
          .update(schema.User)
          .set({ completedOnboarding: true, updatedAt: new Date() })
          .where(eq(schema.User.id, userId))
      }
      return organization
    }),
  // Get current user's organizations
  getMyOrganizations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const rows = await ctx.db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        type: schema.Organization.type,
        website: schema.Organization.website,
        email_domain: schema.Organization.emailDomain,
        createdAt: schema.Organization.createdAt,
        updatedAt: schema.Organization.updatedAt,
        createdById: schema.Organization.createdById,
        role: schema.OrganizationMember.role,
      })
      .from(schema.OrganizationMember)
      .innerJoin(
        schema.Organization,
        eq(schema.OrganizationMember.organizationId, schema.Organization.id)
      )
      .where(eq(schema.OrganizationMember.userId, userId))
    return rows.map(({ role, ...organization }) => ({ ...organization, role }))
  }),
  // Get organization details
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id
    const orgId = input.id
    const memberService = new MemberService(ctx.db)
    // Verify user is part of this organization first
    const [membership] = await ctx.db
      .select({ role: schema.OrganizationMember.role })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, orgId)
        )
      )
      .limit(1)
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
        email_domain: schema.Organization.emailDomain,
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
      memberService.getOrganizationMembers(orgId),
      memberService.getPendingInvitations(orgId),
    ])
    return {
      ...organization,
      members,
      pendingInvitations,
      userRole: membership.role, // Role of the current user making the request
    }
  }),
  getOrganization: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id
    const [org] = await ctx.db
      .select()
      .from(schema.Organization)
      .where(eq(schema.Organization.createdById, userId))
      .limit(1)
    return org
  }),
  checkHandleAvailability: protectedProcedure
    .input(
      z.object({
        handle: z
          .string()
          .min(4, 'Handle must be at least 4 characters')
          .regex(/^[a-z0-9-]+$/, 'Handle can only contain lowercase letters, numbers, and hyphens'),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if handle is reserved
      if (RESERVED_HANDLES.includes(input.handle as any)) {
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
        currentOrgId: existing?.id, // Return the org that owns this handle if it exists
      }
    }),
  getActiveMemberCount: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
    }
    const rows = await ctx.db
      .select({ id: schema.OrganizationMember.id })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.status, 'ACTIVE')
        )
      )
    return rows.length
  }),
  inviteBatch: protectedProcedure
    .input(
      z.object({
        invites: z.array(
          z.object({
            email: z.email(),
            role: z.enum(OrganizationRole),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      // Get organization name for email template
      const [organization] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)
      const results = []
      for (const invite of input.invites) {
        try {
          const result = await memberService.inviteMember({
            organizationId,
            inviterUserId: sessionUser.id,
            inviterName: sessionUser.name,
            organizationName: organization?.name,
            email: invite.email,
            role: invite.role,
          })
          results.push({ email: invite.email, success: true, message: result.message })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to send invitation'
          results.push({ email: invite.email, success: false, error: errorMessage })
        }
      }
      return results
    }),
  // Invite a user to an organization
  inviteUser: protectedProcedure
    .input(
      z.object({
        email: z.email(),
        role: z.enum(OrganizationRole).default('USER'),
        // organizationId: z.string(), // Use context instead
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const { email, role } = input
      const memberService = new MemberService(ctx.db)
      // Get organization name for email template
      const [organization] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)
      try {
        const result = await memberService.inviteMember({
          organizationId,
          inviterUserId: sessionUser.id,
          inviterName: sessionUser.name,
          organizationName: organization?.name,
          email,
          role,
        })
        return result // Contains success and message
      } catch (error) {
        // Catch errors specifically thrown by the service (like permission denied, already exists)
        if (error instanceof TRPCError) {
          throw error
        }
        logger.error('Unexpected error during inviteUser:', { error, organizationId, email })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to process invitation.',
        })
      }
    }),
  // New procedure to accept an invitation
  acceptInvitation: protectedProcedure // User must be logged in to accept
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { user: sessionUser } = ctx.session
      const memberService = new MemberService(ctx.db)
      try {
        const result = await memberService.acceptInvitation({
          token: input.token,
          acceptingUserId: sessionUser.id,
          acceptingUserEmail: sessionUser.email, // Pass user's email for verification
        })
        // Optionally: Invalidate queries related to user's organizations or current org members
        // await ctx.res?.revalidate(...) or client-side invalidation
        return result // Contains success and organizationId
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error
        }
        logger.error('Unexpected error during acceptInvitation:', {
          error,
          token: input.token,
          userId: sessionUser.id,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to accept invitation.',
        })
      }
    }),
  acceptInvitationById: protectedProcedure
    .input(z.object({ invitationId: z.string() })) // Require invitationId
    .mutation(async ({ ctx, input }) => {
      const { user: sessionUser } = ctx.session
      const memberService = new MemberService(ctx.db)
      try {
        // We need a slightly different service method or modify the existing one
        // Let's assume a new method for clarity: acceptInvitationByIdentity
        const result = await memberService.acceptInvitationByIdentity({
          // Assuming this method exists
          invitationId: input.invitationId,
          acceptingUserId: sessionUser.id,
          acceptingUserEmail: sessionUser.email, // Still needed for verification within the service
        })
        // Invalidate queries after successful acceptance
        return result
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error
        }
        logger.error('Unexpected error during acceptInvitationById:', {
          error,
          invitationId: input.invitationId,
          userId: sessionUser.id,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to accept invitation.',
        })
      }
    }),
  cancelInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.cancelInvitation({
          invitationId: input.invitationId,
          cancellerUserId: sessionUser.id,
          organizationId: organizationId, // Pass orgId for permission check context
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during cancelInvitation:', {
          error,
          invitationId: input.invitationId,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel invitation.',
        })
      }
    }),
  // --- NEW: Resend Invitation ---
  resendInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.resendInvitation({
          invitationId: input.invitationId,
          resenderUserId: sessionUser.id,
          organizationId: organizationId,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during resendInvitation:', {
          error,
          invitationId: input.invitationId,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resend invitation.',
        })
      }
    }),
  // Switch user's default organization
  setDefault: publicProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.session

      // const userId = ctx.session.user.id
      const { organizationId } = input
      // Verify membership
      const [membership] = await ctx.db
        .select({ role: schema.OrganizationMember.role })
        .from(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.userId, userId),
            eq(schema.OrganizationMember.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' })
      }
      // Update default organization
      await ctx.db
        .update(schema.User)
        .set({ defaultOrganizationId: organizationId, updatedAt: new Date() })
        .where(eq(schema.User.id, userId))
      return { success: true, organizationId }
    }),
  removeMember: protectedProcedure
    .input(z.object({ memberId: z.string() })) // memberId is the userId of the member to remove
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.removeMember({
          organizationId,
          removerUserId: sessionUser.id,
          memberToRemoveId: input.memberId,
        })
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error
        }
        logger.error('Unexpected error during removeMember:', {
          error,
          organizationId,
          memberId: input.memberId,
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to remove member.' })
      }
    }),
  // Update a member's role in an organization
  updateMemberRole: protectedProcedure
    .input(z.object({ memberId: z.string(), role: z.enum(OrganizationRole) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.updateMemberRole({
          organizationId,
          updaterUserId: sessionUser.id,
          memberToUpdateId: input.memberId,
          newRole: input.role,
        })
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error
        }
        logger.error('Unexpected error during updateMemberRole:', {
          error,
          organizationId,
          memberId: input.memberId,
          role: input.role,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update member role.',
        })
      }
    }),
  // Leave organization
  leaveOrganization: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const { organizationId } = input
      // Check if user is a member
      const [membership] = await ctx.db
        .select({ role: schema.OrganizationMember.role })
        .from(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.userId, userId),
            eq(schema.OrganizationMember.organizationId, organizationId)
          )
        )
        .limit(1)
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
        // Find another organization to set as default
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
      return { success: true }
    }),
  allMembers: protectedProcedure
    .input(z.object({ excludeGroupId: z.string().optional(), search: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { excludeGroupId, search } = input
      try {
        // Build where conditions for the query
        const whereConditions = [
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.User.userType, 'USER'),
        ]

        // Add search condition if provided - search both name and email
        if (search) {
          whereConditions.push(
            or(ilike(schema.User.name, `%${search}%`), ilike(schema.User.email, `%${search}%`))
          )
        }

        // Get org members (exclude system users)
        const rows = await ctx.db
          .select({
            id: schema.OrganizationMember.id,
            userId: schema.OrganizationMember.userId,
            role: schema.OrganizationMember.role,
            status: schema.OrganizationMember.status,
            organizationId: schema.OrganizationMember.organizationId,
            user: {
              id: schema.User.id,
              name: schema.User.name,
              email: schema.User.email,
              image: schema.User.image,
              userType: schema.User.userType,
            },
          })
          .from(schema.OrganizationMember)
          .innerJoin(schema.User, eq(schema.OrganizationMember.userId, schema.User.id))
          .where(and(...whereConditions))
        // If excludeGroupId is provided, filter out members already in the group
        if (excludeGroupId) {
          const groupMembers = await ctx.db
            .select({ userId: schema.GroupMember.userId })
            .from(schema.GroupMember)
            .where(eq(schema.GroupMember.groupId, excludeGroupId))
          const groupMemberIds = new Set(groupMembers.map((m) => m.userId))
          const filteredMembers = rows.filter((member) => !groupMemberIds.has(member.userId))
          return { members: filteredMembers }
        }
        return { members: rows }
      } catch (error) {
        logger.error('Error getting organization members:', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get organization members',
        })
      }
    }),
  getInvitationLink: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Using query as it retrieves data
      const { organizationId, user: sessionUser } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
      }
      const memberService = new MemberService(ctx.db)
      try {
        const link = await memberService.getInvitationLink({
          invitationId: input.invitationId,
          requestingUserId: sessionUser.id,
          organizationId: organizationId,
        })
        return { link } // Return object with link property
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during getInvitationLink:', {
          error,
          invitationId: input.invitationId,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve invitation link.',
        })
      }
    }),
  getMyPendingInvitations: protectedProcedure.query(async ({ ctx }) => {
    const userEmail = ctx.session.user.email
    if (!userEmail) {
      // This shouldn't happen for a logged-in user with an email provider, but safeguard
      logger.warn('User trying to fetch pending invites has no email in session', {
        userId: ctx.session.user.id,
      })
      return [] // Return empty array if no email
    }
    const pendingInvitations = await ctx.db
      .select({
        id: schema.OrganizationInvitation.id,
        role: schema.OrganizationInvitation.role,
        createdAt: schema.OrganizationInvitation.createdAt,
        expiresAt: schema.OrganizationInvitation.expiresAt,
        organization: {
          id: schema.Organization.id,
          name: schema.Organization.name,
        },
        invitedBy: {
          id: schema.User.id,
          name: schema.User.name,
          image: schema.User.image,
        },
      })
      .from(schema.OrganizationInvitation)
      .innerJoin(
        schema.Organization,
        eq(schema.OrganizationInvitation.organizationId, schema.Organization.id)
      )
      .innerJoin(schema.User, eq(schema.OrganizationInvitation.invitedById, schema.User.id))
      .where(
        and(
          ilike(schema.OrganizationInvitation.email, userEmail),
          eq(schema.OrganizationInvitation.status, 'PENDING'),
          gt(schema.OrganizationInvitation.expiresAt, new Date())
        )
      )
    return pendingInvitations
  }),
  deleteOrganization: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        confirmationEmail: z.string().email('Invalid email format for confirmation.'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { user: sessionUser } = ctx.session
      // Note: We pass ctx.db directly here, assuming OrganizationService doesn't need complex dependencies yet
      const orgService = new OrganizationService(ctx.db)
      try {
        // Use the organizationId from the *input*, not necessarily the session context's default org
        return await orgService.deleteOrganization({
          organizationId: input.organizationId,
          requestingUserId: sessionUser.id,
          confirmationEmail: input.confirmationEmail,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during deleteOrganization:', {
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
