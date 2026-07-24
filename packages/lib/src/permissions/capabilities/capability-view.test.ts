// packages/lib/src/permissions/capabilities/capability-view.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from './capability-view'
import { intersectCapabilities, MinCapabilitySet } from './capability-view'
import type { InstanceAccessKey } from './instance-access'
import type { PermissionKey } from './registry'

/**
 * `MinCapabilitySet` is the intersection used for human-triggered agent runs
 * (v2 §2): `min(agentProfile, invoker)`. These tests exercise it against
 * hand-built stub views so the semantics are isolated from `CapabilitySet`'s
 * own composition math.
 */

type Stub = {
  keys?: PermissionKey[]
  view?: string[]
  edit?: string[]
  write?: string[]
  admin?: string[]
  access?: Record<string, ResourcePermission>
  instances?: string[]
  label?: string
}

/** A minimal {@link CapabilityView} whose gates are plain allow-lists. */
function stub(opts: Stub): CapabilityView {
  const has = (list: string[] | undefined, id: string) => (list ?? []).includes(id)
  const deny = (): never => {
    throw new ForbiddenError(`denied by ${opts.label ?? 'stub'}`)
  }
  const self: CapabilityView = {
    can: (key) => (opts.keys ?? []).includes(key),
    has: (key) => (opts.keys ?? []).includes(key),
    assert: (key) => {
      if (!self.can(key)) deny()
    },
    canWriteEntity: (id) => has(opts.write, id),
    assertWriteEntity: (id) => {
      if (!self.canWriteEntity(id)) deny()
    },
    canEditEntity: (id) => has(opts.edit, id),
    assertEditEntity: (id) => {
      if (!self.canEditEntity(id)) deny()
    },
    filterEditableDefIds: (ids) => ids.filter((id) => self.canEditEntity(id)),
    canViewEntity: (id) => has(opts.view, id),
    assertViewEntity: (id) => {
      if (!self.canViewEntity(id)) deny()
    },
    filterViewableDefIds: (ids) => ids.filter((id) => self.canViewEntity(id)),
    viewAccessFor: (id) => opts.access?.[id],
    canAdministerDef: (id) => has(opts.admin, id),
    assertAdministerDef: (id) => {
      if (!self.canAdministerDef(id)) deny()
    },
    canViewInstance: (_key, id) => has(opts.instances, id),
    canEditInstance: (_key, id) => has(opts.instances, id),
    canAdminInstance: (_key, id) => has(opts.instances, id),
    assertViewInstance: (key, id) => {
      if (!self.canViewInstance(key, id)) deny()
    },
    assertEditInstance: (key, id) => {
      if (!self.canEditInstance(key, id)) deny()
    },
    assertAdminInstance: (key, id) => {
      if (!self.canAdminInstance(key, id)) deny()
    },
  }
  return self
}

const KEY_A = 'records.view' as PermissionKey
const KEY_B = 'records.edit' as PermissionKey
const DATASET = 'dataset' as InstanceAccessKey

describe('MinCapabilitySet — boolean gates are AND', () => {
  it('a gate passes only when BOTH sides pass', () => {
    const a = stub({ keys: [KEY_A, KEY_B], view: ['def_1', 'def_2'], edit: ['def_1'] })
    const b = stub({ keys: [KEY_A], view: ['def_2', 'def_3'], edit: ['def_1', 'def_2'] })
    const min = new MinCapabilitySet(a, b)

    expect(min.can(KEY_A)).toBe(true)
    expect(min.can(KEY_B)).toBe(false) // only a
    expect(min.has(KEY_B)).toBe(false)

    expect(min.canViewEntity('def_2')).toBe(true)
    expect(min.canViewEntity('def_1')).toBe(false) // only a
    expect(min.canViewEntity('def_3')).toBe(false) // only b
    expect(min.canEditEntity('def_1')).toBe(true)
    expect(min.canEditEntity('def_2')).toBe(false)
  })

  it('an all-permissive side (the admin-bypass case) cannot lift a restricted side', () => {
    // `a` mimics an ADMIN invoker: every gate true. `b` mimics a locked-down agent.
    const admin: CapabilityView = new Proxy(stub({}), {
      get(_t, prop) {
        if (typeof prop === 'string' && prop.startsWith('can')) return () => true
        if (typeof prop === 'string' && prop.startsWith('assert')) return () => undefined
        if (prop === 'viewAccessFor') return () => 'admin' as ResourcePermission
        if (prop === 'filterViewableDefIds' || prop === 'filterEditableDefIds')
          return (ids: string[]) => ids
        return () => true
      },
    })
    const agent = stub({ view: ['def_ok'], label: 'agent' })

    const min = new MinCapabilitySet(admin, agent)
    expect(min.canViewEntity('def_ok')).toBe(true)
    expect(min.canViewEntity('def_secret')).toBe(false)
    // ...and the reverse ordering behaves identically.
    expect(new MinCapabilitySet(agent, admin).canViewEntity('def_secret')).toBe(false)
  })

  it('instance gates AND across both sides', () => {
    const a = stub({ instances: ['ds_1', 'ds_2'] })
    const b = stub({ instances: ['ds_2'] })
    const min = new MinCapabilitySet(a, b)
    expect(min.canViewInstance(DATASET, 'ds_2')).toBe(true)
    expect(min.canEditInstance(DATASET, 'ds_1')).toBe(false)
    expect(min.canAdminInstance(DATASET, 'ds_1')).toBe(false)
  })

  it('canWriteEntity / canAdministerDef AND across both sides', () => {
    const a = stub({ write: ['def_1'], admin: ['def_1', 'def_2'] })
    const b = stub({ write: ['def_1', 'def_2'], admin: ['def_2'] })
    const min = new MinCapabilitySet(a, b)
    expect(min.canWriteEntity('def_1')).toBe(true)
    expect(min.canWriteEntity('def_2')).toBe(false)
    expect(min.canAdministerDef('def_2')).toBe(true)
    expect(min.canAdministerDef('def_1')).toBe(false)
  })
})

describe('MinCapabilitySet.viewAccessFor — level min', () => {
  it('returns the LOWER of the two by PERMISSION_RANK, either ordering', () => {
    const a = stub({ access: { def_1: 'admin', def_2: 'view' } })
    const b = stub({ access: { def_1: 'edit', def_2: 'admin' } })
    expect(new MinCapabilitySet(a, b).viewAccessFor('def_1')).toBe('edit')
    expect(new MinCapabilitySet(b, a).viewAccessFor('def_1')).toBe('edit')
    expect(new MinCapabilitySet(a, b).viewAccessFor('def_2')).toBe('view')
  })

  it('is undefined when EITHER side has no type-level grant', () => {
    const a = stub({ access: { def_1: 'admin' } })
    const b = stub({ access: {} })
    expect(new MinCapabilitySet(a, b).viewAccessFor('def_1')).toBeUndefined()
    expect(new MinCapabilitySet(b, a).viewAccessFor('def_1')).toBeUndefined()
  })

  it("keeps an explicit 'none' row (it is a real, lowest-rank level)", () => {
    const a = stub({ access: { def_1: 'none' } })
    const b = stub({ access: { def_1: 'admin' } })
    expect(new MinCapabilitySet(a, b).viewAccessFor('def_1')).toBe('none')
  })
})

describe('MinCapabilitySet filters — intersection', () => {
  it('filterViewableDefIds keeps only ids both sides allow, preserving order', () => {
    const a = stub({ view: ['def_1', 'def_2', 'def_3'] })
    const b = stub({ view: ['def_3', 'def_2'] })
    expect(new MinCapabilitySet(a, b).filterViewableDefIds(['def_1', 'def_2', 'def_3'])).toEqual([
      'def_2',
      'def_3',
    ])
  })

  it('filterEditableDefIds keeps only ids both sides allow', () => {
    const a = stub({ edit: ['def_1', 'def_2'] })
    const b = stub({ edit: ['def_2', 'def_9'] })
    expect(new MinCapabilitySet(a, b).filterEditableDefIds(['def_1', 'def_2', 'def_9'])).toEqual([
      'def_2',
    ])
  })

  it('returns an empty array when the sides are disjoint', () => {
    const a = stub({ view: ['def_1'] })
    const b = stub({ view: ['def_2'] })
    expect(new MinCapabilitySet(a, b).filterViewableDefIds(['def_1', 'def_2'])).toEqual([])
  })
})

describe('MinCapabilitySet assert* — delegates to BOTH sides', () => {
  it("throws from the FIRST failing side with that side's own message", () => {
    const a = stub({ view: [], label: 'a' })
    const b = stub({ view: [], label: 'b' })
    expect(() => new MinCapabilitySet(a, b).assertViewEntity('def_1')).toThrow('denied by a')
    expect(() => new MinCapabilitySet(b, a).assertViewEntity('def_1')).toThrow('denied by b')
  })

  it('throws from `b` when only `b` denies (and `a` was still consulted)', () => {
    const a = stub({ edit: ['def_1'], label: 'a' })
    const b = stub({ edit: [], label: 'b' })
    const aAssert = vi.spyOn(a, 'assertEditEntity')
    expect(() => new MinCapabilitySet(a, b).assertEditEntity('def_1')).toThrow('denied by b')
    expect(aAssert).toHaveBeenCalledWith('def_1')
  })

  it('does not throw when both sides allow, and calls both', () => {
    const a = stub({ keys: [KEY_A], label: 'a' })
    const b = stub({ keys: [KEY_A], label: 'b' })
    const aAssert = vi.spyOn(a, 'assert')
    const bAssert = vi.spyOn(b, 'assert')
    expect(() => new MinCapabilitySet(a, b).assert(KEY_A)).not.toThrow()
    expect(aAssert).toHaveBeenCalledTimes(1)
    expect(bAssert).toHaveBeenCalledTimes(1)
  })

  it('every assert* surface delegates (write / administer / instance)', () => {
    const permissive = stub({
      write: ['def_1'],
      admin: ['def_1'],
      instances: ['ds_1'],
      label: 'p',
    })
    const restrictive = stub({ label: 'r' })
    const min = new MinCapabilitySet(permissive, restrictive)
    expect(() => min.assertWriteEntity('def_1')).toThrow('denied by r')
    expect(() => min.assertAdministerDef('def_1')).toThrow('denied by r')
    expect(() => min.assertViewInstance(DATASET, 'ds_1')).toThrow('denied by r')
    expect(() => min.assertEditInstance(DATASET, 'ds_1')).toThrow('denied by r')
    expect(() => min.assertAdminInstance(DATASET, 'ds_1')).toThrow('denied by r')
  })
})

describe('intersectCapabilities', () => {
  it('short-circuits to the same object when a === b', () => {
    const a = stub({ view: ['def_1'] })
    expect(intersectCapabilities(a, a)).toBe(a)
  })

  it('wraps in a MinCapabilitySet when the sides differ', () => {
    const a = stub({ view: ['def_1', 'def_2'] })
    const b = stub({ view: ['def_2'] })
    const composed = intersectCapabilities(a, b)
    expect(composed).toBeInstanceOf(MinCapabilitySet)
    expect(composed.canViewEntity('def_1')).toBe(false)
    expect(composed.canViewEntity('def_2')).toBe(true)
  })

  it('composes associatively for three sides', () => {
    const a = stub({ view: ['def_1', 'def_2', 'def_3'] })
    const b = stub({ view: ['def_2', 'def_3'] })
    const c = stub({ view: ['def_3'] })
    const composed = intersectCapabilities(intersectCapabilities(a, b), c)
    expect(composed.filterViewableDefIds(['def_1', 'def_2', 'def_3'])).toEqual(['def_3'])
  })
})
