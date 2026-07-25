// packages/lib/src/permissions/profiles/types.ts

import type {
  AgentAccessLevel,
  AgentPermissionPolicy,
  AgentPolicyClampEntry,
  PublishedAgentPermissionPolicy,
} from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import type { Area, Level } from '../capabilities/registry'

export type {
  AgentAccessLevel,
  AgentPermissionPolicy,
  AgentPolicyClampEntry,
  PublishedAgentPermissionPolicy,
}

/**
 * The reserved system-profile slugs, seeded per org (§5.1). Never deletable; a
 * null principal binding always resolves to one of these.
 */
export const SYSTEM_PROFILE_SLUGS = [
  'owner',
  'admin',
  'member',
  'field_tech',
  'agent',
  'chat_agent',
] as const

export type SystemProfileSlug = (typeof SYSTEM_PROFILE_SLUGS)[number]

/** Which principal kind may bind a profile. */
export type ProfileAppliesTo = 'member' | 'agent' | 'any'

/**
 * Human-profile definition ceiling (§0.13). `only` = the allowed set is exactly
 * `slugs`, so a definition added later is EXCLUDED (fails closed); `except` =
 * everything but `slugs`, so a later definition is INCLUDED (fails open).
 * apiSlugs, not CUIDs — resolved to `entityDefinitionId`s in `getCapabilities`
 * and enforced by `effectiveRecordLevel` (plus the worker `recordsViewLinked`
 * carve-out and `administersAnyDef`), never client-side only.
 */
export interface ProfileDefCeiling {
  mode: 'only' | 'except'
  slugs: string[]
}

/**
 * A human profile's intrinsic cap — applied AFTER group/personal raising and
 * BEFORE the seat ceiling (§2.1). Belongs to the same profile that supplies the
 * base; there is no separate ceiling binding (§0.14).
 */
export interface ProfileCeiling {
  /** Per-area max rung. An absent area is uncapped (`Level.Full`). */
  areas?: Partial<Record<Area, Level>>
  /**
   * Per-definition cap. Applied per-def at the record resolvers rather than
   * here, since it needs the org's apiSlug → `entityDefinitionId` map.
   */
  defs?: ProfileDefCeiling | null
}

/**
 * A permission profile projected for the org cache — everything composition and
 * the profile UI need, JSON-serializable (no Date columns).
 */
export interface CachedPermissionProfile {
  id: string
  slug: string
  name: string
  description: string | null
  icon: { iconId: string; color: string } | null
  seat: SeatType
  appliesTo: ProfileAppliesTo
  /** Fallback rung for areas the profile's grant row does not set; `null` = fall through to `ROLE_DEFAULTS`. */
  baseLevel: Level | null
  ceiling: ProfileCeiling | null
  agentPolicy: AgentPermissionPolicy | null
  isSystem: boolean
  /**
   * ISO-8601 `updatedAt`, snapshotted into
   * `AgentVersion.permissionPolicy.sourceProfileUpdatedAt` at publish so an audit
   * can tell which revision of the profile a version was cut from. Audit metadata
   * only — never read by composition or by any gate.
   */
  updatedAt: string | null
}
