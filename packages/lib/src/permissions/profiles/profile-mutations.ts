// packages/lib/src/permissions/profiles/profile-mutations.ts

import { type Database, database, type PermissionProfileEntity, schema } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors'
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

/** Fields a caller may author on create. */
export interface CreatePermissionProfileInput {
  organizationId: string
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
 */
export async function createPermissionProfile(
  input: CreatePermissionProfileInput
): Promise<PermissionProfileEntity> {
  const { organizationId, slug, name } = input
  const db = input.db ?? database

  if (SYSTEM_SLUG_SET.has(slug)) {
    throw new BadRequestError(`'${slug}' is a reserved system profile slug.`)
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
 * The mutable half of a profile. `seat`, `appliesTo`, `slug` and `isSystem` are
 * deliberately absent — they are IMMUTABLE after creation (§0.18). Editing `seat`
 * under existing holders would leave them on a profile whose declared class no
 * longer matches their billed `seatType`, bypassing the core invariant; changing
 * seat class is "clone the profile and reassign", which re-runs the per-holder cap
 * check.
 */
export interface UpdatePermissionProfileInput {
  organizationId: string
  profileId: string
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  baseLevel?: number | null
  ceiling?: ProfileCeiling | null
  agentPolicy?: AgentPermissionPolicy | null
  db?: Database
}

/**
 * Update a permission profile's mutable fields, then fan out the §8.3
 * invalidation (which reaches NULL-BOUND holders for a system profile).
 *
 * Immutability is enforced structurally — {@link UpdatePermissionProfileInput}
 * cannot express a `seat`/`appliesTo`/`slug`/`isSystem` change — plus these
 * runtime guards for callers coming in over the wire:
 *  - the profile must belong to `organizationId` (cross-org writes are refused
 *    even though the FK alone cannot guarantee co-tenancy — §1.1);
 *  - the `owner` system profile is not editable and is **never ceilinged**
 *    (§0.10): its unconditional bypass is the recovery guarantee, so a ceiling
 *    there would be a lie the UI must not be able to author.
 */
export async function updatePermissionProfile(
  input: UpdatePermissionProfileInput
): Promise<PermissionProfileEntity> {
  const { organizationId, profileId } = input
  const db = input.db ?? database

  const [existing] = await db
    .select({
      id: schema.PermissionProfile.id,
      slug: schema.PermissionProfile.slug,
      isSystem: schema.PermissionProfile.isSystem,
    })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!existing) throw new NotFoundError('Permission profile not found in this organization.')
  if (existing.slug === 'owner') {
    throw new ForbiddenError(
      'The Owner profile is not editable and can never carry a ceiling — it is the recovery guarantee.'
    )
  }

  await requireGranularPermissions(db, organizationId)

  const patch: Partial<PermissionProfileEntity> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description
  if (input.icon !== undefined) patch.icon = input.icon
  if (input.baseLevel !== undefined) patch.baseLevel = input.baseLevel
  if (input.ceiling !== undefined) patch.ceiling = input.ceiling as Record<string, unknown> | null
  if (input.agentPolicy !== undefined) patch.agentPolicy = input.agentPolicy

  if (Object.keys(patch).length === 0) {
    throw new BadRequestError('No updatable permission-profile fields were provided.')
  }

  const [row] = await db
    .update(schema.PermissionProfile)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
    .returning()

  await emitPermissionProfileChanged({
    organizationId,
    profileId,
    slug: existing.slug,
    isSystem: existing.isSystem,
  })
  return row as PermissionProfileEntity
}
