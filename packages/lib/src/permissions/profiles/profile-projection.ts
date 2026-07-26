// packages/lib/src/permissions/profiles/profile-projection.ts

import type { PermissionProfileEntity } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { Level, parseAreaLevels } from '../capabilities/registry'
import type {
  AgentPermissionPolicy,
  CachedPermissionProfile,
  ProfileAppliesTo,
  ProfileCeiling,
} from './types'

/**
 * Defensively coerce a stored `PermissionProfile.ceiling` jsonb into the trusted
 * {@link ProfileCeiling} shape: `areas` goes through `parseAreaLevels` (unknown
 * area slugs dropped, rungs clamped). Returns `null` for anything unusable —
 * including an object carrying no recognized key — which composition reads as
 * "uncapped".
 *
 * **This is why plan 20 §2.a.5 needs no data migration.** The column keeps rows
 * written before `ceiling.defs` was deleted (plan 20 §2.a.2). Every unrecognized
 * key — `defs` above all — is simply not read: a `{ defs: … }`-only row parses to
 * `null` (uncapped) and a `{ areas, defs }` row keeps its areas half, in both
 * cases without throwing. Keep this whitelist-shaped, never a strict parser that
 * rejects extra keys, or the legacy rows become a startup failure.
 */
export function parseProfileCeiling(raw: unknown): ProfileCeiling | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as { areas?: unknown }

  const areas = source.areas ? parseAreaLevels(source.areas) : undefined
  if (!areas || Object.keys(areas).length === 0) return null
  return { areas }
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
