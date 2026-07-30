// packages/lib/src/permissions/permission-rank.test.ts

import { ResourcePermission, ResourcePermissionValues } from '@auxx/database/enums'
import { PERMISSION_RANK, satisfiesPermission } from '@auxx/types/permissions'
import { describe, expect, it } from 'vitest'

/**
 * `ResourcePermission.none` is a baseline-only lockdown marker (capability layer
 * v2 phase 3). It must be inert in the permission hierarchy: never satisfying a
 * required permission, and never being satisfiable by any actual permission.
 *
 * Formerly `resource-access/constants.test.ts`; moved when the four duplicate
 * ordinal tables collapsed onto `@auxx/types/permissions` (plan v3/03 P3a §3).
 * The previous ARRAY-shaped `PERMISSION_HIERARCHY` expressed "`none` is inert"
 * by OMITTING it (so `indexOf` yielded `-1`); the Record expresses the same
 * thing by ranking it 0, below every positive level. Those two are the same
 * total order — the tests below assert the ORDER, which is the invariant, not
 * the encoding.
 */
describe('satisfiesPermission with the none marker', () => {
  it("ranks 'none' below every positive permission", () => {
    const positiveLevels = ResourcePermissionValues.filter((p) => p !== ResourcePermission.none)
    for (const positive of positiveLevels) {
      expect(PERMISSION_RANK[ResourcePermission.none]).toBeLessThan(PERMISSION_RANK[positive])
    }
  })

  it("a 'none' actual never satisfies any positive required permission", () => {
    // 'none' is only ever written as an actual (the baseline marker), never as a
    // required level — so the meaningful invariant is against view/edit/admin.
    const positiveLevels = ResourcePermissionValues.filter((p) => p !== ResourcePermission.none)
    for (const required of positiveLevels) {
      expect(satisfiesPermission(ResourcePermission.none, required)).toBe(false)
    }
  })

  it('keeps the positive hierarchy intact (view < edit < admin)', () => {
    expect(satisfiesPermission(ResourcePermission.admin, ResourcePermission.view)).toBe(true)
    expect(satisfiesPermission(ResourcePermission.view, ResourcePermission.admin)).toBe(false)
    expect(satisfiesPermission(ResourcePermission.edit, ResourcePermission.edit)).toBe(true)
  })

  /**
   * The consolidation's correctness proof, pinned. The deleted array-shaped
   * comparator ranked `none` at `-1` via `indexOf`; the surviving Record ranks
   * it at `0`. Both are the same total order, so every one of the 16
   * (actual, required) pairs answers identically — which is what made the merge
   * a no-op rather than a vocabulary change.
   */
  it('agrees with the deleted indexOf-based comparator on every pair', () => {
    const legacyHierarchy: ResourcePermission[] = [
      ResourcePermission.view,
      ResourcePermission.edit,
      ResourcePermission.admin,
    ]
    const legacySatisfies = (actual: ResourcePermission, required: ResourcePermission) =>
      legacyHierarchy.indexOf(actual) >= legacyHierarchy.indexOf(required)

    for (const actual of ResourcePermissionValues) {
      for (const required of ResourcePermissionValues) {
        expect(satisfiesPermission(actual, required), `${actual} vs ${required}`).toBe(
          legacySatisfies(actual, required)
        )
      }
    }
  })
})
