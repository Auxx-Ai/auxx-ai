// apps/build/src/server/api/routers/members.ts
// Members tRPC router

import { DEV_PORTAL_URL } from '@auxx/config/server'
import {
  DeveloperAccount,
  DeveloperAccountInvite,
  DeveloperAccountMember,
  User,
} from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import { enqueueEmailJob } from '@auxx/lib/jobs/email/enqueue'
import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Resolve a developer slug to account ID and verify the calling user is a member.
 * Returns the account ID and the caller's membership row.
 */
async function resolveAccountAndMember(
  db: Parameters<Parameters<typeof protectedProcedure.query>[0]>['ctx']['db'],
  developerSlug: string,
  userId: string
) {
  const [account] = await db
    .select({ id: DeveloperAccount.id, title: DeveloperAccount.title })
    .from(DeveloperAccount)
    .where(eq(DeveloperAccount.slug, developerSlug))
    .limit(1)

  if (!account) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Developer account not found' })
  }

  const [member] = await db
    .select()
    .from(DeveloperAccountMember)
    .where(
      and(
        eq(DeveloperAccountMember.developerAccountId, account.id),
        eq(DeveloperAccountMember.userId, userId)
      )
    )
    .limit(1)

  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this account' })
  }

  return { accountId: account.id, accountTitle: account.title, member }
}

/** Assert the caller is an admin of the developer account */
function assertAdmin(member: { accessLevel: string }) {
  if (member.accessLevel !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can perform this action',
    })
  }
}

/**
 * Members router
 */
export const membersRouter = createTRPCRouter({
  /**
   * List members and pending invites of a developer account
   */
  list: protectedProcedure
    .input(z.object({ developerSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const { accountId } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )

      const members = await ctx.db
        .select({
          id: DeveloperAccountMember.id,
          userId: DeveloperAccountMember.userId,
          emailAddress: DeveloperAccountMember.emailAddress,
          accessLevel: DeveloperAccountMember.accessLevel,
          createdAt: DeveloperAccountMember.createdAt,
          userName: User.name,
          userImage: User.image,
        })
        .from(DeveloperAccountMember)
        .innerJoin(User, eq(User.id, DeveloperAccountMember.userId))
        .where(eq(DeveloperAccountMember.developerAccountId, accountId))

      const invites = await ctx.db
        .select()
        .from(DeveloperAccountInvite)
        .where(
          and(
            eq(DeveloperAccountInvite.developerAccountId, accountId),
            sql`${DeveloperAccountInvite.acceptedAt} IS NULL`
          )
        )

      return { members, invites }
    }),

  /**
   * Invite members to developer account
   */
  invite: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        emails: z.string().min(1, 'At least one email is required'),
        accessLevel: z.enum(['admin', 'member']).default('member'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accountId, accountTitle, member } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )
      assertAdmin(member)

      // Parse and validate emails
      const rawEmails = input.emails
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)

      const emailSchema = z.string().email()
      const validEmails: string[] = []
      const invalidEmails: string[] = []

      for (const email of rawEmails) {
        const result = emailSchema.safeParse(email)
        if (result.success) {
          validEmails.push(email)
        } else {
          invalidEmails.push(email)
        }
      }

      if (invalidEmails.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid email addresses: ${invalidEmails.join(', ')}`,
        })
      }

      if (validEmails.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid email addresses provided' })
      }

      // Check for existing members
      const existingMembers = await ctx.db
        .select({ emailAddress: DeveloperAccountMember.emailAddress })
        .from(DeveloperAccountMember)
        .where(eq(DeveloperAccountMember.developerAccountId, accountId))

      const existingEmails = new Set(existingMembers.map((m) => m.emailAddress.toLowerCase()))

      // Check for existing pending invites
      const existingInvites = await ctx.db
        .select({ emailAddress: DeveloperAccountInvite.emailAddress })
        .from(DeveloperAccountInvite)
        .where(
          and(
            eq(DeveloperAccountInvite.developerAccountId, accountId),
            sql`${DeveloperAccountInvite.acceptedAt} IS NULL`
          )
        )

      const pendingEmails = new Set(existingInvites.map((i) => i.emailAddress.toLowerCase()))

      const duplicates: string[] = []
      const toInvite: string[] = []

      for (const email of validEmails) {
        if (existingEmails.has(email) || pendingEmails.has(email)) {
          duplicates.push(email)
        } else {
          toInvite.push(email)
        }
      }

      if (toInvite.length === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            duplicates.length > 0
              ? `All emails are already members or have pending invitations: ${duplicates.join(', ')}`
              : 'No new emails to invite',
        })
      }

      // Insert invites
      const created = await ctx.db
        .insert(DeveloperAccountInvite)
        .values(
          toInvite.map((email) => ({
            developerAccountId: accountId,
            emailAddress: email,
            accessLevel: input.accessLevel,
            createdById: member.id,
          }))
        )
        .returning()

      // Send invitation emails
      const [inviter] = await ctx.db
        .select({ name: User.name })
        .from(User)
        .where(eq(User.id, ctx.session.userId))
        .limit(1)

      const inviterName = inviter?.name || 'A team member'
      const baseUrl = (DEV_PORTAL_URL || 'http://localhost:3006').replace(/\/$/, '')

      for (const invite of created) {
        await enqueueEmailJob('developer-invite', {
          recipient: { email: invite.emailAddress },
          inviterName,
          accountName: accountTitle,
          acceptLink: `${baseUrl}/invitations/accept?token=${invite.id}`,
          role: invite.accessLevel,
          source: 'members-router',
        })
      }

      return { created, duplicates }
    }),

  /**
   * Remove member from developer account
   */
  remove: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        memberId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accountId, member } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )
      assertAdmin(member)

      // Prevent removing self if last admin
      if (input.memberId === member.id) {
        const adminCount = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(DeveloperAccountMember)
          .where(
            and(
              eq(DeveloperAccountMember.developerAccountId, accountId),
              eq(DeveloperAccountMember.accessLevel, 'admin')
            )
          )

        if (Number(adminCount[0]?.count) <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot remove the last admin of the account',
          })
        }
      }

      await ctx.db
        .delete(DeveloperAccountMember)
        .where(
          and(
            eq(DeveloperAccountMember.id, input.memberId),
            eq(DeveloperAccountMember.developerAccountId, accountId)
          )
        )

      return { success: true }
    }),

  /**
   * Update a member's access level
   */
  updateAccessLevel: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        memberId: z.string(),
        accessLevel: z.enum(['admin', 'member']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accountId, member } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )
      assertAdmin(member)

      // If demoting self, ensure not last admin
      if (input.memberId === member.id && input.accessLevel === 'member') {
        const adminCount = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(DeveloperAccountMember)
          .where(
            and(
              eq(DeveloperAccountMember.developerAccountId, accountId),
              eq(DeveloperAccountMember.accessLevel, 'admin')
            )
          )

        if (Number(adminCount[0]?.count) <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot demote the last admin of the account',
          })
        }
      }

      const [updated] = await ctx.db
        .update(DeveloperAccountMember)
        .set({ accessLevel: input.accessLevel, updatedAt: new Date() })
        .where(
          and(
            eq(DeveloperAccountMember.id, input.memberId),
            eq(DeveloperAccountMember.developerAccountId, accountId)
          )
        )
        .returning()

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' })
      }

      return updated
    }),

  /**
   * Cancel a pending invitation
   */
  cancelInvitation: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        inviteId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accountId, member } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )
      assertAdmin(member)

      const [deleted] = await ctx.db
        .delete(DeveloperAccountInvite)
        .where(
          and(
            eq(DeveloperAccountInvite.id, input.inviteId),
            eq(DeveloperAccountInvite.developerAccountId, accountId)
          )
        )
        .returning()

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }

      return { success: true }
    }),

  /**
   * Resend an invitation (resets failedToSend, updates timestamp)
   */
  resendInvitation: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        inviteId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accountId, accountTitle, member } = await resolveAccountAndMember(
        ctx.db,
        input.developerSlug,
        ctx.session.userId
      )
      assertAdmin(member)

      const [updated] = await ctx.db
        .update(DeveloperAccountInvite)
        .set({ failedToSend: false, updatedAt: new Date() })
        .where(
          and(
            eq(DeveloperAccountInvite.id, input.inviteId),
            eq(DeveloperAccountInvite.developerAccountId, accountId)
          )
        )
        .returning()

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }

      // Resend invitation email
      const [inviter] = await ctx.db
        .select({ name: User.name })
        .from(User)
        .where(eq(User.id, ctx.session.userId))
        .limit(1)

      const inviterName = inviter?.name || 'A team member'
      const baseUrl = (DEV_PORTAL_URL || 'http://localhost:3006').replace(/\/$/, '')

      await enqueueEmailJob('developer-invite', {
        recipient: { email: updated.emailAddress },
        inviterName,
        accountName: accountTitle,
        acceptLink: `${baseUrl}/invitations/accept?token=${updated.id}`,
        role: updated.accessLevel,
        source: 'members-router',
      })

      return { success: true }
    }),

  /**
   * Accept an invitation to join a developer account
   */
  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Find the invite by ID (the token IS the invite id)
      const [invite] = await ctx.db
        .select()
        .from(DeveloperAccountInvite)
        .where(
          and(
            eq(DeveloperAccountInvite.id, input.token),
            sql`${DeveloperAccountInvite.acceptedAt} IS NULL`
          )
        )
        .limit(1)

      if (!invite) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found or already accepted.',
        })
      }

      // 2. Check expiry (7 days from createdAt)
      const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
      if (Date.now() - invite.createdAt.getTime() > EXPIRY_MS) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation has expired.' })
      }

      // 3. Verify email matches the logged-in user
      const userEmail = ctx.session.userEmail?.toLowerCase()
      if (!userEmail || invite.emailAddress.toLowerCase() !== userEmail) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invitation is for a different email address.',
        })
      }

      // 4. Check if already a member
      const [existing] = await ctx.db
        .select({ id: DeveloperAccountMember.id })
        .from(DeveloperAccountMember)
        .where(
          and(
            eq(DeveloperAccountMember.developerAccountId, invite.developerAccountId),
            eq(DeveloperAccountMember.userId, ctx.session.userId)
          )
        )
        .limit(1)

      if (existing) {
        // Already a member — mark invite accepted and return success
        await ctx.db
          .update(DeveloperAccountInvite)
          .set({ acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(DeveloperAccountInvite.id, invite.id))

        return { success: true, developerAccountId: invite.developerAccountId, alreadyMember: true }
      }

      // 5. Add as member + mark invite accepted
      await ctx.db.insert(DeveloperAccountMember).values({
        developerAccountId: invite.developerAccountId,
        userId: ctx.session.userId,
        emailAddress: invite.emailAddress,
        accessLevel: invite.accessLevel,
      })

      await ctx.db
        .update(DeveloperAccountInvite)
        .set({ acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(DeveloperAccountInvite.id, invite.id))

      // 6. Invalidate build cache so sidebar updates
      await onCacheEvent('build.developer-account.member-added', {
        userId: ctx.session.userId,
        developerAccountId: invite.developerAccountId,
      })

      // 7. Get the account slug so we can redirect
      const [account] = await ctx.db
        .select({ slug: DeveloperAccount.slug })
        .from(DeveloperAccount)
        .where(eq(DeveloperAccount.id, invite.developerAccountId))
        .limit(1)

      return {
        success: true,
        developerAccountId: invite.developerAccountId,
        slug: account?.slug,
        alreadyMember: false,
      }
    }),
})
