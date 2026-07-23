// apps/web/src/server/api/routers/member.ts

import { schema } from '@auxx/database'
import { MemberType, OrganizationRole, SeatType } from '@auxx/database/enums'
import { getCachedMembers, onCacheEvent } from '@auxx/lib/cache'
import { DehydrationCacheService, DehydrationService } from '@auxx/lib/dehydration'
import { findMemberByUser, MemberService } from '@auxx/lib/members'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

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

      const members = await getCachedMembers(organizationId)

      return members
        .filter(
          (m) =>
            m.user?.userType === 'USER' &&
            ((m.user.name ?? '').toLowerCase().includes(query) ||
              (m.user.email ?? '').toLowerCase().includes(query))
        )
        .slice(0, 10)
        .map((m) => ({
          id: m.userId,
          name: m.user?.name || m.user?.email || 'Unknown',
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

      const searchLower = search?.toLowerCase()
      const cachedMembers = await getCachedMembers(organizationId)

      const rows = cachedMembers
        .filter((m) => {
          if (m.user?.userType !== 'USER') return false
          if (!searchLower) return true
          return (
            (m.user.name ?? '').toLowerCase().includes(searchLower) ||
            (m.user.email ?? '').toLowerCase().includes(searchLower)
          )
        })
        .map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          seatType: m.seatType,
          status: m.status,
          organizationId: m.organizationId,
          user: m.user!,
        }))

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
    const membership = await findMemberByUser(ctx.session.organizationId, ctx.session.userId)
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
    .use(notDemo('remove team members'))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const result = await memberService.removeMember({
        organizationId: ctx.session.organizationId,
        removerUserId: ctx.session.user.id,
        memberToRemoveId: input.memberId,
      })

      await onCacheEvent('member.removed', {
        orgId: ctx.session.organizationId,
        userId: input.memberId,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.removed',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
      })

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
    .use(notDemo('change member roles'))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      const result = await memberService.updateMemberRole({
        organizationId: ctx.session.organizationId,
        updaterUserId: ctx.session.user.id,
        memberToUpdateId: input.memberId,
        newRole: input.role,
      })

      await onCacheEvent('member.role.changed', {
        orgId: ctx.session.organizationId,
        userId: input.memberId,
      })
      // The composed capability set rides in dehydrated state — bust it so the
      // member's caps recompose on their next page load (graph now busts
      // userCapabilities on role change too).
      await new DehydrationCacheService().invalidateUser(input.memberId)

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.role_changed',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        newState: { role: input.role },
      })

      return result
    }),

  /** Change a member's seat type (full ⇄ field seat) */
  updateSeatType: protectedProcedure
    .input(
      z.object({
        memberId: z.string(),
        seatType: z.enum(SeatType),
      })
    )
    .use(notDemo('change member seat types'))
    .mutation(async ({ ctx, input }) => {
      const memberService = new MemberService(ctx.db)
      // The service enforces the OWNER/ADMIN + worker⇒USER invariant and emits
      // `member.seat-type.changed` + dehydration invalidation on success.
      const result = await memberService.updateMemberSeatType({
        organizationId: ctx.session.organizationId,
        updaterUserId: ctx.session.user.id,
        memberToUpdateId: input.memberId,
        seatType: input.seatType,
      })

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.seat_type_changed',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        newState: { seatType: input.seatType },
      })

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
        seatType: z.enum(SeatType).default('full'),
      })
    )
    .use(notDemo('invite team members'))
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
          seatType: input.seatType,
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
            seatType: z.enum(SeatType).default('full'),
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
            seatType: invite.seatType,
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

        await recordAuditFromCtx(ctx, {
          organizationId: result.organizationId,
          category: 'members',
          action: 'invitation.accepted',
          targetType: 'Organization',
          targetId: result.organizationId,
        })

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

        await recordAuditFromCtx(ctx, {
          organizationId: result.organizationId,
          category: 'members',
          action: 'invitation.accepted',
          targetType: 'Invitation',
          targetId: input.invitationId,
        })

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
        const result = await memberService.cancelInvitation({
          invitationId: input.invitationId,
          cancellerUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        })
        await recordAuditFromCtx(ctx, {
          category: 'members',
          action: 'invitation.canceled',
          targetType: 'Invitation',
          targetId: input.invitationId,
        })
        return result
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
        const result = await memberService.resendInvitation({
          invitationId: input.invitationId,
          resenderUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        })
        await recordAuditFromCtx(ctx, {
          category: 'members',
          action: 'invitation.resent',
          targetType: 'Invitation',
          targetId: input.invitationId,
        })
        return result
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
