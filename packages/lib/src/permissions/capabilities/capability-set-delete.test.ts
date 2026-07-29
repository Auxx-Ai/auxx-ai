// packages/lib/src/permissions/capabilities/capability-set-delete.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { PermissionKey } from './registry'

/**
 * The `Full`-rung record verbs, made def-aware: `canDeleteEntity` /
 * `canImportEntity`.
 *
 * Before this, `recordsDelete` and `recordsImport` could only be granted
 * ORG-WIDE — `record.delete` asserted the bare key beside a per-def `edit` gate,
 * so a def grant could take delete AWAY but never hand it out. These tests pin
 * both directions plus the invariant that made the change safe to ship: the
 * old rule (`edit` floor + the coarse key) is still the first branch, so nobody
 * who could delete before loses it.
 */

const build = (opts: {
  keys?: PermissionKey[]
  defAccess?: Record<string, ResourcePermission>
  restricted?: string[]
  role?: 'OWNER' | 'ADMIN' | 'USER'
  seatType?: SeatType
  defBaseOverrides?: Record<string, ResourcePermission | null>
}) =>
  new CapabilitySet(
    new Set(opts.keys ?? [PermissionKey.recordsView, PermissionKey.recordsEdit]),
    opts.defAccess ?? {},
    opts.role ?? 'USER',
    opts.seatType ?? 'full',
    (id) => id,
    new Set(opts.restricted ?? []),
    (id) => id,
    {},
    new Set(),
    opts.defBaseOverrides ?? {}
  )

const READ_ONLY = [PermissionKey.recordsView]
const READ_WRITE = [PermissionKey.recordsView, PermissionKey.recordsEdit]
const FULL = [
  PermissionKey.recordsView,
  PermissionKey.recordsEdit,
  PermissionKey.recordsDelete,
  PermissionKey.recordsImport,
]

describe('CapabilitySet.canDeleteEntity — the pre-existing rule still holds', () => {
  it('Records Full (the coarse key) + unrestricted def → deletable', () => {
    expect(build({ keys: FULL }).canDeleteEntity('tag')).toBe(true)
  })

  it('Records Edit, no delete key, unrestricted def → denied', () => {
    expect(build({ keys: READ_WRITE }).canDeleteEntity('tag')).toBe(false)
  })

  it('coarse key held but def restricted BELOW edit → denied (the downward lever)', () => {
    const caps = build({
      keys: FULL,
      restricted: ['tag'],
      defAccess: { tag: 'view' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(false)
    // …and the edit floor is what does it, not the verb.
    expect(caps.canEditEntity('tag')).toBe(false)
  })

  it('coarse key held + def granted edit → deletable, as before', () => {
    const caps = build({
      keys: FULL,
      restricted: ['tag'],
      defAccess: { tag: 'edit' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(true)
  })
})

describe('CapabilitySet.canDeleteEntity — the new upward lever', () => {
  it('per-def admin grant confers delete WITHOUT the org-wide key', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['tag'],
      defAccess: { tag: 'admin' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(true)
  })

  it('the lever is scoped to the granted def — siblings stay denied', () => {
    const caps = build({
      keys: READ_WRITE,
      restricted: ['tag'],
      defAccess: { tag: 'admin' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(true)
    expect(caps.canDeleteEntity('contact')).toBe(false)
  })

  it('per-def EDIT alone never confers delete — only the admin rung does', () => {
    const caps = build({
      keys: READ_WRITE,
      restricted: ['tag'],
      defAccess: { tag: 'edit' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(false)
  })

  it('Records Full alone cannot reach the admin rung, so it cannot self-widen', () => {
    // `levelToRecordBasePermission` caps the base at `edit`; the second branch is
    // therefore unreachable from Layer 2 and an unrestricted def is governed
    // solely by the coarse key.
    const caps = build({ keys: READ_WRITE })
    expect(caps.canDeleteEntity('contact')).toBe(false)
  })
})

describe('CapabilitySet.canDeleteEntity — role and seat', () => {
  it('OWNER resolves admin on every def → deletable', () => {
    expect(build({ keys: [], role: 'OWNER' }).canDeleteEntity('tag')).toBe(true)
  })

  it('worker seat is denied even holding both the key and an admin grant', () => {
    const caps = build({
      keys: FULL,
      seatType: 'worker',
      restricted: ['tag'],
      defAccess: { tag: 'admin' },
    })
    expect(caps.canDeleteEntity('tag')).toBe(false)
  })
})

describe('CapabilitySet.canImportEntity', () => {
  it('coarse import key + unrestricted def → importable', () => {
    expect(build({ keys: FULL }).canImportEntity('contact')).toBe(true)
  })

  it('coarse import key but def restricted below edit → denied (the tightening)', () => {
    // `data-import.ts` asserted the coarse verb and NO per-def gate, so this case
    // used to be ALLOWED — a member could bulk-write rows into a def they were
    // explicitly restricted out of.
    const caps = build({
      keys: FULL,
      restricted: ['contact'],
      defAccess: { contact: 'view' },
    })
    expect(caps.canImportEntity('contact')).toBe(false)
  })

  it('per-def admin grant confers import WITHOUT the org-wide key', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['contact'],
      defAccess: { contact: 'admin' },
    })
    expect(caps.canImportEntity('contact')).toBe(true)
  })

  it('delete and import are independent verbs', () => {
    const caps = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit, PermissionKey.recordsDelete],
    })
    expect(caps.canDeleteEntity('contact')).toBe(true)
    expect(caps.canImportEntity('contact')).toBe(false)
  })
})

describe('assertDeleteEntity / assertImportEntity', () => {
  it('throw 403 with a verb-specific message', () => {
    const caps = build({ keys: READ_WRITE })
    expect(() => caps.assertDeleteEntity('tag')).toThrow(
      "You don't have permission to delete these records."
    )
    expect(() => caps.assertImportEntity('tag')).toThrow(
      "You don't have permission to import into these records."
    )
  })

  it('are silent when allowed', () => {
    const caps = build({ keys: FULL })
    expect(() => caps.assertDeleteEntity('tag')).not.toThrow()
    expect(() => caps.assertImportEntity('tag')).not.toThrow()
  })
})
