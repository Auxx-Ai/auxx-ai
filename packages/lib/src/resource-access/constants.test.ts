// packages/lib/src/resource-access/constants.test.ts

import { ResourcePermission, ResourcePermissionValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { PERMISSION_HIERARCHY, satisfiesPermission } from './constants'

/**
 * `ResourcePermission.none` is a baseline-only lockdown marker (capability layer
 * v2 phase 3). It must be inert in the permission hierarchy: never satisfying a
 * required permission, and never being satisfiable by any actual permission.
 */
describe('satisfiesPermission with the none marker', () => {
  it("excludes 'none' from the hierarchy", () => {
    expect(PERMISSION_HIERARCHY).not.toContain(ResourcePermission.none)
    expect(PERMISSION_HIERARCHY).toEqual([
      ResourcePermission.view,
      ResourcePermission.edit,
      ResourcePermission.admin,
    ])
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
})
