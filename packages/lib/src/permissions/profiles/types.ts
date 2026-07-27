// packages/lib/src/permissions/profiles/types.ts

import type {
  AgentAccessLevel,
  AgentPermissionPolicy,
  AgentPolicyClampEntry,
  PublishedAgentPermissionPolicy,
} from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
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
  'support_agent',
  'analyst_agent',
] as const

export type SystemProfileSlug = (typeof SYSTEM_PROFILE_SLUGS)[number]

/** Which principal kind may bind a profile. */
export type ProfileAppliesTo = 'member' | 'agent' | 'any'

/**
 * A human profile's intrinsic cap — applied AFTER group/personal raising and
 * BEFORE the seat ceiling (§2.1).
 *
 * **Unauthored, deliberately.** Plan 20 §2.a.1/§2.a.3 removed the authoring
 * surface: no UI writes this, no seed writes this (`system-profiles.ts` ships
 * `ceiling: null` for every seed), and no mutation accepts it — `saveProfile` and
 * `savePermissionProfile` have no `ceiling` input. It survives ONLY as the clamp
 * seam a future per-definition deny tier (doc 19 §11.4) will hang off, which is
 * one `Math.min` in `composeUserCapabilities` and no cached-blob field.
 *
 * **It has an expiry.** Per plan 20 §2.a.4 / §7.1: if no deny/lock successor
 * lands within two releases of that plan, delete this type, the `ceiling` jsonb
 * column, `parseProfileCeiling`, and `profileCeiling` from the composer rather
 * than letting a zero-writer mechanism rot.
 *
 * The definition half (`ceiling.defs`, a slug allow/deny list) was deleted
 * end-to-end by plan 20 §2.a.2. A legacy stored `defs` key is silently dropped
 * by `parseProfileCeiling`, which is why no data migration was needed.
 */
export interface ProfileCeiling {
  /** Per-area max rung. An absent area is uncapped (`Level.Full`). */
  areas?: Partial<Record<Area, Level>>
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
  /**
   * The rank this profile confers on assignment (plan 21 §2.a). Hidden from
   * authoring (21 §2.0.1): non-`USER` only on the system owner/admin rows.
   */
  role: OrganizationRole
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
