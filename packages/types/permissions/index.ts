// packages/types/permissions/index.ts

import type { ResourcePermission } from '@auxx/database/enums'

/**
 * The ordinal rank of a stored {@link ResourcePermission} — **the single source
 * of truth** for "which `ResourceAccess` permission outranks which".
 *
 * Lives in `@auxx/types` (tier 1) because every tier above needs it: the
 * capability composer and the resource-access service in `@auxx/lib`, the
 * group-permission helpers, and the client gate hooks in `apps/web`.
 *
 * ### `none` is a RESTRICTION marker, never a grant
 *
 * A `role:org_member @ none` row marks an instance or def row-described while
 * granting nobody — see `project_permission_none_is_a_restriction`. It
 * therefore ranks below every positive permission, so it satisfies no positive
 * requirement and loses every `max` against a real grant. It is never written
 * as a *required* level, which is why `satisfiesPermission('none', 'none')`
 * (trivially `true`, as `x >= x`) is not a meaningful case.
 *
 * ### Consolidated 2026-07-29 (plan v3/03 P3a §3)
 *
 * This table replaces four copies: `PERMISSION_RANK` in
 * `permissions/capabilities/compose-user-capabilities.ts`, an ARRAY-shaped
 * `PERMISSION_HIERARCHY` in `resource-access/constants.ts` (which omitted
 * `none` so `indexOf` yielded `-1`), a RECORD-shaped `PERMISSION_HIERARCHY` in
 * `@auxx/types/groups`, and a private copy in `inboxes/inbox-def-move.ts`.
 *
 * The two `satisfiesPermission` implementations read as though they disagreed
 * about `none` — one docstring claimed a `none` actual "never satisfies any
 * required permission" — but they were **observationally identical over all 16
 * (actual, required) pairs**: `none(-1) < view(0) < edit(1) < admin(2)` and
 * `none(0) < view(1) < edit(2) < admin(3)` are the same total order, and
 * `satisfiesPermission` only ever compares two ranks. The `-1` convention was
 * emergent from `indexOf`, not a semantic; the Record form is kept because it
 * is total (an unmapped value reads `undefined` and fails every comparison,
 * rather than silently aliasing onto `none`'s `-1`).
 *
 * The `none`-inert semantics are pinned by
 * `packages/lib/src/permissions/permission-rank.test.ts`.
 */
export const PERMISSION_RANK: Record<ResourcePermission, number> = {
  none: 0,
  view: 1,
  edit: 2,
  admin: 3,
}

/**
 * Whether an actual permission satisfies a required one.
 *
 * @param actual - the permission the member resolved to
 * @param required - the permission the operation demands
 */
export function satisfiesPermission(
  actual: ResourcePermission,
  required: ResourcePermission
): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required]
}
