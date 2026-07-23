// packages/lib/src/permissions/capabilities/compose-user-capabilities.test.ts

import { describe, expect, it } from 'vitest'
import { composeUserCapabilities } from './compose-user-capabilities'
import { Area, Level, PermissionKey } from './registry'
import { effectiveDefault, WORKER_SEAT_KEYS } from './seat-policy'

const sorted = (keys: PermissionKey[]) => [...keys].sort()

describe('composeUserCapabilities (leveled model, sparse jsonb)', () => {
  it('gives OWNER and ADMIN every key (full seat)', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const caps = composeUserCapabilities({ role, seatType: 'full', typeAccessRows: [] })
      expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('OWNER', 'full')))
      // Sanity: admins hold the adminOnly keys.
      expect(caps.keys).toContain(PermissionKey.settingsManage)
      expect(caps.keys).toContain(PermissionKey.membersManage)
    }
  })

  it('gives USER the role default (adminOnly areas absent)', () => {
    const caps = composeUserCapabilities({ role: 'USER', seatType: 'full', typeAccessRows: [] })
    expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('USER', 'full')))
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
    expect(caps.keys).not.toContain(PermissionKey.billingManage)
    expect(caps.keys).not.toContain(PermissionKey.membersManage)
    expect(caps.keys).not.toContain(PermissionKey.permissionsManage)
    // A full USER holds full records (view/edit/delete/import).
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.recordsImport)
  })

  it("a worker seat's effective default is exactly WORKER_SEAT_KEYS", () => {
    const caps = composeUserCapabilities({ role: 'USER', seatType: 'worker', typeAccessRows: [] })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
  })

  it('org policy falls through PER AREA: sets records=Read, leaves workflows at USER default', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // Sparse policy: ONLY records is overridden — every other area is unset.
      orgPolicyLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    // records is lowered to Read (the set area).
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsEdit)
    expect(caps.keys).not.toContain(PermissionKey.recordsDelete)
    // workflows is UNSET in the policy → falls through to the USER default, NOT None.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('org policy lowers a set area (records → Read)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      orgPolicyLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsDelete)
  })

  it('org policy does NOT lower OWNER/ADMIN (short-circuit to Full)', () => {
    const caps = composeUserCapabilities({
      role: 'ADMIN',
      seatType: 'full',
      orgPolicyLevels: { [Area.records]: Level.None, [Area.workflows]: Level.None },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.settingsManage)
  })

  it('a group grant raises above the org-policy baseline but cannot lower it', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // Policy baseline: records at Read.
      orgPolicyLevels: { [Area.records]: Level.Read },
      // Group raises records to Full; a None on workflows can't lower the default.
      groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).toContain(PermissionKey.recordsEdit)
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    // workflows stays at the USER default despite the group's None (raise-only).
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('two groups at the same area resolve to the max level', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      orgPolicyLevels: { [Area.records]: Level.None },
      groupLevels: [{ [Area.records]: Level.Read }, { [Area.records]: Level.Full }],
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsDelete) // max = Full wins
  })

  it('seat ceiling dominates a Full group grant (worker keeps exactly the three surfaces)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      // A group + user grant Full on several areas — the worker ceiling zeroes all but three.
      groupLevels: [
        {
          [Area.records]: Level.Full,
          [Area.settings]: Level.Full,
          [Area.dispatchBoard]: Level.Full,
        },
      ],
      userLevels: { [Area.records]: Level.Full, [Area.billing]: Level.Full },
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
    expect(caps.keys).not.toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
  })

  it('a direct user grant raises the org-policy-lowered baseline (records → Full)', () => {
    const base = composeUserCapabilities({ role: 'USER', seatType: 'full', typeAccessRows: [] })
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      orgPolicyLevels: { [Area.records]: Level.Read },
      userLevels: { [Area.records]: Level.Full },
      typeAccessRows: [],
    })
    expect(base.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
  })

  it('reduces typeAccessRows to the highest permission per definition', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [
        { entityDefinitionId: 'def_a', permission: 'view' },
        { entityDefinitionId: 'def_a', permission: 'admin' },
        { entityDefinitionId: 'def_a', permission: 'edit' },
        { entityDefinitionId: 'def_b', permission: 'edit' },
        { entityDefinitionId: 'def_b', permission: 'view' },
      ],
    })
    expect(caps.defAccess).toEqual({ def_a: 'admin', def_b: 'edit' })
  })

  it("skips a baseline 'none' row so it never seeds a defAccess entry (grants nobody)", () => {
    // Non-grantee: only the org_member lockdown row applies → no defAccess entry,
    // so canViewEntity denies (the def is still flagged restricted upstream).
    const nonGrantee = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_locked', permission: 'none' }],
    })
    expect(nonGrantee.defAccess).toEqual({})

    // Grantee: the lockdown row plus their own positive grant → only the positive
    // level surfaces in defAccess (none is skipped, not max-composed to 0).
    const grantee = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [
        { entityDefinitionId: 'def_locked', permission: 'none' },
        { entityDefinitionId: 'def_locked', permission: 'view' },
      ],
    })
    expect(grantee.defAccess).toEqual({ def_locked: 'view' })
  })

  it("a baseline 'view' row makes the def visible to everyone (grant present)", () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_open', permission: 'view' }],
    })
    expect(caps.defAccess).toEqual({ def_open: 'view' })
  })

  it('fails closed for an undefined role (non-member): no keys', () => {
    const caps = composeUserCapabilities({
      role: undefined,
      seatType: 'full',
      userLevels: { [Area.records]: Level.Full },
      typeAccessRows: [],
    })
    expect(caps.keys).toEqual([])
  })

  it('is JSON-serializable (cache round-trip)', () => {
    const caps = composeUserCapabilities({
      role: 'ADMIN',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_a', permission: 'edit' }],
    })
    expect(JSON.parse(JSON.stringify(caps))).toEqual(caps)
  })
})
