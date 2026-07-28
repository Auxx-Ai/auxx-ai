// apps/web/src/components/permissions/ui/level-labels.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Level } from '@auxx/lib/permissions/client'

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

/** Display label for a `ResourcePermission`, on the shared rung vocabulary. */
export function permissionLabel(permission: ResourcePermission, form: LabelForm = 'short'): string {
  return labelOf(LEVEL_OF_PERMISSION[permission], form)
}
