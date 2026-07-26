// packages/lib/src/permissions/capabilities/capability-set-edit.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { PermissionKey } from './registry'

/**
 * Write-path enforcement (v2 phase 4 §1): `canEditEntity`/`effectiveRecordLevel`
 * combine the Layer-2 base records rung with the Layer-3 per-def grant under
 * most-specific-wins (v1.5 §5.1, revised) — an explicit def grant REPLACES base.
 * The `edit` floor covers create/update/delete/merge (§0.1).
 */

const defIdToDefinitionId = (id: string) =>
  id === 'invoice' || id === 'invoices' ? 'invoice-def' : id

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
    // Resolve mail-infra slugs so isMailInfraDef matches; everything else identity.
    (id) => id,
    new Set(opts.restricted ?? []),
    defIdToDefinitionId,
    {},
    new Set(),
    opts.defBaseOverrides ?? {}
  )

const READ_ONLY = [PermissionKey.recordsView]
const READ_WRITE = [PermissionKey.recordsView, PermissionKey.recordsEdit]

describe('CapabilitySet.canEditEntity (most-specific-wins, edit floor)', () => {
  it('base Read + def Full grant → editable (raise)', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(caps.canEditEntity('invoice-def')).toBe(true)
  })

  it('base Read + def Edit grant → editable (raise)', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'edit' },
    })
    expect(caps.canEditEntity('invoice-def')).toBe(true)
  })

  it('base Full + def Read grant → not editable but viewable (restrict)', () => {
    const caps = build({
      keys: READ_WRITE,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'view' },
    })
    expect(caps.canEditEntity('invoice-def')).toBe(false)
    expect(caps.canViewEntity('invoice-def')).toBe(true)
  })

  it('base None + def Full grant → editable (row 5)', () => {
    const caps = build({
      keys: [],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(caps.canEditEntity('invoice-def')).toBe(true)
    expect(caps.canViewEntity('invoice-def')).toBe(true)
  })

  it('unrestricted def → effectiveRecordLevel == base (verb governs)', () => {
    // Read-write base can edit an unrestricted def…
    expect(build({ keys: READ_WRITE }).canEditEntity('contact-def')).toBe(true)
    // …read-only base cannot.
    expect(build({ keys: READ_ONLY }).canEditEntity('contact-def')).toBe(false)
  })

  it('restricted def, not a grantee (baseline none) → both false', () => {
    const caps = build({ keys: READ_WRITE, restricted: ['invoice-def'], defAccess: {} })
    expect(caps.canEditEntity('invoice-def')).toBe(false)
    expect(caps.canViewEntity('invoice-def')).toBe(false)
  })

  it('OWNER → editable regardless of grant', () => {
    const owner = build({ role: 'OWNER', keys: [], restricted: ['invoice-def'], defAccess: {} })
    expect(owner.canEditEntity('invoice-def')).toBe(true)
  })

  it('ADMIN on a restricted def needs their own grant (doc 19 §5.3 piece 2)', () => {
    // The ADMIN half of the old `effectiveRecordLevel` bypass is gone (step 10),
    // so an admin who is not a grantee of a restricted def cannot edit it.
    const admin = build({ role: 'ADMIN', keys: [], restricted: ['invoice-def'], defAccess: {} })
    expect(admin.canEditEntity('invoice-def')).toBe(false)
    const granted = build({
      role: 'ADMIN',
      keys: [],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'edit' },
    })
    expect(granted.canEditEntity('invoice-def')).toBe(true)
    // Unrestricted defs still flow from the (all-Full) `admin` profile's base.
    expect(build({ role: 'ADMIN', keys: READ_WRITE }).canEditEntity('contact-def')).toBe(true)
  })

  it('worker seat (records ceiling None) → not editable even at def grant admin', () => {
    const worker = build({
      seatType: 'worker',
      keys: [PermissionKey.recordsViewLinked],
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
    })
    expect(worker.canEditEntity('invoice-def')).toBe(false)
    // …but can still VIEW linked rows of the granted def (field-seat carve-out).
    expect(worker.canViewEntity('invoice-def')).toBe(true)
  })

  it('mail-infra def bypasses to the verb gate (canWriteEntity)', () => {
    // Has records.edit → can write signatures (mail-infra) even when restricted.
    const withVerb = build({ keys: READ_WRITE, restricted: ['signature'] })
    expect(withVerb.canEditEntity('signature')).toBe(true)
    // No records.edit → the verb gate denies it.
    const noVerb = build({ keys: READ_ONLY })
    expect(noVerb.canEditEntity('signature')).toBe(false)
  })

  it('feature-backed defs use their derived base for def-aware editing', () => {
    const dispatcher = build({
      keys: [PermissionKey.dispatchBoardView, PermissionKey.dispatchBoardManage],
      defBaseOverrides: { work_order: 'edit' },
    })
    expect(dispatcher.canEditEntity('work_order')).toBe(true)

    const recordsEditor = build({
      keys: READ_WRITE,
      defBaseOverrides: { work_order: null },
    })
    expect(recordsEditor.canEditEntity('work_order')).toBe(false)
  })

  it('keeps coarse dispatch write keys aligned across all dispatch record faces', () => {
    const dispatcher = build({ keys: [PermissionKey.dispatchBoardManage] })
    const recordsEditor = build({ keys: READ_WRITE })

    for (const slug of ['work_order', 'service_request', 'quote', 'invoice']) {
      expect(dispatcher.canWriteEntity(slug)).toBe(true)
      expect(recordsEditor.canWriteEntity(slug)).toBe(false)
    }
  })
})

describe('CapabilitySet.assertEditEntity', () => {
  it('throws for a restricted def the member cannot edit', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'view' },
    })
    expect(() => caps.assertEditEntity('invoice-def')).toThrow()
  })

  it('does not throw for an editable def', () => {
    const caps = build({
      keys: READ_ONLY,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'edit' },
    })
    expect(() => caps.assertEditEntity('invoice-def')).not.toThrow()
  })
})

describe('CapabilitySet.filterEditableDefIds', () => {
  it('keeps editable defs, drops the rest (pure in-memory)', () => {
    const caps = build({
      keys: READ_WRITE,
      restricted: ['invoice-def', 'salary-def'],
      defAccess: { 'invoice-def': 'edit' },
    })
    // contact-def unrestricted (base edit) → kept; invoice granted edit → kept;
    // salary restricted, not a grantee → dropped.
    expect(caps.filterEditableDefIds(['contact-def', 'invoice-def', 'salary-def'])).toEqual([
      'contact-def',
      'invoice-def',
    ])
  })
})
