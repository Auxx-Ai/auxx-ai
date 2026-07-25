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
 * raw `defAccess` map, so the profile definition ceiling and the worker seat
 * ceiling apply here too. The base rungs top out at `edit`, so routing through
 * the effective level does NOT let a base-`Full` member administer a def — every
 * assertion below is unchanged by the repoint.
 */

const defIdToDefinitionId = (id: string) =>
  id === 'invoice' || id === 'invoices' ? 'invoice-def' : id

const build = (opts: {
  keys?: PermissionKey[]
  defAccess?: Record<string, ResourcePermission>
  restricted?: string[]
  role?: 'OWNER' | 'ADMIN' | 'USER'
  seatType?: SeatType
  ceilingDefs?: { mode: 'only' | 'except'; defIds: string[] } | null
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
    new Set(),
    {},
    opts.ceilingDefs
      ? { mode: opts.ceilingDefs.mode, defIds: new Set(opts.ceilingDefs.defIds) }
      : null
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

  it('an `admin` grant on a def the profile ceiling excludes does not administer it', () => {
    const only = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
      ceilingDefs: { mode: 'only', defIds: ['contact-def'] },
    })
    expect(only.canAdministerDef('invoice-def')).toBe(false)
    expect(() => only.assertAdministerDef('invoice-def')).toThrow()

    const except = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
      ceilingDefs: { mode: 'except', defIds: ['invoice-def'] },
    })
    expect(except.canAdministerDef('invoice-def')).toBe(false)
  })

  it('a def the ceiling still admits keeps its `admin` grant', () => {
    const caps = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
      ceilingDefs: { mode: 'only', defIds: ['invoice-def'] },
    })
    expect(caps.canAdministerDef('invoice-def')).toBe(true)
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

  it('true for a def-`admin` grantee the ceiling still admits', () => {
    expect(
      administersAnyDef(
        resolved({
          restricted: ['invoice-def'],
          defAccess: { 'invoice-def': 'admin' },
          ceilingDefs: { mode: 'only', defIds: ['invoice-def'] },
        })
      )
    ).toBe(true)
  })

  it('false when every `admin` grant is outside the ceiling — the org-wide hole (§3)', () => {
    expect(
      administersAnyDef(
        resolved({
          restricted: ['invoice-def'],
          defAccess: { 'invoice-def': 'admin' },
          ceilingDefs: { mode: 'only', defIds: ['contact-def'] },
        })
      )
    ).toBe(false)
    expect(
      administersAnyDef(
        resolved({
          restricted: ['invoice-def'],
          defAccess: { 'invoice-def': 'admin' },
          ceilingDefs: { mode: 'except', defIds: ['invoice-def'] },
        })
      )
    ).toBe(false)
  })

  it('true when at least ONE admitted def carries an `admin` grant', () => {
    expect(
      administersAnyDef(
        resolved({
          restricted: ['invoice-def', 'contact-def'],
          defAccess: { 'invoice-def': 'admin', 'contact-def': 'admin' },
          ceilingDefs: { mode: 'except', defIds: ['invoice-def'] },
        })
      )
    ).toBe(true)
  })

  it('OWNER/ADMIN are never clamped by it', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(
        administersAnyDef(
          resolved({ role, defAccess: {}, ceilingDefs: { mode: 'only', defIds: [] } })
        )
      ).toBe(true)
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
