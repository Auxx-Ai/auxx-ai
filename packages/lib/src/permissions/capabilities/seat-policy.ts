// packages/lib/src/permissions/capabilities/seat-policy.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import {
  Area,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  PERMISSION_AREAS,
  PermissionKey,
} from './registry'

/**
 * Role defaults + seat ceilings live IN CODE (not the DB), now expressed as
 * per-area access levels (v1.5). `ROLE_DEFAULTS` is what each role gets out of
 * the box; `SEAT_CEILINGS` is the per-area max rung a seat can EVER reach — the
 * worker ceiling is what makes the field seat safely cheaper (no org config,
 * group, or user grant can promote it). See
 * plans/permissions/capability-layer-v1.5-leveled-model.md §4/§6.
 */

/** Every registered PermissionKey, in registry order. */
export const ALL_KEYS: PermissionKey[] = Object.values(PermissionKey)

/** Every area at `Full` — the OWNER/ADMIN and full-seat ceiling baseline. */
const ALL_FULL: Record<Area, Level> = buildAreaLevels(() => Level.Full)

/**
 * The field-seat (worker) surfaces (§4.1): assigned schedule, visit reporting,
 * and read-only linked records. These are the only areas a worker seat's ceiling
 * leaves open — everything else is `min`-clamped to `None`.
 */
const WORKER_AREAS = new Set<Area>([
  Area.recordsLinked,
  Area.dispatchMySchedule,
  Area.dispatchVisitReports,
])

/**
 * The field-seat capability keys (§4.1) — the three worker surfaces expanded.
 * Kept for callers/tests that assert the worker's effective set directly.
 */
export const WORKER_SEAT_KEYS: PermissionKey[] = [
  PermissionKey.dispatchMySchedule,
  PermissionKey.dispatchVisitReports,
  PermissionKey.recordsViewLinked,
]

/**
 * What each role gets out of the box, per area (before grants + seat clamp).
 * OWNER/ADMIN short-circuit to Full anyway; USER is Full everywhere except the
 * `adminOnly` areas (settings/billing/members/permissions), which are `None`.
 */
export const ROLE_DEFAULTS: Record<OrganizationRole, Record<Area, Level>> = {
  OWNER: ALL_FULL,
  ADMIN: ALL_FULL,
  USER: buildAreaLevels((area) => (PERMISSION_AREAS[area].adminOnly ? Level.None : Level.Full)),
}

/**
 * The per-area ceiling per seat type — the max rung a seat can ever reach,
 * applied as the LAST `min` clamp (§5/§6). `full` imposes nothing; `worker`
 * leaves only the three field-seat surfaces open, everything else `None`.
 */
export const SEAT_CEILINGS: Record<SeatType, Record<Area, Level>> = {
  full: ALL_FULL,
  worker: buildAreaLevels((area) => (WORKER_AREAS.has(area) ? Level.Full : Level.None)),
}

/**
 * Entity slug → the capability key required to WRITE that entity. Slugs absent
 * from this map default (in code) to {@link PermissionKey.recordsEdit}. Dispatch
 * work orders route to the dispatch board-manage key.
 */
export const ENTITY_WRITE_KEYS: Record<string, PermissionKey> = {
  work_order: PermissionKey.dispatchBoardManage,
}

/**
 * The effective out-of-the-box capability set for a role on a seat type:
 * per area `min(ROLE_DEFAULTS[role], SEAT_CEILINGS[seatType])`, expanded to
 * registry-ordered keys. Same return type as v1 so callers don't change.
 */
export function effectiveDefault(role: OrganizationRole, seatType: SeatType): PermissionKey[] {
  const defaults = ROLE_DEFAULTS[role]
  const ceiling = SEAT_CEILINGS[seatType]
  const clamped = buildAreaLevels((area) => Math.min(defaults[area], ceiling[area]) as Level)
  return expandLevelsToKeys(clamped)
}
