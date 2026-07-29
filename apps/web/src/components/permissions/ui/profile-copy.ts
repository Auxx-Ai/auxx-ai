// apps/web/src/components/permissions/ui/profile-copy.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import {
  AREA_ORDER,
  Area,
  type InstanceAccessKey,
  Level,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'

/**
 * Shared copy + constants for the permission-profile editor (doc 19 §7).
 *
 * Constants only — no `'use client'` directive, so server components can import
 * the labels without the module turning into a proxy stub.
 */

/** Principal kinds a profile can bind to (`PermissionProfile.appliesTo`). */
export type ProfileAppliesTo = 'member' | 'agent' | 'any'

/** How each principal kind is named + explained in the header and pickers. */
export const APPLIES_TO_COPY: Record<ProfileAppliesTo, { label: string; description: string }> = {
  member: {
    label: 'People',
    description: 'Bound to members. Supplies the base access they start from.',
  },
  agent: {
    label: 'Agents',
    description:
      'Bound to agent drafts. Carries an exact policy that is snapshotted when the agent is published.',
  },
  any: {
    label: 'People & agents',
    description: 'Can be bound to either a member or an agent draft.',
  },
}

/** Seat class label. The DB value stays `'worker'`; the label is always "Field seat". */
export const SEAT_LABEL: Record<SeatType, string> = {
  full: 'Full seat',
  worker: 'Field seat',
}

/**
 * Rank label for a profile's declared `role` (plan 21 §2.a/§2.0.1). Rank is
 * declared, seeds-only and hidden from every authoring control — non-`USER`
 * only ever appears on the system Owner/Admin rows, so a rank badge is only
 * ever rendered when it is non-`USER` (custom profiles show no rank at all).
 */
export const ROLE_RANK_LABEL: Record<OrganizationRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  USER: 'Member',
}

/** Fall-through source named in the profile editor's "Not set" hint, keyed by
 * the profile's own declared role (plan 21 §2.a.8) — honest about which code
 * default an unset area actually falls through to. */
export const UNSET_HINT_BY_ROLE: Record<OrganizationRole, string> = {
  USER: 'Not set · no access',
  ADMIN: 'Not set · admin default',
  OWNER: 'Not set · owner default',
}

/**
 * The three field-seat surfaces — the ONLY areas a `worker` seat's ceiling leaves
 * open (§0.19). Everything else is `min`-clamped to `None` by `SEAT_CEILINGS`
 * before any profile, group, or personal grant is considered.
 *
 * Mirrored by hand: `SEAT_CEILINGS` lives in
 * `packages/lib/src/permissions/capabilities/seat-policy.ts` and its `WORKER_AREAS`
 * set is module-private; neither is re-exported from
 * `@auxx/lib/permissions/client`, and client code must not import the server
 * module. Keep in sync if the seat ceiling ever changes shape — this list only
 * decides what the editor LOCKS, never what the server enforces (§0.20: the seat
 * ceiling stays in code and stays the last `min`).
 */
export const WORKER_SEAT_AREAS: ReadonlySet<Area> = new Set<Area>([
  Area.recordsLinked,
  Area.dispatchMySchedule,
  Area.dispatchVisitReports,
])

/** Locked-row reason for an area a field seat can never reach. */
export const WORKER_LOCK_REASON =
  'Field seats can never reach this area. The seat ceiling clamps it to None, whatever this profile says.'

/**
 * Areas grouped by registry `group`, in `AREA_ORDER`, groups ordered by first
 * appearance — the one grouping loop every area grid renders from (plan 29 §2.1).
 *
 * Which areas are *offered* differs per surface, so both exclusions are explicit
 * rather than baked in: see {@link PROFILE_AREA_GROUPS} (human surfaces) and
 * {@link AGENT_POLICY_AREA_GROUPS} (agent policy) for the two callers and why
 * they disagree about `adminOnly`.
 */
export function areaGroups({
  excludeAdminOnly,
  excludeWorkerOnly,
  exclude,
}: {
  excludeAdminOnly: boolean
  excludeWorkerOnly: boolean
  /** Areas dropped by name, for reasons no registry flag expresses. */
  exclude?: readonly Area[]
}): Array<{ group: string; areas: Area[] }> {
  const order: string[] = []
  const byGroup = new Map<string, Area[]>()
  const excluded = new Set(exclude ?? [])
  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (excludeAdminOnly && meta.adminOnly) continue
    if (excludeWorkerOnly && meta.workerOnly) continue
    if (excluded.has(area)) continue
    if (!byGroup.has(meta.group)) {
      byGroup.set(meta.group, [])
      order.push(meta.group)
    }
    byGroup.get(meta.group)?.push(area)
  }
  return order.map((group) => ({ group, areas: byGroup.get(group) ?? [] }))
}

/**
 * Grantable areas for the HUMAN surfaces (profile editor, member baseline,
 * grantee overrides): `adminOnly` areas are never grantable below ADMIN, and
 * `workerOnly` areas are enforced only on a worker seat, so a control for them
 * would do nothing. (The binary-role-gate lock this list used to also carry for a
 * subset of areas was retired 2026-07-27, plan 21 §8 step 11 — every listed
 * area's lever is real now.)
 */
export const PROFILE_AREA_GROUPS: Array<{ group: string; areas: Area[] }> = areaGroups({
  excludeAdminOnly: true,
  excludeWorkerOnly: true,
})

/**
 * The areas the AGENT policy can express. `workerOnly` areas are excluded: their
 * enforcement is gated on `seatType === 'worker'`, which an agent never is, so a
 * control here would be a lever that does nothing.
 *
 * `adminOnly` areas ARE offered. That flag means "not grantable below ADMIN" on
 * the *human* baseline; an agent's authority comes from this policy and nothing
 * else, bounded at publish by the §2.4a author clamp — so the honest treatment is
 * to show the rung and name the clamp, not to hide it.
 *
 * **`Area.agents` is excluded by name** (plan 25 §4.2.DECIDED, decision 4). It
 * became an `INSTANCE_ACCESS_RESOURCES` key in 2026-07-28's agents slice, and
 * {@link AREA_TO_INSTANCE_KEY} is *derived* from that registry — so leaving the
 * area here would auto-grow per-agent child rows **inside another agent's
 * policy** ("which agents may this agent access") with no code change and no
 * failing test. Nothing consumes agent-vs-agent instance access, so that is a
 * control wired to nothing: the exact phantom-control failure
 * `NON_RECORD_ENTITY_SLUGS`' doc comment exists to prevent. Re-admitting it
 * means first building the thing it would claim to configure.
 */
export const AGENT_POLICY_AREA_GROUPS: Array<{ group: string; areas: Area[] }> = areaGroups({
  excludeAdminOnly: false,
  excludeWorkerOnly: true,
  exclude: [Area.agents],
})

/** Every area the agent policy renders — also the keyspace the clamp preview checks. */
export const AGENT_POLICY_AREAS: readonly Area[] = AGENT_POLICY_AREA_GROUPS.flatMap((g) => g.areas)

/**
 * The instance-access resource types an AGENT policy can express per-instance
 * rules for — every one except `agent` itself, for the reason on
 * {@link AGENT_POLICY_AREA_GROUPS}.
 *
 * This is a TYPE-level exclusion on purpose. Dropping `Area.agents` from the
 * groups above stops the rows rendering today, but nothing would stop a future
 * edit re-admitting the area and silently growing "which agents may this agent
 * access" controls again. Every agent-policy map keyed by resource type is
 * `Record<AgentPolicyInstanceKey, …>`, so the exclusion survives as a compile
 * error while a genuinely NEW instance-access resource still breaks the build
 * the way an exhaustive map should.
 */
export type AgentPolicyInstanceKey = Exclude<InstanceAccessKey, 'agent'>

/**
 * The runtime companion of {@link AgentPolicyInstanceKey}, for the surfaces that
 * have to ENUMERATE the types rather than narrow one.
 *
 * Deliberately an exhaustive `Record`, not `INSTANCE_ACCESS_KEYS.filter(…)`: the
 * record is what makes a genuinely new instance-access resource a compile error,
 * which is the property the private `RESOURCE_TYPE_META` tables were carrying by
 * accident before plan 33 §4.3 merged them into `INSTANCE_TYPE_META` (which
 * cannot carry it — it must include `agent`).
 */
const AGENT_POLICY_INSTANCE_KEY_SET: Record<AgentPolicyInstanceKey, true> = {
  dataset: true,
  kb: true,
  dashboard: true,
  workflow: true,
  // `signature` / `snippet` joined the registry in the 2026-07-28 plan 36 slice
  // and are ADMITTED rather than excluded: unlike agent-vs-agent access there is
  // a real thing behind them — plan 36 §12.6 owes the Kopilot/agent tool layer
  // the same per-instance guard the routers get, and these rows are how "this
  // agent may use the Refunds snippet" is authored. Until that sweep lands the
  // rows are authored-but-unread; if it is cut, exclude them from
  // {@link AgentPolicyInstanceKey} the way `agent` is rather than leaving a
  // control wired to nothing.
  signature: true,
  snippet: true,
}

export const AGENT_POLICY_INSTANCE_KEYS = Object.keys(
  AGENT_POLICY_INSTANCE_KEY_SET
) as AgentPolicyInstanceKey[]

/** The icon a profile falls back to when it carries no `icon` of its own. */
export const DEFAULT_PROFILE_ICON = { iconId: 'shield-check', color: 'blue' }

/**
 * Derive a storable `slug` from a display name. Slugs are immutable after
 * creation (§0.18) and unique per org, so the caller de-duplicates against the
 * existing set before submitting.
 */
export function slugifyProfileName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return base || 'profile'
}

/** `slugifyProfileName` + a numeric suffix until it stops colliding. */
export function uniqueProfileSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugifyProfileName(name)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/** Whether a level is a real rung (`Level` is a numeric enum, so `0` is valid). */
export function isLevel(value: number | undefined): value is Level {
  return value !== undefined && value >= Level.None && value <= Level.Full
}
