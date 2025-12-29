// apps/web/src/server/api/routers/member.ts
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { TRPCError } from '@trpc/server'

/**
 * Member router handles organization member and invitation operations
 */
export const memberRouter = createTRPCRouter({
  /**
   * Get all members for the current organization
   * Returns members with their user details, ordered by role
   */
  all: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    if (!organizationId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
    }

    const members = await ctx.db.query.OrganizationMember.findMany({
      where: (members, { eq }) => eq(members.organizationId, organizationId),
      with: {
        user: true,
      },
      orderBy: (members, { asc }) => [asc(members.role)],
    })

    return members
  }),

  /**
   * Get all pending invitations for the current organization
   * Returns invitations with inviter details, ordered by creation date (newest first)
   */
  invitations: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    if (!organizationId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
    }

    const invitations = await ctx.db.query.OrganizationInvitation.findMany({
      where: (invitations, { eq, gt, and }) =>
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.status, 'PENDING'),
          gt(invitations.expiresAt, new Date())
        ),
      with: {
        invitedBy: true,
      },
      orderBy: (invitations, { desc }) => [desc(invitations.createdAt)],
    })

    return invitations
  }),

  /**
   * Get current user's membership in the organization
   * Returns membership record with role and status
   */
  getUserMembership: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session

    if (!organizationId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
    }

    const membership = await ctx.db.query.OrganizationMember.findFirst({
      where: (members, { eq, and }) =>
        and(eq(members.organizationId, organizationId), eq(members.userId, userId)),
    })

    if (!membership) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'You are not a member of this organization',
      })
    }

    return membership
  }),

  /**
   * Get organization details
   * Returns organization record
   */
  getOrganizationDetails: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    if (!organizationId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Organization context not found.' })
    }

    const organization = await ctx.db.query.Organization.findFirst({
      where: (orgs, { eq }) => eq(orgs.id, organizationId),
    })

    if (!organization) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
    }

    return organization
  }),
})
