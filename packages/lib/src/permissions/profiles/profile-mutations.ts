// packages/lib/src/permissions/profiles/profile-mutations.ts

import { type Database, database, type PermissionProfileEntity, schema } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError } from '../../errors'
import { FeaturePermissionService } from '../feature-permission-service'
import { FeatureKey } from '../types'
import { emitPermissionProfileChanged } from './profile-invalidation'
import type { AgentPermissionPolicy, ProfileAppliesTo, ProfileCeiling } from './types'
import { SYSTEM_PROFILE_SLUGS } from './types'

const SYSTEM_SLUG_SET = new Set<string>(SYSTEM_PROFILE_SLUGS)

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
  ceiling?: ProfileCeiling | null
  agentPolicy?: AgentPermissionPolicy | null
  db?: Database
}

/**
 * Create a custom permission profile.
 *
 * `isSystem` is never authorable and the six reserved system slugs are refused —
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

  const [row] = await db
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
      // The column is generic jsonb (schema is tier 1 and cannot see lib's
      // `Area`/`Level`); lib narrows on read via `parseProfileCeiling`.
      ceiling: (input.ceiling ?? null) as Record<string, unknown> | null,
      agentPolicy: input.agentPolicy ?? null,
      isSystem: false,
    })
    .returning()

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
 * requires ONE transactional save carrying metadata, levels, the ceiling and (at
 * step 9) the def/instance rows together, because a save spanning several
 * requests cannot enforce one atomic "resulting effective state" check. A
 * metadata-only side door would be exactly that multi-request variant.
 *
 * `seat`, `appliesTo`, `slug` and `isSystem` stay immutable after creation
 * (§0.18) — changing seat class is "clone the profile and reassign", which
 * re-runs the per-holder cap check.
 */
