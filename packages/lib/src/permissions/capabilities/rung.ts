// packages/lib/src/permissions/capabilities/rung.ts

import { ResourcePermission, type Rung } from '@auxx/database/enums'

/**
 * One instance-grant rung — the single ordinal ladder every domain's
 * `ResourceAccess` grants are expressed on (plan v3/03 §2).
 *
 * ```
 * none < metadata < identity < read < edit < admin
 * ```
 *
 * - `none`     — the restriction marker. NEVER a grant: a `none` row says
 *                "this instance is row-described and this grantee is not on
 *                the list", so it must rank below every positive rung and can
 *                only ever narrow. See `project_permission_none_is_a_restriction`.
 * - `metadata` — existence + envelope facts (participants, timestamps, counts).
 * - `identity` — the above + a code-authored identity projection (mail's
 *                subject line; a record's display name).
 * - `read`     — the content.
 * - `edit`     — may change the content.
 * - `admin`    — may manage the instance, including its sharing.
 *
 * **Domains declare a SPARSE subset.** A domain with nothing to express
 * between two rungs skips the one between — exactly the way `Area.comments`
 * skips `Level.Edit` in the area ladder. The declaration lives beside the
 * domain's baseline posture in `INSTANCE_ACCESS_RESOURCES`.
 *
 * **The ladder guarantees the ORDER, not the semantics.** What a rung *means*
 * is per-domain: mail's `read` confers replying and assigning (there is no
 * thread authority axis — `registry.ts`), a record's `read` does not. That is
 * the same latitude `Level.Full` already has per area.
 *
 * **`Rung` and the area `Level` are two ladders sharing one pattern — do not
 * merge them.** The coarse L2 area gate stands in FRONT of the per-instance
 * rung; collapsing them would let one instance grant open a whole area.
 *
 * **The declaration lives in `@auxx/database/enums`**, beside
 * {@link ResourcePermission} and for the same reason: `resource-access.ts` needs
 * it for `text().$type<Rung>()`, and `packages/database` (tier 1) cannot import
 * `@auxx/lib` (tier 3). Everything ordinal — {@link RUNG_ORDER} and every
 * comparator — lives here, so the persisted vocabulary and the ordering that
 * interprets it are separable exactly as plan §2.1 requires.
 */
export type { Rung }

/**
 * Ordinal rank per rung.
 *
 * **The NAME is what persists; the ordinal lives here** (plan v3/03 §2.1). Mail
 * already retro-fitted a tier *between* two existing ones once, and a
 * Docs-style `commenter` between `read` and `edit` is a plausible future
 * insertion — with names, inserting a rung is a code change; with dense ints
 * persisted on rows it is a renumbering migration. Every threshold predicate
 * (including SQL) is built from this table, never from a stored integer.
 */
export const RUNG_ORDER: Record<Rung, number> = {
  none: 0,
  metadata: 1,
  identity: 2,
  read: 3,
  edit: 4,
  admin: 5,
}

/** All rungs in ascending order. */
export const ALL_RUNGS: readonly Rung[] = ['none', 'metadata', 'identity', 'read', 'edit', 'admin']

/** Numeric rank of a rung (for sorting / comparisons). */
export const rungRank = (rung: Rung): number => RUNG_ORDER[rung]

/** True when `have` is at least `need`. */
export const satisfiesRung = (have: Rung, need: Rung): boolean =>
  RUNG_ORDER[have] >= RUNG_ORDER[need]

/**
 * The higher of two rungs (grants only ever widen access).
 *
 * Generic over the NARROWING, not just `Rung`: mail folds `Lens` values
 * (`Extract<Rung, 'none'|'metadata'|'identity'|'read'>`) with this, and a
 * `(Rung, Rung) => Rung` signature would widen every one of those folds back to
 * the full ladder — forcing a cast at each site, which is precisely how a
 * domain's declared vocabulary stops being enforced.
 */
export const maxRung = <T extends Rung>(a: T, b: T): T => (RUNG_ORDER[a] >= RUNG_ORDER[b] ? a : b)

/** Inverse of {@link RUNG_ORDER} — the rank a SQL aggregate hands back. */
const RANK_TO_RUNG: Record<number, Rung> = Object.fromEntries(
  ALL_RUNGS.map((rung) => [RUNG_ORDER[rung], rung])
) as Record<number, Rung>

/**
 * The {@link Rung} an ordinal rank names.
 *
 * `null` / `undefined` / an unknown rank all read as `'none'` — the value that
 * satisfies nothing. A `max()` over zero grant rows is SQL `NULL`, and an
 * unmapped rank can only come from a rung this build does not know about; both
 * must fail closed, and `'none'` is the one value that does.
 */
export function rankToRung(rank: number | null | undefined): Rung {
  if (rank === null || rank === undefined) return 'none'
  return RANK_TO_RUNG[rank] ?? 'none'
}

/**
 * Fold a def-level rung with a row's aggregated grant rank into the
 * ROW-EFFECTIVE level (plan v3/03 §5.2):
 *
 * ```
 * _access = max(effectiveRecordLevel(def), max rung across matching grant rows)
 * ```
 *
 * Pure and client-safe so the client mirror of the stamp cannot drift from the
 * server's. **The result IS the row-effective level** (§5.3, D6) — the existing
 * verb gates consume it unchanged and no `deleteAt` / `editAt` vocabulary is
 * introduced anywhere.
 */
export function foldRecordAccess(defRung: Rung | undefined, grantRank: number | null): Rung {
  return maxRung(defRung ?? 'none', rankToRung(grantRank))
}

/**
 * **THE ONE BOUNDARY** between the two vocabularies (plan v3/03 §3).
 *
 * `ResourceAccess.rung` is the whole table's storage vocabulary — instance rows
 * AND type rows. `ResourcePermission` is NOT retired: it remains the DEF/AREA
 * axis, whose values are composed from L2 area {@link Level}s
 * (`levelToRecordBasePermission`, `baseRecordsLevel`) as much as from rows, and
 * which `effectiveRecordLevel` / `canViewRecord` / `defAccess` / agent policy /
 * `PermissionGrant` all speak.
 *
 * **Exactly TWO crossing points exist, and both are here:**
 *  1. a TYPE row read into `defAccess` (`compute-user-capabilities`,
 *     `grantee-access`, `effective-state`, and the permissions-UI hooks that
 *     render the same rows) — the def axis proper;
 *  2. the `groups` module, whose product vocabulary is `view / edit / admin`
 *     with no tier below `view` and a UI built on it. Its rows are instance
 *     rows, so the STORAGE is `Rung`; the module converts at its own edge
 *     rather than pushing a six-rung ladder into a three-rung feature.
 *
 * Anywhere else, a conversion is a smell: it means a reader is speaking the
 * wrong axis for the rows it is holding.
 *
 * `metadata` and `identity` map to **`undefined`, not to `view`**. They are
 * strictly BELOW `read`, and the def axis has no tier under `view`; collapsing
 * them upward would hand a metadata grant full record read. `undefined` means
 * "not expressible on the def axis" and every caller already treats an absent
 * `defAccess` entry as no grant — the fail-closed direction. They are also
 * unreachable in practice: record defs declare `RECORD_DEF_RUNGS`
 * (`none/read/edit/admin`), so a `metadata` type row is a data bug, and mapping
 * it to nothing is how that bug stays inert instead of becoming an escalation.
 */
export function rungToPermission(rung: Rung): ResourcePermission | undefined {
  switch (rung) {
    case 'none':
      return ResourcePermission.none
    case 'read':
      return ResourcePermission.view
    case 'edit':
      return ResourcePermission.edit
    case 'admin':
      return ResourcePermission.admin
    default:
      return undefined
  }
}

/**
 * The inverse of {@link rungToPermission} — total, because every
 * {@link ResourcePermission} has an exact rung. Used where a def-axis value has
 * to be written back onto a row (the permissions UI's def/baseline editors) or
 * compared against one.
 */
export function permissionToRung(permission: ResourcePermission): Rung {
  switch (permission) {
    case 'none':
      return 'none'
    case 'view':
      return 'read'
    case 'edit':
      return 'edit'
    case 'admin':
      return 'admin'
  }
}
