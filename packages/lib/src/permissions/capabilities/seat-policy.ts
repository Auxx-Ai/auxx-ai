// packages/lib/src/permissions/capabilities/seat-policy.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Area, buildAreaLevels, expandLevelsToKeys, Level, PermissionKey } from './registry'

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
 * Org-administration areas whose USER default is `None` (delegated, not
 * default-on). Two are `adminOnly` (never grantable below ADMIN); the rest are
 * grantable but still OFF by default — a member gets them only via an explicit
 * grant. This is the source of truth for the USER baseline, NOT `adminOnly`,
 * because dropping `adminOnly` (to make an area grantable) must NOT flip its
 * USER default to Full (that would auto-hand every member billing/members).
 */
const USER_ADMIN_NONE_AREAS = new Set<Area>([
  Area.settings,
  Area.permissions,
  Area.billing,
  Area.members,
  Area.integrations,
  Area.aiConfig,
  Area.automationRules,
  Area.auditLog,
  Area.connectors,
])

/**
 * Areas whose USER default is `Read` (not the binary None/Full). The first such
 * area is `datasets` (§0.2): everyone should *see and use* datasets in search
 * and agents by default, but *contributing files* (Edit) or *changing settings*
 * (Full) is a deliberate L2 rung bump or per-dataset instance grant. Without a
 * Read default, per-dataset share-up grants would be meaningless (base already
 * Full).
 */
const USER_READ_AREAS = new Set<Area>([Area.datasets])

/**
 * Areas whose USER default is `Write`/`Edit` (not None/Read/Full). KB is
 * collaborative content: everyone reads + authors articles by default; changing
 * KB *settings* (Full) is a deliberate grant (doc 12 §0.3). Without an Edit
 * default, per-KB share-up to Full would be the only per-KB lever and article
 * authoring would need an org-wide bump.
 */
const USER_EDIT_AREAS = new Set<Area>([Area.knowledgeBase])

/**
 * What each role gets out of the box, per area (before grants + seat clamp).
 * OWNER/ADMIN short-circuit to Full anyway; USER is Full everywhere except the
 * org-administration areas in {@link USER_ADMIN_NONE_AREAS} (`None`), the
 * {@link USER_READ_AREAS} (`Read`), and the {@link USER_EDIT_AREAS} (`Edit`).
 */
export const ROLE_DEFAULTS: Record<OrganizationRole, Record<Area, Level>> = {
  OWNER: ALL_FULL,
  ADMIN: ALL_FULL,
  USER: buildAreaLevels((area) =>
    USER_ADMIN_NONE_AREAS.has(area)
      ? Level.None
      : USER_READ_AREAS.has(area)
        ? Level.Read
        : USER_EDIT_AREAS.has(area)
          ? Level.Edit
          : Level.Full
  ),
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
 * from this map default (in code) to {@link PermissionKey.recordsEdit}. These
 * dispatch record faces route writes to the dispatch board-manage key. Keep this
 * map aligned with {@link ENTITY_BASE_AREAS}: coarse verb call sites use this
 * map, while def-aware read/write checks use the derived record base.
 */
export const ENTITY_WRITE_KEYS: Record<string, PermissionKey> = {
  work_order: PermissionKey.dispatchBoardManage,
  service_request: PermissionKey.dispatchBoardManage,
  quote: PermissionKey.dispatchBoardManage,
  invoice: PermissionKey.dispatchBoardManage,
}

/**
 * Entity slug → the Layer-2 area that supplies the definition's record base
 * instead of {@link Area.records}. These definitions are the record face of a
 * feature whose authority lives in its own area, so opening the Records area
 * alone must not expose them. The server resolves this slug-keyed map to
 * definition IDs before sending capabilities to the client.
 *
 * Read-side twin of {@link ENTITY_WRITE_KEYS}; keep both maps aligned.
 */
export const ENTITY_BASE_AREAS: Record<string, Area> = {
  work_order: Area.dispatchBoard,
  service_request: Area.dispatchBoard,
  quote: Area.dispatchBoard,
  invoice: Area.dispatchBoard,
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
