// packages/lib/src/members/invitation-profile.ts

import { type Database, database, schema } from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { recordAudit } from '../audit-log'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
// Deep import, not the `../permissions/profiles` barrel: the barrel pulls the
// agent-policy + invalidation stack (cache, realtime) into every module that
// only needs the null-binding fallback rule.
import { systemProfileFor } from '../permissions/profiles/system-profiles'
import type { ProfileAppliesTo } from '../permissions/profiles/types'

const logger = createScopedLogger('invitation-profile')

/**
 * Audit action written when an invitation is created WITH a permission profile.
 *
 * This row is the only durable evidence that a binding ever existed:
 * `OrganizationInvitation.permissionProfileId` is `onDelete: 'set null'`, so
 * deleting the profile before acceptance erases the id from the invitation and
 * makes it indistinguishable from "no profile was chosen". Acceptance reads this
 * row (indexed by `(targetType, targetId)`) to tell the two apart and flag the
 * deleted-profile case rather than substituting silently (§1.1).
 */
export const INVITATION_PROFILE_BOUND_ACTION = 'member.invitation_profile_bound'

/**
 * Audit action written when acceptance could NOT honor the invitation's profile
 * and fell back to the system template. Customer-visible (`visibility: 'admin'`)
 * — the "flag" §1.1 requires.
 */
export const INVITATION_PROFILE_MISSING_ACTION = 'member.invitation_profile_missing'

/** A permission profile that may be bound to a human invitation. */
export interface InvitableProfile {
  id: string
  slug: string
  name: string
  /** Drives the invite-time seat cap check and the accepted member's `seatType`. */
  seat: SeatType
  appliesTo: ProfileAppliesTo
  /**
   * The rank this profile confers (plan 21 §2.a): replaces any caller-supplied
   * role, exactly as `seat` replaces the caller's seat class. The invite rank
   * guards must run against THIS value, not the form input.
   */
  role: OrganizationRole
}

/** Why acceptance could not honor the invitation's profile binding. */
export type InvitationProfileFallbackReason =
  /** Bound at invite time; the profile row is gone (FK nulled the column). */
  | 'deleted'
  /** The id survived on the row but the profile row does not exist. */
  | 'dangling'
  /** The profile belongs to a different organization (§1.1 cross-org integrity). */
  | 'foreign_org'
  /** An agent-only profile can never apply to a member. */
  | 'agent_profile'
  /** The profile's (immutable) seat class no longer matches the invitation's. */
  | 'seat_mismatch'

/** The flag returned to callers so acceptance is never silent about a fallback. */
export interface InvitationProfileFallback {
  reason: InvitationProfileFallbackReason
  /** The profile the invitation was created with, when still recoverable. */
  boundProfileId: string | null
  boundProfileSlug: string | null
  /** System template the member falls back to — a null binding resolves here (§1.3). */
  systemProfileSlug: string
}

/** Outcome of resolving an invitation's profile binding at acceptance. */
export interface ResolvedInvitationProfile {
  /** Value to write onto the new `OrganizationMember`; `null` = system template. */
  permissionProfileId: string | null
  fallback: InvitationProfileFallback | null
}

/**
 * Load the profile chosen in the invite UI and refuse anything a member may not
 * be given.
 *
 * A plain FK does not guarantee the profile and the principal share an org, so
 * the org is compared explicitly rather than filtered in the `where` — a foreign
 * profile must be a loud `403`, not a silent "not found" (§1.1).
 *
 * @throws NotFoundError when the profile does not exist.
 * @throws ForbiddenError when it belongs to another organization.
 * @throws BadRequestError when it is an agent-only profile.
 */
export async function loadInvitableProfile(
  params: { organizationId: string; permissionProfileId: string },
  db: Database = database
): Promise<InvitableProfile> {
  const { organizationId, permissionProfileId } = params

  const [profile] = await db
    .select({
      id: schema.PermissionProfile.id,
      slug: schema.PermissionProfile.slug,
      name: schema.PermissionProfile.name,
      seat: schema.PermissionProfile.seat,
      appliesTo: schema.PermissionProfile.appliesTo,
      role: schema.PermissionProfile.role,
      organizationId: schema.PermissionProfile.organizationId,
    })
    .from(schema.PermissionProfile)
    .where(eq(schema.PermissionProfile.id, permissionProfileId))
    .limit(1)

  if (!profile) {
    throw new NotFoundError('The selected permission profile no longer exists.')
  }
  if (profile.organizationId !== organizationId) {
    logger.error('Cross-org permission profile rejected on invite', {
      organizationId,
      permissionProfileId,
      profileOrganizationId: profile.organizationId,
    })
    throw new ForbiddenError('That permission profile belongs to another organization.')
  }
  if (profile.appliesTo === 'agent') {
    throw new BadRequestError('That permission profile applies to agents, not members.')
  }

  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    seat: profile.seat,
    appliesTo: profile.appliesTo,
    role: profile.role,
  }
}

/**
 * Record that an invitation was created with a profile binding — see
 * {@link INVITATION_PROFILE_BOUND_ACTION}. Fire-and-forget: a failed audit write
 * must never fail the invite (the worst case is that a later deleted-profile
 * fallback is reported as "no profile was chosen").
 */
export async function recordInvitationProfileBound(params: {
  organizationId: string
  invitationId: string
  invitedById: string
  email: string
  profile: InvitableProfile
}): Promise<void> {
  const { organizationId, invitationId, invitedById, email, profile } = params

  const result = await recordAudit({
    organizationId,
    category: 'members',
    action: INVITATION_PROFILE_BOUND_ACTION,
    actorType: 'user',
    actorId: invitedById,
    targetType: 'OrganizationInvitation',
    targetId: invitationId,
    metadata: {
      email,
      permissionProfileId: profile.id,
      permissionProfileSlug: profile.slug,
      permissionProfileName: profile.name,
      seat: profile.seat,
    },
    visibility: 'admin',
  })

  if (result.isErr()) {
    logger.warn('Failed to record invitation profile binding', {
      organizationId,
      invitationId,
      error: result.error.message,
    })
  }
}

/** The profile an invitation was created with, recovered from the audit trail. */
async function findBoundProfileFromAudit(
  params: { organizationId: string; invitationId: string },
  db: Database
): Promise<{ id: string | null; slug: string | null } | null> {
  const { organizationId, invitationId } = params

  try {
    const [entry] = await db
      .select({ metadata: schema.AuditLog.metadata })
      .from(schema.AuditLog)
      .where(
        and(
          eq(schema.AuditLog.organizationId, organizationId),
          eq(schema.AuditLog.targetType, 'OrganizationInvitation'),
          eq(schema.AuditLog.targetId, invitationId),
          eq(schema.AuditLog.action, INVITATION_PROFILE_BOUND_ACTION)
        )
      )
      .orderBy(desc(schema.AuditLog.createdAt))
      .limit(1)

    if (!entry) return null

    const metadata = (entry.metadata ?? {}) as Record<string, unknown>
    const id =
      typeof metadata.permissionProfileId === 'string' ? metadata.permissionProfileId : null
    const slug =
      typeof metadata.permissionProfileSlug === 'string' ? metadata.permissionProfileSlug : null
    return { id, slug }
  } catch (error) {
    // The audit probe is diagnostics for the flag, never a gate on joining.
    logger.warn('Failed to probe audit trail for invitation profile binding', {
      organizationId,
      invitationId,
      error,
    })
    return null
  }
}

/** Write the flag: an admin-visible audit row plus a loud log line. */
async function flagFallback(
  params: {
    organizationId: string
    invitationId: string
    email: string
    role: OrganizationRole
    seatType: SeatType
  },
  fallback: InvitationProfileFallback
): Promise<void> {
  const { organizationId, invitationId, email, role, seatType } = params

  logger.error('Invitation permission profile could not be applied — using system template', {
    organizationId,
    invitationId,
    email,
    role,
    seatType,
    ...fallback,
  })

  const result = await recordAudit({
    organizationId,
    category: 'members',
    action: INVITATION_PROFILE_MISSING_ACTION,
    actorType: 'system',
    targetType: 'OrganizationInvitation',
    targetId: invitationId,
    reason: `The permission profile on this invitation could not be applied (${fallback.reason}); the member joined on the "${fallback.systemProfileSlug}" system profile.`,
    metadata: { email, role, seatType, ...fallback },
    visibility: 'admin',
  })

  if (result.isErr()) {
    logger.error('Failed to flag invitation permission-profile fallback', {
      organizationId,
      invitationId,
      error: result.error.message,
    })
  }
}

/**
 * Resolve the permission profile an accepting member should be bound to (§1.1).
 *
 * The happy path carries the invitation's profile straight onto the new
 * `OrganizationMember`, which is the whole point of the column — without it the
 * choice made at invite time is rebuilt from `role` + `seatType` alone and lost.
 *
 * Every unusable binding falls back to the system template for the invited role
 * (§1.3, resolved from a `null` binding so a later role change still re-resolves)
 * **and is flagged** — an admin-visible audit row against the invitation plus a
 * returned {@link InvitationProfileFallback}. It is never silent.
 *
 * The deleted-profile case is the reason the audit probe exists: the FK nulls the
 * column, so the only way to tell "profile deleted" from "no profile chosen" is
 * the `member.invitation_profile_bound` row written at invite time.
 */
export async function resolveInvitationProfile(
  params: {
    invitation: {
      id: string
      organizationId: string
      email: string
      permissionProfileId: string | null
    }
    /** Role the member is actually created with (after the worker clamp). */
    role: OrganizationRole
    /** Seat class the member is actually created with. */
    seatType: SeatType
  },
  db: Database = database
): Promise<ResolvedInvitationProfile> {
  const { invitation, role, seatType } = params
  const systemProfileSlug = systemProfileFor(role, seatType)

  const fallbackTo = async (
    reason: InvitationProfileFallbackReason,
    bound: { id: string | null; slug: string | null }
  ): Promise<ResolvedInvitationProfile> => {
    const fallback: InvitationProfileFallback = {
      reason,
      boundProfileId: bound.id,
      boundProfileSlug: bound.slug,
      systemProfileSlug,
    }
    await flagFallback(
      {
        organizationId: invitation.organizationId,
        invitationId: invitation.id,
        email: invitation.email,
        role,
        seatType,
      },
      fallback
    )
    return { permissionProfileId: null, fallback }
  }

  if (invitation.permissionProfileId) {
    const [profile] = await db
      .select({
        id: schema.PermissionProfile.id,
        slug: schema.PermissionProfile.slug,
        seat: schema.PermissionProfile.seat,
        appliesTo: schema.PermissionProfile.appliesTo,
        organizationId: schema.PermissionProfile.organizationId,
      })
      .from(schema.PermissionProfile)
      .where(eq(schema.PermissionProfile.id, invitation.permissionProfileId))
      .limit(1)

    if (!profile) {
      return fallbackTo('dangling', { id: invitation.permissionProfileId, slug: null })
    }
    if (profile.organizationId !== invitation.organizationId) {
      return fallbackTo('foreign_org', { id: profile.id, slug: profile.slug })
    }
    if (profile.appliesTo === 'agent') {
      return fallbackTo('agent_profile', { id: profile.id, slug: profile.slug })
    }
    // `seat` is immutable (§0.18), so this can only fire if the invitation's own
    // seat class was rewritten after the binding — still worth refusing loudly.
    if (profile.seat !== seatType) {
      return fallbackTo('seat_mismatch', { id: profile.id, slug: profile.slug })
    }

    return { permissionProfileId: profile.id, fallback: null }
  }

  const bound = await findBoundProfileFromAudit(
    { organizationId: invitation.organizationId, invitationId: invitation.id },
    db
  )
  if (!bound) {
    // No binding was ever made — the member joins on the system template, which
    // is the documented default, not a fallback.
    return { permissionProfileId: null, fallback: null }
  }

  return fallbackTo('deleted', bound)
}
