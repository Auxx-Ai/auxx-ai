// packages/lib/src/permissions/profiles/profile-queries.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import type { ProfileActor } from '@auxx/types/actor'
import { toActorId } from '@auxx/types/actor'
import { getCachedPermissionProfiles } from '../../cache'
import { NotFoundError } from '../../errors'
import type { Level } from '../capabilities/registry'
import type {
  AgentPermissionPolicy,
  CachedPermissionProfile,
  ProfileAppliesTo,
  ProfileCeiling,
} from './types'
import { SYSTEM_PROFILE_SLUGS } from './types'

/**
 * The read side of permission profiles: every picker, grantee row and profile
 * screen resolves a profile from the already-cached `profiles` org-cache key
 * (doc 19 §8.1), so listing them costs **no query**. Nothing here writes;
 * authoring lives in `profile-mutations.ts` / `profile-save.ts`.
 *
 * Every function takes the caller's `organizationId` and reads only that org's
 * cache entry — a profile from another org is not reachable through this module.
 */

/**
 * A profile as a picker/list row. Deliberately omits `ceiling` and
 * `agentPolicy`: a list renders identity, not policy, and the two policy blobs
 * are the large fields. Fetch them with {@link getPermissionProfile}.
 */
export interface PermissionProfileSummary {
  id: string
  slug: string
  name: string
  description: string | null
  icon: { iconId: string; color: string } | null
  /** Seat class this profile is authored for — immutable after creation (§0.18). */
  seat: SeatType
  /** Which principal kind may bind it (§0.18, immutable). */
  appliesTo: ProfileAppliesTo
  /**
   * The rank the profile confers on assignment (plan 21 §2.a) — non-`USER` only
   * on the system owner/admin rows (21 §2.0.1). Drives the picker rank filters
   * and the rank badge; never authorable.
   */
  role: OrganizationRole
  /** Seeded template row: not deletable, `slug`/`seat`/`appliesTo` locked. */
  isSystem: boolean
  /** Fallback rung for areas the profile does not set; `null` = fall through to `ROLE_DEFAULTS` (§0.7). */
  baseLevel: Level | null
}

/** One profile with its policy payload — the editor/detail shape. */
export interface PermissionProfileDetail extends PermissionProfileSummary {
  /**
   * The unauthored per-area clamp (plan 20 §2.a.3). `null` for every profile in
   * practice — nothing writes it — and no editor control reads it; returned so the
   * detail shape still mirrors what composition consumes.
   */
  ceiling: ProfileCeiling | null
  /** Agent exact policy (§2.3). `null` for human-only profiles. */
  agentPolicy: AgentPermissionPolicy | null
  /** ISO-8601, or `null` when the cached projection carried no timestamp. */
  updatedAt: string | null
}

/** Seeded slugs first, in their canonical §5.1 order; custom profiles after. */
const SYSTEM_SLUG_ORDER = new Map<string, number>(SYSTEM_PROFILE_SLUGS.map((s, i) => [s, i]))

function orderRank(profile: CachedPermissionProfile): number {
  return SYSTEM_SLUG_ORDER.get(profile.slug) ?? SYSTEM_PROFILE_SLUGS.length
}

/**
 * Stable ordering for every profile surface: the seeded ladder
 * (owner → admin → member → field_tech → agent → chat_agent) then custom rows
 * alphabetically. Deterministic so a picker never reshuffles between renders.
 */
function compareProfiles(a: CachedPermissionProfile, b: CachedPermissionProfile): number {
  const rank = orderRank(a) - orderRank(b)
  if (rank !== 0) return rank
  return a.name.localeCompare(b.name)
}

/** Project a cached profile into the list/picker row shape. */
export function toProfileSummary(profile: CachedPermissionProfile): PermissionProfileSummary {
  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    description: profile.description,
    icon: profile.icon,
    seat: profile.seat,
    appliesTo: profile.appliesTo,
    role: profile.role,
    isSystem: profile.isSystem,
    baseLevel: profile.baseLevel,
  }
}

/** Project a cached profile into the detail shape (summary + `ceiling` + `agentPolicy`). */
export function toProfileDetail(profile: CachedPermissionProfile): PermissionProfileDetail {
  return {
    ...toProfileSummary(profile),
    ceiling: profile.ceiling,
    agentPolicy: profile.agentPolicy,
    updatedAt: profile.updatedAt,
  }
}

/**
 * Resolve a cached profile to a {@link ProfileActor} — the grantee-row identity
 * used by actor pickers and `ActorService`. Every field is already on the cached
 * projection, so this is pure mapping.
 */
export function toProfileActor(profile: CachedPermissionProfile): ProfileActor {
  return {
    actorId: toActorId('profile', profile.id),
    type: 'profile',
    name: profile.name,
    avatarUrl: null,
    profileId: profile.id,
    slug: profile.slug,
    description: profile.description,
    seat: profile.seat,
    appliesTo: profile.appliesTo,
    isSystem: profile.isSystem,
  }
}

/** Filters for {@link listPermissionProfiles}. */
export interface ListPermissionProfilesOptions {
  /**
   * Keep only profiles bindable by this principal kind. `'any'` profiles always
   * match; passing nothing returns every profile.
   */
  appliesTo?: 'member' | 'agent'
  /** Keep only profiles authored for this seat class (§0.21 picker filtering). */
  seat?: SeatType
}

/** True when `profile` may be bound by a principal of kind `appliesTo`. */
function matchesAppliesTo(
  profile: CachedPermissionProfile,
  appliesTo: 'member' | 'agent'
): boolean {
  return profile.appliesTo === appliesTo || profile.appliesTo === 'any'
}

/**
 * Every permission profile in the org, ordered and projected for lists/pickers.
 * Reads the `profiles` org cache — the same rows `computeUserCapabilities`
 * composes from, so a picker can never offer a profile the composer does not
 * read.
 */
export async function listPermissionProfiles(
  organizationId: string,
  options: ListPermissionProfilesOptions = {}
): Promise<PermissionProfileSummary[]> {
  const profiles = await getCachedPermissionProfiles(organizationId)
  return profiles
    .filter((p) => (options.appliesTo ? matchesAppliesTo(p, options.appliesTo) : true))
    .filter((p) => (options.seat ? p.seat === options.seat : true))
    .sort(compareProfiles)
    .map(toProfileSummary)
}

/**
 * Every profile in the org as {@link ProfileActor}s — the grantee-picker feed.
 * Agent profiles are excluded by default because they are not valid sharing
 * grantees (`grantee-schema.ts` rejects them on write).
 */
export async function listProfileActors(
  organizationId: string,
  options: ListPermissionProfilesOptions = { appliesTo: 'member' }
): Promise<ProfileActor[]> {
  const profiles = await getCachedPermissionProfiles(organizationId)
  return profiles
    .filter((p) => (options.appliesTo ? matchesAppliesTo(p, options.appliesTo) : true))
    .filter((p) => (options.seat ? p.seat === options.seat : true))
    .sort(compareProfiles)
    .map(toProfileActor)
}

/**
 * One profile, scoped to `organizationId`. Returns `null` for an unknown id
 * **or** an id belonging to another org — the cache read is per-org, so a
 * foreign profile is indistinguishable from a missing one and neither leaks.
 */
export async function findPermissionProfile(
  organizationId: string,
  profileId: string
): Promise<PermissionProfileDetail | null> {
  const profiles = await getCachedPermissionProfiles(organizationId)
  const profile = profiles.find((p) => p.id === profileId)
  return profile ? toProfileDetail(profile) : null
}

/**
 * One profile, scoped to `organizationId`.
 * @throws NotFoundError when the id is unknown in this org.
 */
export async function getPermissionProfile(
  organizationId: string,
  profileId: string
): Promise<PermissionProfileDetail> {
  const profile = await findPermissionProfile(organizationId, profileId)
  if (!profile) throw new NotFoundError('Permission profile not found')
  return profile
}

/**
 * Batch-resolve profile ids to {@link ProfileActor}s. Unknown or cross-org ids
 * are dropped, never faked — the caller renders a generic row for the gap.
 */
export async function getProfileActorsByIds(
  organizationId: string,
  profileIds: string[]
): Promise<ProfileActor[]> {
  if (profileIds.length === 0) return []
  const profiles = await getCachedPermissionProfiles(organizationId)
  const wanted = new Set(profileIds)
  return profiles.filter((p) => wanted.has(p.id)).map(toProfileActor)
}
