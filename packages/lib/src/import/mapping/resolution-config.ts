// packages/lib/src/import/mapping/resolution-config.ts

import type { IdentityRole } from '../../write-policy'
import type { ResolutionConfig } from '../types/resolution'

/**
 * Parse a stored `ImportMappingProperty.resolutionConfig` blob.
 *
 * Never throws: the column is free-form JSON written by several generations of
 * this code, and a mapping row that fails to parse must degrade to "no config",
 * not take down the mapping screen.
 *
 * @param raw - Stored JSON string (or null)
 * @returns The parsed config, or an empty object
 */
export function parseResolutionConfig(raw: string | null | undefined): ResolutionConfig {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as ResolutionConfig) : {}
  } catch {
    return {}
  }
}

/**
 * Serialize a resolution config, collapsing an all-empty object to `null` so an
 * unconfigured column keeps storing NULL rather than `"{}"`.
 *
 * @param config - Config to store
 * @returns JSON string, or null when nothing is set
 */
export function serializeResolutionConfig(config: ResolutionConfig): string | null {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return null
  return JSON.stringify(Object.fromEntries(entries))
}

/**
 * Strip the connector's `normalize` knob off an identity role before it is
 * persisted on an import column.
 *
 * The importer already has TWO normalization authorities that must agree,
 * `normalizeForLookup` (automatic, type-driven) and `checkUniqueValueTyped`
 * (bare `eq`). A user-settable third is the only one a human can desync by
 * hand, so the importer takes `{ kind: 'match' }` and nothing else. The union is
 * shared with the connector sink, which genuinely needs the knob; this is the
 * boundary where the importer declines it.
 *
 * @param role - Role as supplied by the caller
 * @returns The role with `normalize` removed, or null/undefined unchanged
 */
export function sanitizeIdentityRole<T extends IdentityRole | null | undefined>(role: T): T {
  if (!role || role.kind !== 'match') return role
  const { normalize: _normalize, ...rest } = role
  return rest as T
}

/** True when this column is (part of) the match key. */
export function isMatchRole(role: IdentityRole | undefined): boolean {
  return role?.kind === 'match'
}
