// apps/web/src/server/api/routers/member.ts

import { schema } from '@auxx/database'
import { MemberType, OrganizationRole, SeatType } from '@auxx/database/enums'
import type { OrganizationRole as OrganizationRoleType } from '@auxx/database/types'
import { getCachedMembers, getCachedResources, onCacheEvent } from '@auxx/lib/cache'
import { DehydrationService } from '@auxx/lib/dehydration'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import {
  acceptInvitation,
  acceptInvitationById,
  assignMemberProfile,
  cancelInvitation,
  canManageTarget,
  findMemberByUser,
  getActiveMemberCount,
  getInvitationLink,
  getInvitationPreview,
  getMyPendingInvitations,
  getPendingInvitations,
  inviteMember,
  removeMember,
  resendInvitation,
  updateMemberSeatType,
} from '@auxx/lib/members'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  getMemberShareSummary,
  groupKeyForDef,
  listMemberShares,
  listMemberTypeGrants,
  MAX_REVOKE_RECORD_IDS,
  MEMBER_SHARE_GROUPS,
  MEMBER_SHARES_PAGE_SIZE,
  MEMBER_SHARES_SEARCH_SCAN_CAP,
  type MemberShareGroupKey,
  type RevokeMemberSharesScope,
  revokeMemberShares,
} from '@auxx/lib/resource-access'
import { recordIdSchema } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import {
  createTRPCRouter,
  notDemo,
  permissionProcedure,
  protectedProcedure,
  publicProcedure,
} from '~/server/api/trpc'

/**
 * The "Shared" tab's gate (plan 46 §4.2) — the RANK half only; the
 * `members.manage` half is the `permissionProcedure` the three procedures are
 * built on.
 *
 * Deliberately NOT the per-instance `authorizeInstanceTarget` that
 * `resourceAccess.revokeInstance` runs: an admin does not necessarily hold admin
 * rung on each individual dashboard, so a per-row check would make a sweep
 * silently skip rows, which is worse than refusing. If you can remove the
 * person, you can strip their shares. Mail rows keep their own per-inbox guard,
 * applied inside `revokeMemberShares`.
 *
 * Self is READ-ONLY: viewing your own Shared tab is fine, but revoking your own
 * rows goes through the per-resource self-revoke hatch
 * (`resourceAccess.revokeInstance`), which is where the mail guard's self-revoke
 * exception lives.
 */
async function assertMemberShareAuthority(
  organizationId: string,
  viewerUserId: string,
  memberId: string,
  mode: 'read' | 'write'
): Promise<void> {
  if (viewerUserId === memberId) {
    if (mode === 'read') return
    throw new ForbiddenError(
      'You cannot revoke your own shares here. Remove them from the resource itself.'
    )
  }

  const members = await getCachedMembers(organizationId)
  const viewer = members.find((m) => m.userId === viewerUserId)
  const target = members.find((m) => m.userId === memberId)
  if (!viewer) throw new ForbiddenError('You are not a member of this organization.')
  if (!target) throw new NotFoundError('Member not found in this organization.')
  if (!canManageTarget(viewer.role, target.role)) {
    throw new ForbiddenError("You don't have permission to manage this member's shares.")
  }
}

/** Heading, copy and glyph for one Shared-tab group (§3.3/§5.3). */
interface ShareGroupDescription {
  label: string
  /** Load-bearing on `contact` only — §5.3. `null` everywhere else. */
  description: string | null
  /** Plural noun for toasts and confirm copy, e.g. `conversations`. */
  plural: string
  /** Singular noun, e.g. `conversation`. Also the tombstone copy's tail. */
  noun: string
  /** `EntityIcon` input for a record def; `null` draws the group's own glyph. */
  icon: { iconId: string; color: string } | null
}

/**
 * Resolve group headings once per request off the org `resources` cache.
 *
 * A `record` group's `entityDefinitionId` is a CUID, so "Records" is useless as
 * a heading when the member holds two tickets and two work orders — §3.3 makes
 * record defs the one two-level nesting, and this is where the def's own name
 * and glyph come from. Unknown defs keep the generic heading and stay listed:
 * an orphan row is exactly what this tab should let someone clear.
 */
async function buildShareGroupDescriber(
  organizationId: string
): Promise<(groupKey: MemberShareGroupKey, entityDefinitionId: string) => ShareGroupDescription> {
  const resources = await getCachedResources(organizationId)
  const byId = new Map(resources.map((r) => [r.id, r]))

  return (groupKey, entityDefinitionId) => {
    const meta = MEMBER_SHARE_GROUPS[groupKey]
    const resource = groupKey === 'record' ? byId.get(entityDefinitionId) : undefined
    return {
      label: resource?.plural || resource?.label || meta.label,
      description: meta.description ?? null,
      plural: (resource?.plural || meta.label).toLowerCase(),
      noun: (resource?.label || meta.noun).toLowerCase(),
      icon: resource ? { iconId: resource.icon, color: resource.color } : null,
    }
  }
}

/** `revokeMemberShares`' three scopes on the wire (§4.1). */
const revokeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('type'), entityDefinitionId: z.string().min(1) }),
  z.object({
    kind: z.literal('ids'),
    recordIds: z.array(recordIdSchema).min(1).max(MAX_REVOKE_RECORD_IDS),
  }),
])

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

  // ─────────────────────────────────────────────────────────────
  // SHARED TAB — what is addressed directly to one member (plan 46)
  // ─────────────────────────────────────────────────────────────

  /**
   * Collapsed first paint for the Shared tab (§3.1).
   *
   * Three things in one round trip because the tab needs all three before it can
   * draw anything, and each is bounded:
   *  - `groups` — one `GROUP BY` over the member's rows, no labels resolved.
   *  - `owned` — the counts-only section; owned rows are never listed (§3.2).
   *  - `typeGrants` — the pinned "Record types" group. Bounded by the org's
   *    definition count (one row per `(def, grantee)` unique constraint), and
   *    the group is pinned open-able from first paint, so a lazy second call
   *    would buy nothing.
   */
  shareSummary: permissionProcedure(PermissionKey.membersManage)
    .input(z.object({ memberId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await assertMemberShareAuthority(organizationId, userId, input.memberId, 'read')

      const summary = await getMemberShareSummary(ctx.db, {
        organizationId,
        userId: input.memberId,
      })
      if (summary.isErr()) throw summary.error

      const typeGrants = await listMemberTypeGrants(ctx.db, {
        organizationId,
        userId: input.memberId,
      })
      if (typeGrants.isErr()) throw typeGrants.error

      // Headings resolve HERE rather than on the client. `MEMBER_SHARE_GROUPS`
      // lives in `resource-access/classify.ts`, mirrored through
      // `resource-access/client.ts` — but resolving server side also gets the
      // record-def names and glyphs off the org `resources` cache, which the tab
      // would otherwise need a second round trip for.
      const describe = await buildShareGroupDescriber(organizationId)

      return {
        groups: summary.value.groups.map((g) => ({
          ...g,
          ...describe(g.groupKey, g.entityDefinitionId),
        })),
        owned: summary.value.owned.map((o) => ({
          ...o,
          label: MEMBER_SHARE_GROUPS[o.groupKey].label,
          ownedRemoval: MEMBER_SHARE_GROUPS[o.groupKey].ownedRemoval ?? null,
        })),
        typeGrants: typeGrants.value.map((t) => ({
          ...t,
          ...describe(groupKeyForDef(t.entityDefinitionId), t.entityDefinitionId),
        })),
        /**
         * How deep a search may scan one group before it truncates.
         *
         * Sent to the client because the tab has to say so: search matches the
         * RESOLVED, already-redacted label rather than running an `ILIKE`
         * against `Thread.subject` (which would match on a subject the viewer
         * may not read and leak it through the result count), and the price of
         * that is a scan bounded by row count instead of an index. A group with
         * more rows than this cap is searching only its most recent, and a
         * search UI that does not admit that is lying.
         */
        searchScanCap: MEMBER_SHARES_SEARCH_SCAN_CAP,
      }
    }),

  /**
   * One page of one group, fired by the group row's expand (§3.1/§6.5).
   *
   * `userId` in the ctx is the VIEWER, never the subject: mail labels resolve
   * through the thread lens against whoever is looking, so an admin with
   * `members.manage` and no authority on the inbox sees
   * `Conversation in <inbox>` and never a subject (§5.1).
   */
  shares: permissionProcedure(PermissionKey.membersManage)
    .input(
      z.object({
        memberId: z.string(),
        entityDefinitionId: z.string().min(1),
        cursor: z.string().nullish(),
        limit: z.number().int().min(1).max(MEMBER_SHARES_PAGE_SIZE).optional(),
        q: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await assertMemberShareAuthority(organizationId, userId, input.memberId, 'read')

      const page = await listMemberShares(
        { db: ctx.db, organizationId, userId },
        {
          organizationId,
          userId: input.memberId,
          entityDefinitionId: input.entityDefinitionId,
          cursor: input.cursor,
          limit: input.limit,
          q: input.q,
        }
      )
      if (page.isErr()) throw page.error

      const { noun } = (await buildShareGroupDescriber(organizationId))(
        groupKeyForDef(input.entityDefinitionId),
        input.entityDefinitionId
      )

      return {
        ...page.value,
        items: page.value.items.map((item) => {
          const instanceId = item.recordId.slice(item.recordId.indexOf(':') + 1)
          // TOMBSTONE COPY only. Whether the target is gone is lib's answer
          // (`MemberShareItem.targetMissing`), decided by whether the label
          // query FOUND the row — never by whether it produced a label, because
          // `EntityInstance.displayName` is nullable and a live record with no
          // display name would otherwise read as deleted.
          //
          // A cuid tells the reader nothing, so the label becomes the tombstone
          // and the id survives in `targetId` for support. The row stays
          // selectable and revocable: clearing exactly these is one of the few
          // things this tab can do that nothing else can.
          return {
            ...item,
            targetId: instanceId,
            label: item.targetMissing ? `Deleted ${noun}` : item.label,
          }
        }),
      }
    }),

  /**
   * Bulk revoke, one `DELETE ... RETURNING` behind a SCOPE (§4.1).
   *
   * A scope rather than a list of ids because a paginated list plus an id-list
   * mutation means "Remove all" silently misses every unloaded row — the exact
   * failure the tab exists to prevent. Owner rows are excluded in SQL inside the
   * mutation, in every scope; type-level rows are never swept.
   */
  revokeShares: permissionProcedure(PermissionKey.membersManage)
    .input(z.object({ memberId: z.string(), scope: revokeScopeSchema }))
    .use(notDemo('revoke shared items'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await assertMemberShareAuthority(organizationId, userId, input.memberId, 'write')

      const result = await revokeMemberShares(
        { db: ctx.db, organizationId, userId },
        { userId: input.memberId, scope: input.scope as RevokeMemberSharesScope }
      )
      if (result.isErr()) throw result.error

      // ONE audit row per call, whatever the scope covers — same category and
      // action `resourceAccess.revokeInstance` records, so the two revoke paths
      // read as one event type in the security feed. The counts are what make a
      // sweep legible after the fact; the deleted rows themselves are gone.
      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.revoked',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        metadata: {
          scope: input.scope.kind,
          entityDefinitionId:
            input.scope.kind === 'type' ? input.scope.entityDefinitionId : undefined,
          granteeType: 'user',
          granteeId: input.memberId,
          revoked: result.value.revoked,
          refused: result.value.refused,
        },
      })

      return result.value
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

      // Assignment is the only path that writes a rank, so this row is also the
      // rank-change record (there is no `member.role_changed` action — see
      // AUDIT_ACTIONS). `previousState.role` is what makes a promotion or
      // demotion visible rather than just the landing state.
      await recordAuditFromCtx(ctx, {
        category: 'members',
        action: 'member.profile_assigned',
        targetType: 'OrganizationMember',
        targetId: input.memberId,
        previousState: { role: result.previousRole },
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
          organizationName: org?.name ?? null,
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
              organizationName: org?.name ?? null,
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

      const dehydrationService = new DehydrationService()
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

      const dehydrationService = new DehydrationService()
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
