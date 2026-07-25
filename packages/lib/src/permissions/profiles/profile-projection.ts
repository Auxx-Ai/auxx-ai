// packages/lib/src/permissions/profiles/profile-projection.ts

import type { PermissionProfileEntity } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { Level, parseAreaLevels } from '../capabilities/registry'
import type {
  AgentPermissionPolicy,
  CachedPermissionProfile,
  ProfileAppliesTo,
  ProfileCeiling,
  ProfileDefCeiling,
} from './types'

/**
 * Defensively coerce a stored `PermissionProfile.ceiling` jsonb into the trusted
 * {@link ProfileCeiling} shape: `areas` goes through `parseAreaLevels` (unknown
 * area slugs dropped, rungs clamped) and `defs` is kept only when it carries a
 * valid mode plus a string array. Returns `null` for anything unusable, which
 * composition reads as "uncapped".
 *
 * `defs` stays slug-keyed here; `getCapabilities` resolves it into the
 * `entityDefinitionId` keyspace on read, where the record resolvers enforce it.
 */
export function parseProfileCeiling(raw: unknown): ProfileCeiling | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as { areas?: unknown; defs?: unknown }

  const areas = source.areas ? parseAreaLevels(source.areas) : undefined

  let defs: ProfileDefCeiling | null = null
  if (source.defs && typeof source.defs === 'object') {
    const candidate = source.defs as { mode?: unknown; slugs?: unknown }
    const mode = candidate.mode === 'only' || candidate.mode === 'except' ? candidate.mode : null
    const slugs = Array.isArray(candidate.slugs)
      ? candidate.slugs.filter((s): s is string => typeof s === 'string')
      : null
    if (mode && slugs) defs = { mode, slugs }
  }

  const hasAreas = !!areas && Object.keys(areas).length > 0
  if (!hasAreas && !defs) return null
  return { ...(hasAreas ? { areas } : {}), ...(defs ? { defs } : {}) }
}

/** Clamp a stored `baseLevel` integer into the `Level` ladder, or `null`. */
function parseBaseLevel(raw: number | null): Level | null {
  if (raw === null || !Number.isFinite(raw)) return null
  return Math.min(Level.Full, Math.max(Level.None, Math.floor(raw))) as Level
}

/**
 * Project a `PermissionProfile` row into the JSON-serializable cache shape.
 * Shared by the `profiles` org-cache provider and any direct (in-transaction)
 * read that needs the same coercion.
 */
export function projectPermissionProfile(row: {
  id: string
  slug: string
  name: string
  description: string | null
  icon: PermissionProfileEntity['icon']
  seat: SeatType
  appliesTo: string
  baseLevel: number | null
  ceiling: unknown
  agentPolicy: unknown
  isSystem: boolean
  updatedAt?: Date | string | null
}): CachedPermissionProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon ?? null,
    seat: row.seat,
    appliesTo: row.appliesTo as ProfileAppliesTo,
    baseLevel: parseBaseLevel(row.baseLevel),
    ceiling: parseProfileCeiling(row.ceiling),
    agentPolicy: (row.agentPolicy as AgentPermissionPolicy | null) ?? null,
    isSystem: row.isSystem,
    updatedAt: toIsoString(row.updatedAt),
  }
}

/** `Date | string | null` → ISO-8601 string, keeping the cache blob JSON-safe. */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}
