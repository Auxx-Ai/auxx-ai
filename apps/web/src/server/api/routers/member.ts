// apps/web/src/server/api/routers/member.ts

import { schema } from '@auxx/database'
import { MemberType, OrganizationRole, SeatType } from '@auxx/database/enums'
import { getCachedMembers, onCacheEvent } from '@auxx/lib/cache'
import { DehydrationCacheService, DehydrationService } from '@auxx/lib/dehydration'
import {
  acceptInvitation,
  acceptInvitationById,
  assignMemberProfile,
  cancelInvitation,
  findMemberByUser,
  getActiveMemberCount,
  getInvitationLink,
  getInvitationPreview,
  getMyPendingInvitations,
  getPendingInvitations,
  inviteMember,
  removeMember,
  resendInvitation,
  updateMemberRole,
  updateMemberSeatType,
} from '@auxx/lib/members'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure, publicProcedure } from '~/server/api/trpc'

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
          // Without this the member detail's profile picker resolves every member
          // to the system template for their role/seat, so an explicit CUSTOM
          // binding is invisible — and assigning one appears to do nothing, since
          // the refetch after a successful write reports the same fallback.
          permissionProfileId: m.permissionProfileId ?? null,
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
    return getActiveMemberCount(ctx.session.organizationId, ctx.db)
  }),

  /** Get pending invitations for current organization */
  invitations: protectedProcedure.query(async ({ ctx }) => {
    return getPendingInvitations(ctx.session.organizationId, ctx.db)
  }),

  /** Get current user's pending invitations across all orgs */
  myPendingInvitations: protectedProcedure.query(async ({ ctx }) => {
    return getMyPendingInvitations(ctx.session.user.email, ctx.db)
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
      const result = await removeMember(
        {
          organizationId: ctx.session.organizationId,
          removerUserId: ctx.session.user.id,
          memberToRemoveId: input.memberId,
        },
        ctx.db
      )

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
      const result = await updateMemberRole(
        {
          organizationId: ctx.session.organizationId,
          updaterUserId: ctx.session.user.id,
          memberToUpdateId: input.memberId,
          newRole: input.role,
        },
        ctx.db
      )

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
      // The service enforces the members.manage gate, the worker⇒USER invariant
      // and the destination seat class's plan limit, then emits
      // `member.seat-type.changed` + dehydration invalidation on success.
      const result = await updateMemberSeatType(
        {
          organizationId: ctx.session.organizationId,
          updaterUserId: ctx.session.user.id,
          memberToUpdateId: input.memberId,
          seatType: input.seatType,
        },
        ctx.db
      )

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.seat_type_changed',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        newState: { seatType: input.seatType },
      })

      return result
    }),

  /**
   * Bind a permission profile to a member (plan 21 §3.2).
   *
   * The service owns every guard: the `members.manage` + `permissions.manage`
   * base gates, the org-scope / appliesTo / Owner-profile checks, the cross-seat
   * refusal, the rank guards against the profile's DECLARED role, last-owner
   * protection and the §6.1 escalation guard — then writes `permissionProfileId`
   * AND `role` in one update and emits the cache / dehydration / realtime tail.
   */
  assignProfile: protectedProcedure
    .input(
      z.object({
        /** The member's `userId`, matching every other `member.*` mutation. */
        memberId: z.string(),
        /** The profile to bind, or `null` to fall back to the system template. */
        profileId: z.string().nullable(),
      })
    )
    .use(notDemo('change member permission profiles'))
    .mutation(async ({ ctx, input }) => {
      const result = await assignMemberProfile(
        {
          organizationId: ctx.session.organizationId,
          actorUserId: ctx.session.user.id,
          memberUserId: input.memberId,
          permissionProfileId: input.profileId,
        },
        ctx.db
      )

      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.profile_assigned',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        newState: { permissionProfileId: result.permissionProfileId, role: result.role },
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
        /** Permission profile chosen in the invite UI. Its `seat` supersedes
         * `seatType` and drives the cap check (§1.1, §7). */
        permissionProfileId: z.string().nullish(),
      })
    )
    .use(notDemo('invite team members'))
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, ctx.session.organizationId))
        .limit(1)

      return inviteMember(
        {
          organizationId: ctx.session.organizationId,
          inviterUserId: ctx.session.user.id,
          inviterName: ctx.session.user.name,
          organizationName: org?.name,
          email: input.email,
          role: input.role,
          seatType: input.seatType,
          permissionProfileId: input.permissionProfileId,
        },
        ctx.db
      )
    }),

  /** Invite multiple users */
  inviteBatch: protectedProcedure
    .input(
      z.object({
        invites: z.array(
          z.object({
            email: z.string().email(),
            role: z.enum(OrganizationRole).default('USER'),
            seatType: z.enum(SeatType).default('full'),
            /** Permission profile chosen in the invite UI. Its `seat` supersedes
             * `seatType` and drives the cap check (§1.1, §7). Without it a batch
             * invitation binds nothing and the accepted member falls back to the
             * system template for their role (§1.3). */
            permissionProfileId: z.string().nullish(),
          })
        ),
      })
    )
    .use(notDemo('invite team members'))
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db
        .select({ name: schema.Organization.name })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, ctx.session.organizationId))
        .limit(1)

      const results: Array<{
        email: string
        success: boolean
        message?: string
        error?: string
      }> = []
      for (const invite of input.invites) {
        try {
          const result = await inviteMember(
            {
              organizationId: ctx.session.organizationId,
              inviterUserId: ctx.session.user.id,
              inviterName: ctx.session.user.name,
              organizationName: org?.name,
              email: invite.email,
              role: invite.role,
              seatType: invite.seatType,
              permissionProfileId: invite.permissionProfileId,
            },
            ctx.db
          )
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
      const result = await acceptInvitation(
        {
          token: input.token,
          acceptingUserId: ctx.session.user.id,
          acceptingUserEmail: ctx.session.user.email,
        },
        ctx.db
      )

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
    }),

  /** Accept invitation by ID */
  acceptInvitationById: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await acceptInvitationById(
        {
          invitationId: input.invitationId,
          acceptingUserId: ctx.session.user.id,
          acceptingUserEmail: ctx.session.user.email,
        },
        ctx.db
      )

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
    }),

  /** Cancel a pending invitation */
  cancelInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await cancelInvitation(
        {
          invitationId: input.invitationId,
          cancellerUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        },
        ctx.db
      )
      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'invitation.canceled',
        targetType: 'Invitation',
        targetId: input.invitationId,
      })
      return result
    }),

  /** Resend a pending invitation */
  resendInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await resendInvitation(
        {
          invitationId: input.invitationId,
          resenderUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        },
        ctx.db
      )
      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'invitation.resent',
        targetType: 'Invitation',
        targetId: input.invitationId,
      })
      return result
    }),

  /** Get invitation link for sharing */
  getInvitationLink: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const link = await getInvitationLink(
        {
          invitationId: input.invitationId,
          requestingUserId: ctx.session.user.id,
          organizationId: ctx.session.organizationId,
        },
        ctx.db
      )
      return { link }
    }),

  /**
   * Resolve the invitation a signup link carries, so the signup form can show
   * who is inviting and bind the email field. Public because the invitee has no
   * account yet — the token is the credential.
   */
  invitationPreview: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => getInvitationPreview({ token: input.token }, ctx.db)),
})
