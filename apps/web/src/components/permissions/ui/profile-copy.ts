// apps/web/src/components/permissions/ui/profile-copy.ts

import type { SeatType } from '@auxx/database/types'
import { AREA_ORDER, Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'

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
  'Field seats can never reach this area — the seat ceiling clamps it to None, whatever this profile says.'

/** The §5.3 wording for an area whose routers are still a binary admin gate. */
export const ROLE_GATED_REASON = 'Still role-gated — admins reach this regardless.'

/**
 * Grantable areas grouped by registry group, in area order — the same selection
 * the shared `LeveledAreaGrid` makes: `adminOnly` areas are never grantable below
 * ADMIN, and `workerOnly` areas are enforced only on a worker seat, so a control
 * for them would do nothing. `roleGated` areas ARE listed (they are grantable in
 * the model, §0.25) but render locked.
 *
 * Duplicated rather than imported because the shared grid keeps this private and
 * exposes no per-area lock hook — which the profile editor needs for the seat
 * lock (§0.19).
 */
export const PROFILE_AREA_GROUPS: Array<{ group: string; areas: Area[] }> = (() => {
  const order: string[] = []
  const byGroup = new Map<string, Area[]>()
  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (meta.adminOnly || meta.workerOnly) continue
    if (!byGroup.has(meta.group)) {
      byGroup.set(meta.group, [])
      order.push(meta.group)
    }
    byGroup.get(meta.group)?.push(area)
  }
  return order.map((group) => ({ group, areas: byGroup.get(group) ?? [] }))
})()

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
