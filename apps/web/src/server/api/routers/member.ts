// apps/web/src/server/api/routers/member.ts

import { schema } from '@auxx/database'
import { MemberType, OrganizationRole } from '@auxx/database/enums'
import { DehydrationService } from '@auxx/lib/dehydration'
import { MemberService } from '@auxx/lib/members'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-member')

/**
 * Member router handles organization member and invitation operations
 */
export const memberRouter = createTRPCRouter({
  // ─────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────

  /**
   * Search members by name/email for autocomplete.
   * Returns members with id (userId) and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const query = input.query.toLowerCase()

      const rows = await ctx.db
        .select({
          userId: schema.OrganizationMember.userId,
          name: schema.User.name,
          email: schema.User.email,
        })
        .from(schema.OrganizationMember)
        .innerJoin(schema.User, eq(schema.OrganizationMember.userId, schema.User.id))
        .where(
          and(
            eq(schema.OrganizationMember.organizationId, organizationId),
            eq(schema.User.userType, 'USER'),
            or(ilike(schema.User.name, `%${query}%`), ilike(schema.User.email, `%${query}%`))
          )
        )
        .limit(10)

      return rows.map((row) => ({
        id: row.userId,
        name: row.name || row.email || 'Unknown',
      }))
    }),

  /** Get all members with optional filtering */
  all: protectedProcedure
    .input(
      z
        .object({
          excludeGroupId: z.string().optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { excludeGroupId, search } = input ?? {}

      // Build where conditions
      const whereConditions = [
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.User.userType, 'USER'),
      ]

      if (search) {
        whereConditions.push(
          or(ilike(schema.User.name, `%${search}%`), ilike(schema.User.email, `%${search}%`))!
        )
      }

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

      // Filter out members already in group if excludeGroupId provided
      if (excludeGroupId) {
        const groupMembers = await ctx.db
          .select({ userId: schema.EntityGroupMember.memberRefId })
          .from(schema.EntityGroupMember)
          .where(
            and(
              eq(schema.EntityGroupMember.groupInstanceId, excludeGroupId),
              eq(schema.EntityGroupMember.memberType, MemberType.user)
            )
          )
        const groupMemberIds = new Set(groupMembers.map((m) => m.userId))
        return { members: rows.filter((member) => !groupMemberIds.has(member.userId)) }
      }

      return { members: rows }
    }),

  /** Get active member count */
  activeCount: protectedProcedure.query(async ({ ctx }) => {
    const memberService = new MemberService(ctx.db)
    return memberService.getActiveMemberCount(ctx.session.organizationId)
  }),

  /** Get pending invitations for current organization */
  invitations: protectedProcedure.query(async ({ ctx }) => {
    const memberService = new MemberService(ctx.db)
    return memberService.getPendingInvitations(ctx.session.organizationId)
  }),

  /** Get current user's pending invitations across all orgs */
  myPendingInvitations: protectedProcedure.query(async ({ ctx }) => {
    const memberService = new MemberService(ctx.db)
    return memberService.getMyPendingInvitations(ctx.session.user.email)
  }),

  /** Get current user's membership */
  getUserMembership: protectedProcedure.query(async ({ ctx }) => {
    const membership = await ctx.db.query.OrganizationMember.findFirst({
      where: (members, { eq, and }) =>
        and(
          eq(members.organizationId, ctx.session.organizationId),
          eq(members.userId, ctx.session.userId)
        ),
    })
    if (!membership) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'You are not a member of this organization',
      })
    }
    return membership
  }),

  // ─────────────────────────────────────────────────────────────
  // MUTATIONS - Member Management
  // ─────────────────────────────────────────────────────────────

  /** Remove a member from organization */
  remove: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const result = await memberService.removeMember({
        organizationId: ctx.session.organizationId,
        removerUserId: ctx.session.user.id,
        memberToRemoveId: input.memberId,
      })

      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.refreshUser(input.memberId)

      return result
    }),

  /** Update a member's role */
  updateRole: protectedProcedure
    .input(
      z.object({
        memberId: z.string(),
        role: z.enum(OrganizationRole),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const result = await memberService.updateMemberRole({
        organizationId: ctx.session.organizationId,
        updaterUserId: ctx.session.user.id,
        memberToUpdateId: input.memberId,
        newRole: input.role,
      })

      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.refreshUser(input.memberId)

      return result
    }),

  // ─────────────────────────────────────────────────────────────
  // MUTATIONS - Invitations
  // ─────────────────────────────────────────────────────────────

  /** Invite a single user */
  invite: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(OrganizationRole).default('USER'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const [org] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, ctx.session.organizationId))
        .limit(1)

      try {
        return await memberService.inviteMember({
          organizationId: ctx.session.organizationId,
          inviterUserId: ctx.session.user.id,
          inviterName: ctx.session.user.name,
          organizationName: org?.name,
          email: input.email,
          role: input.role,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during invite:', { error, email: input.email })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to process invitation.',
        })
      }
    }),

  /** Invite multiple users */
  inviteBatch: protectedProcedure
    .input(
      z.object({
        invites: z.array(
          z.object({
            email: z.string().email(),
            role: z.enum(OrganizationRole),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const [org] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, ctx.session.organizationId))
        .limit(1)

      const results = []
      for (const invite of input.invites) {
        try {
          const result = await memberService.inviteMember({
            organizationId: ctx.session.organizationId,
            inviterUserId: ctx.session.user.id,
            inviterName: ctx.session.user.name,
            organizationName: org?.name,
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

  /** Accept invitation by token */
  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      try {
        const result = await memberService.acceptInvitation({
          token: input.token,
          acceptingUserId: ctx.session.user.id,
          acceptingUserEmail: ctx.session.user.email,
        })

        const dehydrationService = new DehydrationService(ctx.db)
        await dehydrationService.refreshUser(ctx.session.user.id)

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during acceptInvitation:', {
          error,
          token: input.token,
          userId: ctx.session.user.id,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to accept invitation.',
        })
      }
    }),

  /** Accept invitation by ID */
  acceptInvitationById: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      try {
        const result = await memberService.acceptInvitationByIdentity({
          invitationId: input.invitationId,
          acceptingUserId: ctx.session.user.id,
          acceptingUserEmail: ctx.session.user.email,
        })

        const dehydrationService = new DehydrationService(ctx.db)
        await dehydrationService.refreshUser(ctx.session.user.id)

        return result
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during acceptInvitationById:', {
          error,
          invitationId: input.invitationId,
          userId: ctx.session.user.id,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to accept invitation.',
        })
      }
    }),

  /** Cancel a pending invitation */
  cancelInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.cancelInvitation({
          invitationId: input.invitationId,
          cancellerUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during cancelInvitation:', {
          error,
          invitationId: input.invitationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel invitation.',
        })
      }
    }),

  /** Resend a pending invitation */
  resendInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      try {
        return await memberService.resendInvitation({
          invitationId: input.invitationId,
          resenderUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during resendInvitation:', {
          error,
          invitationId: input.invitationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resend invitation.',
        })
      }
    }),

  /** Get invitation link for sharing */
  getInvitationLink: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      try {
        const link = await memberService.getInvitationLink({
          invitationId: input.invitationId,
          requestingUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        })
        return { link }
      } catch (error) {
        if (error instanceof TRPCError) throw error
        logger.error('Unexpected error during getInvitationLink:', {
          error,
          invitationId: input.invitationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve invitation link.',
        })
      }
    }),
})
