// packages/lib/src/permissions/capabilities/capability-set-administer.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { administersAnyDef, toResolvedRecordAccess } from './entity-access'
import { PermissionKey } from './registry'

/**
 * Def-administration enforcement (v2 phase 4 §9.1): `canAdministerDef` gates the
 * `Full`/`admin` rung — managing a def's fields, its access, its metadata, and
 * deleting the def. Unlike record writes, it does NOT flow from the base records
 * level: only an explicit `admin` type-grant (or OWNER/ADMIN) confers it.
 *
 * As of doc 19 step 4 the resolver reads `effectiveRecordLevel` rather than the
 * raw `defAccess` map, so every clamp on that path — today the worker seat
 * ceiling — applies here too. The base rungs top out at `edit`, so routing
 * through the effective level does NOT let a base-`Full` member administer a def;
 * every assertion below is unchanged by the repoint. That repoint outlives plan
 * 20's deletion of the definition ceiling and must not be reverted with it.
 */

const defIdToDefinitionId = (id: string) =>
  id === 'invoice' || id === 'invoices' ? 'invoice-def' : id

const build = (opts: {
  keys?: PermissionKey[]
  defAccess?: Record<string, ResourcePermission>
  restricted?: string[]
  role?: 'OWNER' | 'ADMIN' | 'USER'
  seatType?: SeatType
}) =>
  new CapabilitySet(
    new Set(opts.keys ?? [PermissionKey.recordsView, PermissionKey.recordsEdit]),
    opts.defAccess ?? {},
    opts.role ?? 'USER',
    opts.seatType ?? 'full',
    (id) => id,
    new Set(opts.restricted ?? []),
    defIdToDefinitionId,
    {},
    new Set()
  )

const READ_WRITE = [PermissionKey.recordsView, PermissionKey.recordsEdit]

describe('CapabilitySet.canAdministerDef (Full/admin rung, §9.1)', () => {
  it('explicit def `admin` grant → can administer', () => {
    const caps = build({
      keys: [],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(caps.canAdministerDef('invoice-def')).toBe(true)
    // slug form resolves to the same canonical def.
    expect(caps.canAdministerDef('invoice')).toBe(true)
  })

  it('base Full (records.edit) does NOT confer def-admin — it edits records, not defs', () => {
    // Unrestricted def, read-write base: can edit records but never administer.
    expect(build({ keys: READ_WRITE }).canAdministerDef('contact-def')).toBe(false)
  })

  it('explicit def `edit` / `view` grant → cannot administer', () => {
    expect(
      build({
        restricted: ['invoice-def'],
        defAccess: { 'invoice-def': 'edit' },
      }).canAdministerDef('invoice-def')
    ).toBe(false)
    expect(
      build({
        restricted: ['invoice-def'],
        defAccess: { 'invoice-def': 'view' },
      }).canAdministerDef('invoice-def')
    ).toBe(false)
  })

  it('OWNER/ADMIN → can administer any def regardless of grant', () => {
    expect(build({ role: 'ADMIN', keys: [], defAccess: {} }).canAdministerDef('invoice-def')).toBe(
      true
    )
    expect(build({ role: 'OWNER', keys: [], defAccess: {} }).canAdministerDef('invoice-def')).toBe(
      true
    )
  })

  it('worker seat (records ceiling None) → never administers, even at def grant admin', () => {
    const worker = build({
      seatType: 'worker',
      keys: [PermissionKey.recordsViewLinked],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(worker.canAdministerDef('invoice-def')).toBe(false)
  })

  it('scoped to the exact def — an `admin` grant on one def does not administer another', () => {
    const caps = build({
      restricted: ['invoice-def', 'salary-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(caps.canAdministerDef('invoice-def')).toBe(true)
    expect(caps.canAdministerDef('salary-def')).toBe(false)
    expect(caps.canAdministerDef('contact-def')).toBe(false)
  })
})

describe('administersAnyDef (org-wide "is there any def-admin surface for me")', () => {
  const resolved = (opts: Parameters<typeof build>[0]) =>
    toResolvedRecordAccess(build(opts).toClientCapabilities())

  it('true for a def-`admin` grantee', () => {
    expect(
      administersAnyDef(
        resolved({ restricted: ['invoice-def'], defAccess: { 'invoice-def': 'admin' } })
      )
    ).toBe(true)
  })

  it('false when no grant reaches the `admin` rung', () => {
    expect(
      administersAnyDef(
        resolved({
          restricted: ['invoice-def', 'salary-def'],
          defAccess: { 'invoice-def': 'edit', 'salary-def': 'view' },
        })
      )
    ).toBe(false)
    expect(administersAnyDef(resolved({ defAccess: {} }))).toBe(false)
  })

  it('a worker seat never administers, whatever the grant says', () => {
    expect(
      administersAnyDef(
        resolved({
          seatType: 'worker',
          keys: [PermissionKey.recordsViewLinked],
          restricted: ['invoice-def'],
          defAccess: { 'invoice-def': 'admin' },
        })
      )
    ).toBe(false)
  })

  it('OWNER/ADMIN administer every def with no grant at all', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(administersAnyDef(resolved({ role, defAccess: {} }))).toBe(true)
    }
  })
})

describe('CapabilitySet.assertAdministerDef', () => {
  it('throws when the member cannot administer the def', () => {
    const caps = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'edit' },
    })
    expect(() => caps.assertAdministerDef('invoice-def')).toThrow()
  })

  it('does not throw for a def-`admin` grantee', () => {
    const caps = build({
      keys: [],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(() => caps.assertAdministerDef('invoice-def')).not.toThrow()
  })
})
