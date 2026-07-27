// packages/lib/src/permissions/profiles/profile-mutations.ts

import { type Database, database, type PermissionProfileEntity, schema } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError, ForbiddenError } from '../../errors'
import { FeaturePermissionService } from '../feature-permission-service'
import { FeatureKey } from '../types'
import { emitPermissionProfileChanged } from './profile-invalidation'
import type { AgentPermissionPolicy, ProfileAppliesTo } from './types'
import { SYSTEM_PROFILE_SLUGS } from './types'

const SYSTEM_SLUG_SET = new Set<string>(SYSTEM_PROFILE_SLUGS)

/** Postgres unique-violation on `(organizationId, slug)`, however it is wrapped. */
function isUniqueSlugViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const candidate = e as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (
      candidate.code === '23505' &&
      (candidate.constraint === undefined ||
        candidate.constraint === 'PermissionProfile_organizationId_slug_key')
    ) {
      return true
    }
    e = candidate.cause
  }
  return false
}

/**
 * Enterprise gate — authoring profiles requires the plan feature (§0.26). System
 * SEEDING is deliberately exempt (`ensureSystemProfiles` never calls this), so a
 * Free org still gets `ROLE_DEFAULTS` through empty system profiles it cannot
 * edit — today's member-baseline behavior.
 */
async function requireGranularPermissions(db: Database, organizationId: string): Promise<void> {
  await new FeaturePermissionService(db).requireAccess(
    organizationId,
    FeatureKey.granularPermissions
  )
}

/**
 * The OWNER/ADMIN-only rule for agent-side profiles (§0.25 / doc 14 §0.9).
 * `permissions` becoming grantable must never hand agent policy to a non-admin,
 * so every agent-profile write resolves the actor's role first.
 */
async function assertAgentProfileActor(
  db: Database,
  organizationId: string,
  actorUserId: string
): Promise<void> {
  const [member] = await db
    .select({ role: schema.OrganizationMember.role })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.userId, actorUserId)
      )
    )
    .limit(1)

  if (member?.role !== 'OWNER' && member?.role !== 'ADMIN') {
    throw new ForbiddenError(
      'Only owners and admins can create an agent permission profile (doc 14 §0.9).'
    )
  }
}

/** Fields a caller may author on create. */
export interface CreatePermissionProfileInput {
  organizationId: string
  /** Who is creating it — gates the agent-profile branch (§0.25). */
  actorUserId: string
  slug: string
  name: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  /** IMMUTABLE after creation (§0.18) — changing seat class means clone + reassign. */
  seat?: SeatType
  /** IMMUTABLE after creation (§0.18). */
  appliesTo?: ProfileAppliesTo
  baseLevel?: number | null
  agentPolicy?: AgentPermissionPolicy | null
  db?: Database
}

/**
 * Create a custom permission profile.
 *
 * `isSystem` is never authorable and the reserved system slugs are refused —
 * a custom profile can never shadow the template a null binding resolves to.
 *
 * **The §6.1 escalation guard deliberately does not run here.** A brand-new
 * profile has no holders, so its resulting-effective-state comparison is vacuous
 * by construction; the authority check bites where the access actually reaches a
 * principal — `savePermissionProfile` (holders) and profile assignment (§6.1.3's
 * `{M}` row, step 8).
 */
export async function createPermissionProfile(
  input: CreatePermissionProfileInput
): Promise<PermissionProfileEntity> {
  const { organizationId, actorUserId, slug, name } = input
  const db = input.db ?? database

  if (SYSTEM_SLUG_SET.has(slug)) {
    throw new BadRequestError(`'${slug}' is a reserved system profile slug.`)
  }
  if (input.appliesTo === 'agent' || input.agentPolicy) {
    await assertAgentProfileActor(db, organizationId, actorUserId)
  }
  await requireGranularPermissions(db, organizationId)

  const [existing] = await db
    .select({ id: schema.PermissionProfile.id })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.organizationId, organizationId),
        eq(schema.PermissionProfile.slug, slug)
      )
    )
    .limit(1)
  if (existing) {
    throw new ConflictError(`A permission profile with the slug '${slug}' already exists.`)
  }

  const rows = await db
    .insert(schema.PermissionProfile)
    .values({
      // `id` omitted — the column's `$defaultFn(createId)` mints it.
      organizationId,
      slug,
      name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      seat: input.seat ?? 'full',
      appliesTo: input.appliesTo ?? 'member',
      baseLevel: input.baseLevel ?? null,
      // Always `null`: the ceiling has no authoring surface (plan 20 §2.a.1), so
      // nothing — not this mutation, not the seeds, not `savePermissionProfile` —
      // writes it. It survives only as the clamp seam in `composeUserCapabilities`.
      ceiling: null,
      agentPolicy: input.agentPolicy ?? null,
      isSystem: false,
    })
    .returning()
    .catch((error: unknown) => {
      // The check above races a concurrent create, so the unique index is the
      // real arbiter. Without this the caller gets a raw 23505 as a 500.
      if (isUniqueSlugViolation(error)) {
        throw new ConflictError(`A permission profile with the slug '${slug}' already exists.`)
      }
      throw error
    })
  const [row] = rows

  const profile = row as PermissionProfileEntity
  await emitPermissionProfileChanged({
    organizationId,
    profileId: profile.id,
    slug: profile.slug,
    isSystem: false,
  })
  return profile
}

/**
 * The mutable half of a profile is authored exclusively by
 * `savePermissionProfile` (`profile-save.ts`).
 *
 * There is deliberately **no** standalone `updatePermissionProfile`: §6.1.4
 * requires ONE transactional save carrying metadata, levels and (at step 9) the
 * def/instance rows together, because a save spanning several requests cannot
 * enforce one atomic "resulting effective state" check. A metadata-only side door
 * would be exactly that multi-request variant.
 *
 * `seat`, `appliesTo`, `slug` and `isSystem` stay immutable after creation
 * (§0.18) — changing seat class is "clone the profile and reassign", which
 * re-runs the per-holder cap check.
 */
