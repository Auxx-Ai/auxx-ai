// packages/lib/src/permissions/capabilities/seat-policy.ts

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Area, buildAreaLevels, Level, PermissionKey } from './registry'

/**
 * Role defaults + seat ceilings live IN CODE (not the DB), now expressed as
 * per-area access levels (v1.5/v2). `ROLE_DEFAULTS` is the fall-through a
 * profile's unset areas compose to; `SEAT_CEILINGS` is the per-area max rung a
 * seat can EVER reach — the worker ceiling is what makes the field seat safely
 * cheaper (no org config, group, or user grant can promote it).
 *
 * **Plan 22 (member baseline strip):** unset on a USER-rank profile now means
 * `None`, full stop — `ROLE_DEFAULTS.USER` is the all-`None` floor, not a
 * generous map. The Member profile's actual out-of-the-box access is carried
 * as explicit `PermissionGrant` levels, seeded from {@link MEMBER_BASELINE_LEVELS}
 * (today's positive baseline, unchanged) at `ensureSystemProfiles` time — it is
 * written as DATA, not composed from this file at read time. `field_tech` gets
 * the same treatment via {@link FIELD_TECH_BASELINE_LEVELS}.
 * `ROLE_DEFAULTS.ADMIN`/`.OWNER` stay `ALL_FULL` UNTOUCHED: that fall-through is
 * the recovery guarantee (plan 21 §2.a.7) — a mis-shaped profile can never lock
 * out every admin/owner.
 *
 * See plans/permissions/capability-layer-v1.5-leveled-model.md §4/§6 and
 * plans/permissions/v2/22-member-baseline-strip.md.
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
 * `Area.signatures` and `Area.snippets` are DELIBERATELY absent from
 * {@link WORKER_AREAS} (plan 36 §0.5) — this omission is a decision, not an
 * oversight, and the consequence is sharper than it looks.
 *
 * {@link SEAT_CEILINGS}`.worker` resolves to `Level.None` for every area outside
 * the set above, and that clamp is checked in `effectiveInstanceLevel`
 * (`entity-access.ts`) **above** the explicit-instance-row branch. So a field
 * tech gets nothing here even on a signature or snippet they created and hold an
 * `admin` row for: the seat ceiling closes the area before any row is consulted.
 *
 * That is the intended outcome. Do not "fix" it by adding either area here —
 * reopening it is a product decision about what a field seat is for, and it
 * would silently widen every existing worker seat.
 */

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
 * OWNER/ADMIN short-circuit to Full anyway; USER is the all-`None` floor
 * (plan 22) — unset on a USER-rank profile means no access, full stop. The
 * Member profile's actual out-of-the-box access is seeded as data, not
 * composed here — see {@link MEMBER_BASELINE_LEVELS}.
 */
export const ROLE_DEFAULTS: Record<OrganizationRole, Record<Area, Level>> = {
  OWNER: ALL_FULL,
  ADMIN: ALL_FULL,
  USER: buildAreaLevels(() => Level.None),
}

/**
 * The Member profile's seeded baseline (plan 22 §2.2) — today's positive USER
 * map, unchanged, now written as an explicit `PermissionGrant` row instead of
 * composed from `ROLE_DEFAULTS` at read time: every area at `Full` EXCEPT the
 * ten org-administration areas below (OMITTED entirely — with the floor at
 * `None`, storing `None` for them would be dead weight and the editor should
 * show those rows as unset), `datasets: Read`, and `knowledgeBase: Edit`.
 *
 * Written literally (not derived by excluding an admin-areas set from
 * `AREA_ORDER`) so that adding a new `Area` ships CLOSED for members by
 * default (plan 22 §2.5) — a new area needs an explicit entry here (plus a
 * backfill for existing orgs) to become member-visible, rather than silently
 * inheriting `Full` because it wasn't excluded.
 *
 * - `settings` / `permissions` / `billing` / `members` / `integrations` /
 *   `aiConfig` / `automationRules` / `auditLog` / `connectors` / `channels` —
 *   the ten org-administration areas — are grantable but OFF by default; a
 *   member gets them only via an explicit grant. `channels` (plan 21 §6): the
 *   migrated Tier C sites were all `adminProcedure`, so the member default
 *   stays closed to preserve behavior.
 * - `datasets: Read` (§0.2): everyone should *see and use* datasets in search
 *   and agents by default, but *contributing files* (Edit) or *changing
 *   settings* (Full) is a deliberate rung bump or per-dataset instance grant.
 * - `knowledgeBase: Edit`: KB is collaborative content — everyone reads +
 *   authors articles by default; changing KB *settings* (Full) is a
 *   deliberate grant (doc 12 §0.3).
 * - `signatures: Full` / `snippets: Full` (plan 36 §2.3): members create and own
 *   their own. Both are `baselineAtCreate: true`, so `Full` here buys the
 *   instance-LESS action (create) and nothing else — every existing signature or
 *   snippet still needs an explicit `ResourceAccess` row to be reachable. Per
 *   plan 22 §2.5 a new area ships CLOSED unless listed here AND backfilled for
 *   existing orgs, which plan 36 §4.3 owes.
 */
export const MEMBER_BASELINE_LEVELS: Partial<Record<Area, Level>> = {
  [Area.records]: Level.Full,
  [Area.recordsLinked]: Level.Full,
  [Area.workflows]: Level.Full,
  [Area.agents]: Level.Full,
  [Area.comments]: Level.Full,
  [Area.dispatchBoard]: Level.Full,
  [Area.dispatchMySchedule]: Level.Full,
  [Area.dispatchVisitReports]: Level.Full,
  [Area.files]: Level.Full,
  [Area.datasets]: Level.Read,
  [Area.knowledgeBase]: Level.Edit,
  [Area.dashboards]: Level.Full,
  [Area.signatures]: Level.Full,
  [Area.snippets]: Level.Full,
}

/**
 * The Field Tech profile's seeded baseline (plan 22 §2.3) — the three
 * {@link WORKER_AREAS} at `Full`. With `ROLE_DEFAULTS.USER` now the `None`
 * floor, `field_tech` must say what it grants instead of inheriting the old
 * generous member map and relying on `SEAT_CEILINGS.worker` alone to narrow
 * it — the ceiling still narrows everything else to `None` regardless.
 */
export const FIELD_TECH_BASELINE_LEVELS: Partial<Record<Area, Level>> = {
  [Area.recordsLinked]: Level.Full,
  [Area.dispatchMySchedule]: Level.Full,
  [Area.dispatchVisitReports]: Level.Full,
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
