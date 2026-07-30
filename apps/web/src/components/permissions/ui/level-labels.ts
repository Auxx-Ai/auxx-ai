// apps/web/src/components/permissions/ui/level-labels.ts

import { ResourcePermission, type Rung } from '@auxx/database/enums'
import { Level, rungToPermission } from '@auxx/lib/permissions/client'
import type { BadgeProps } from '@auxx/ui/components/badge'

/**
 * The single display vocabulary for the four-rung access ladder (plan 26 §2.1).
 *
 * Rung 2 was once named four different ways on four adjacent surfaces ("Edit",
 * "Read and write", a plus-signed variant, and the misleading bare "Write"),
 * because three type-level spellings of the SAME ladder each grew their own label
 * map. Two of those spellings survive — numeric {@link Level} and the
 * `none/view/edit/admin` {@link ResourcePermission} strings — and the third, agent
 * policy's `none/read/read_write/full`, is gone: plan 26 Phase 2 collapsed it into
 * `ResourcePermission`, taking the agent⇄permission bijections that used to live
 * here with it. Every rung string a permissions surface renders comes from here,
 * keyed by {@link Level}; the one remaining conversion table exists purely so a
 * caller holding the string spelling can reach it. "Write" is deliberately gone —
 * rung 2 has always included read, and naming it "Write" read as write-only.
 *
 * **The display vocabulary is NOT the storage vocabulary, and did not move with
 * it.** A rung stored as `'admin'` still renders as *Full* / *Full access*: these
 * labels name a position on a ladder a reader is looking at, not the string in the
 * column. Nothing here changes width, so `LevelControl`'s measured `min-w-52` slot
 * still holds (plan 27; "None" remains the widest short label).
 */

/** Short label per rung — segmented controls and compact chips. */
export const RUNG_LABELS: Record<Level, string> = {
  [Level.None]: 'None',
  [Level.Read]: 'Read',
  [Level.Edit]: 'Edit',
  [Level.Full]: 'Full',
}

/** Long label per rung — dropdown options and prose, where a bare "Edit" is thin. */
export const RUNG_LABELS_LONG: Record<Level, string> = {
  [Level.None]: 'No access',
  [Level.Read]: 'Read only',
  [Level.Edit]: 'Read and write',
  [Level.Full]: 'Full access',
}

/** Which form of the label a caller wants. */
export type LabelForm = 'short' | 'long'

/**
 * Badge colour per rung — the ladder's one palette, ascending from a neutral
 * outline through sky and amber to green.
 *
 * It is here for the same reason the label maps are: this exact mapping was
 * already written out twice (the agent policy's rung meta and
 * `ResolvedAccessDialog`'s fallback meta), and a rung that is amber on one
 * permissions surface and yellow on the next teaches the reader nothing. Both
 * of those maps now read their `variant` from here and keep only what is
 * genuinely theirs — the helper sentence describing what the rung authorizes.
 *
 * `None` is `outline` rather than a red: it is the bottom of a ladder, not a
 * failure, and it renders beside rungs an admin deliberately chose.
 */
export const RUNG_BADGE_VARIANT: Record<Level, NonNullable<BadgeProps['variant']>> = {
  [Level.None]: 'outline',
  [Level.Read]: 'sky',
  [Level.Edit]: 'amber',
  [Level.Full]: 'green',
}

/**
 * The rung as it appears in an **effective-access line** (plan 31 §2.5) — what a
 * grantee can ACTUALLY reach, shown beside the grant they hold.
 *
 * Short form, except `None`, which takes the long spelling: "Effective · None"
 * reads as a missing value when it sits beside a ladder that also has a None
 * rung, where "Effective · No access" is unambiguous.
 *
 * Lives here rather than at its two call sites (the area rows and the instance
 * rows) because plan 26 Phase 1 made this file the ONE rung vocabulary — a
 * second spelling of a rung anywhere else is precisely what that cleanup
 * deleted, four maps at a time.
 */
export function effectiveLevelLabel(level: Level): string {
  return level === Level.None ? RUNG_LABELS_LONG[Level.None] : RUNG_LABELS[level]
}

function labelOf(level: Level, form: LabelForm): string {
  return form === 'long' ? RUNG_LABELS_LONG[level] : RUNG_LABELS[level]
}

/** The `ResourcePermission` spelling of the ladder, as rungs. */
export const LEVEL_OF_PERMISSION: Record<ResourcePermission, Level> = {
  [ResourcePermission.none]: Level.None,
  [ResourcePermission.view]: Level.Read,
  [ResourcePermission.edit]: Level.Edit,
  [ResourcePermission.admin]: Level.Full,
}

/** Exact inverse of {@link LEVEL_OF_PERMISSION} — total, so no fallback rung is invented. */
export const PERMISSION_OF_LEVEL: Record<Level, ResourcePermission> = {
  [Level.None]: ResourcePermission.none,
  [Level.Read]: ResourcePermission.view,
  [Level.Edit]: ResourcePermission.edit,
  [Level.Full]: ResourcePermission.admin,
}

/** The `ResourcePermission` spelling of a rung — the exact inverse of {@link LEVEL_OF_PERMISSION}. */
export function permissionOfLevel(level: Level): ResourcePermission {
  return PERMISSION_OF_LEVEL[level]
}

/**
 * The `ResourcePermission` this grid DISPLAYS a stored {@link Rung} as.
 *
 * The permissions page's instance grid renders through `AccessRowSelect`, which
 * is the AREA/DEF-axis picker (`none / view / edit / admin` + an INHERIT
 * sentinel). Plan v3/03 §2.2 is explicit that the area ladder and the instance
 * rung ladder must NOT be merged, so this is a one-way DISPLAY clamp, not a
 * conversion: mail's sub-`read` tiers (`metadata`, `identity`) floor at `view`.
 *
 * That reproduces today's behaviour exactly rather than changing it — before the
 * single-column migration this grid read `permission` and ignored `lens`, so a
 * `subject`-floored inbox already rendered as "Read only". Using
 * `rungToPermission` here instead would map those tiers to `undefined`, i.e.
 * "Inherit", which is a WORSE lie: it claims no row exists.
 *
 * The honest fix is the `RungSelect` convergence (plan v3/03 §6.3), which renders
 * the domain's declared `rungs` from `INSTANCE_ACCESS_RESOURCES`. Until then this
 * clamp is the single place the gap lives.
 */
export function displayPermissionOfRung(rung: Rung): ResourcePermission {
  return rung === 'metadata' || rung === 'identity'
    ? ResourcePermission.view
    : (rungToPermission(rung) ?? ResourcePermission.none)
}

/** Display label for a `ResourcePermission`, on the shared rung vocabulary. */
export function permissionLabel(permission: ResourcePermission, form: LabelForm = 'short'): string {
  return labelOf(LEVEL_OF_PERMISSION[permission], form)
}

/**
 * Display label for a stored {@link Rung}. Goes through
 * {@link displayPermissionOfRung}, so mail's sub-`read` tiers show as "Read
 * only" here — the same clamp, and the same reason.
 */
export function rungLabel(rung: Rung, form: LabelForm = 'short'): string {
  return permissionLabel(displayPermissionOfRung(rung), form)
}
