// packages/lib/src/permissions/capabilities/capability-set-view.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import {
  administersAnyDef,
  canEditRecord,
  canViewRecord,
  toResolvedRecordAccess,
} from './entity-access'
import { PermissionKey } from './registry'

/**
 * Read-path enforcement (v2 §0): `canViewEntity` combines the Layer-2 verb
 * (`records.view`) with the Layer-3 noun (type-level def grants) under
 * "absent = unrestricted" semantics.
 */

// A resolver that normalizes any slug/apiSlug/id form to the canonical
// entityDefinitionId keyspace (the keyspace of defAccess / restrictedDefIds).
const defIdToDefinitionId = (id: string) =>
  id === 'invoice' || id === 'invoices' ? 'invoice-def' : id

const build = (opts: {
  hasView?: boolean
  keys?: PermissionKey[]
  defAccess?: Record<string, ResourcePermission>
  restricted?: string[]
  role?: 'OWNER' | 'ADMIN' | 'USER'
  seatType?: 'full' | 'worker'
  defBaseOverrides?: Record<string, ResourcePermission | null>
  ceilingDefs?: { mode: 'only' | 'except'; defIds: string[] } | null
}) =>
  new CapabilitySet(
    new Set(opts.keys ?? (opts.hasView === false ? [] : [PermissionKey.recordsView])),
    opts.defAccess ?? {},
    opts.role ?? 'USER',
    opts.seatType ?? 'full',
    (id) => id,
    new Set(opts.restricted ?? []),
    defIdToDefinitionId,
    {},
    new Set(),
    opts.defBaseOverrides ?? {},
    opts.ceilingDefs
      ? { mode: opts.ceilingDefs.mode, defIds: new Set(opts.ceilingDefs.defIds) }
      : null
  )

describe('CapabilitySet.canViewEntity (absent = unrestricted)', () => {
  it('uses a feature-area-derived base for dispatch record definitions', () => {
    const recordsEditorWithoutDispatch = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
      defBaseOverrides: { 'work-order-def': null },
    })
    expect(recordsEditorWithoutDispatch.canViewEntity('work-order-def')).toBe(false)

    const dispatchReaderWithoutRecords = build({
      keys: [PermissionKey.dispatchBoardView],
      defBaseOverrides: { 'work-order-def': 'view' },
    })
    expect(dispatchReaderWithoutRecords.canViewEntity('work-order-def')).toBe(true)
    expect(dispatchReaderWithoutRecords.canEditEntity('work-order-def')).toBe(false)

    const dispatchManagerWithoutRecords = build({
      keys: [PermissionKey.dispatchBoardView, PermissionKey.dispatchBoardManage],
      defBaseOverrides: { 'work-order-def': 'edit' },
    })
    expect(dispatchManagerWithoutRecords.canViewEntity('work-order-def')).toBe(true)
    expect(dispatchManagerWithoutRecords.canEditEntity('work-order-def')).toBe(true)
  })

  it('lets an explicit def grant replace a closed feature-area base', () => {
    const caps = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
      restricted: ['work-order-def'],
      defAccess: { 'work-order-def': 'view' },
      defBaseOverrides: { 'work-order-def': null },
    })
    expect(caps.canViewEntity('work-order-def')).toBe(true)
    expect(caps.canEditEntity('work-order-def')).toBe(false)
  })

  it('keeps the worker linked-record carve-out with a closed dispatch base', () => {
    const caps = build({
      keys: [PermissionKey.dispatchMySchedule, PermissionKey.recordsViewLinked],
      seatType: 'worker',
      defBaseOverrides: { 'work-order-def': null },
    })
    expect(caps.canViewEntity('work-order-def')).toBe(true)
    expect(caps.canEditEntity('work-order-def')).toBe(false)
  })

  it('serializes derived bases for the client resolver', () => {
    const caps = build({ defBaseOverrides: { 'work-order-def': null } })
    const snapshot = caps.toClientCapabilities()
    expect(snapshot.defBaseOverrides).toEqual({ 'work-order-def': null })
    expect(canViewRecord(toResolvedRecordAccess(snapshot), 'work-order-def')).toBe(false)
  })

  it('a def with NO type-level grant is visible to everyone with records.view', () => {
    const caps = build({ restricted: ['other-def'] })
    expect(caps.canViewEntity('invoice-def')).toBe(true)
  })

  it('a restricted def is visible to a grantee', () => {
    const caps = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'view' },
    })
    expect(caps.canViewEntity('invoice-def')).toBe(true)
  })

  it('a restricted def is denied to a non-grantee', () => {
    const caps = build({ restricted: ['invoice-def'], defAccess: {} })
    expect(caps.canViewEntity('invoice-def')).toBe(false)
  })

  it('most-specific-wins: a def grant lets a base-None member view that def', () => {
    // v1.5 §5.1 (revised): an explicit per-def grant REPLACES the base records
    // verb, so a grantee sees the restricted def even with no base records.view.
    const caps = build({
      hasView: false,
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'view' },
    })
    expect(caps.canViewEntity('invoice-def')).toBe(true)
    // But an UNRESTRICTED def still falls back to base (None here) → denied.
    expect(caps.canViewEntity('anything')).toBe(false)
  })

  it('normalizes a slug/apiSlug argument to the canonical entityDefinitionId', () => {
    const grantee = build({ restricted: ['invoice-def'], defAccess: { 'invoice-def': 'edit' } })
    const outsider = build({ restricted: ['invoice-def'], defAccess: {} })
    // 'invoice' and 'invoices' both resolve to 'invoice-def'.
    expect(grantee.canViewEntity('invoice')).toBe(true)
    expect(grantee.canViewEntity('invoices')).toBe(true)
    expect(outsider.canViewEntity('invoice')).toBe(false)
  })

  it('with an empty restricted set, degrades to the coarse records.view verb', () => {
    const withView = build({})
    const withoutView = build({ hasView: false })
    expect(withView.canViewEntity('invoice-def')).toBe(true)
    expect(withoutView.canViewEntity('invoice-def')).toBe(false)
  })

  it('recordsViewLinked satisfies the verb layer (field seats; rows narrowed elsewhere)', () => {
    const fieldSeat = build({ keys: [PermissionKey.recordsViewLinked], seatType: 'worker' })
    expect(fieldSeat.canViewEntity('invoice-def')).toBe(true)
    // Restricted defs still require a grant for a field seat.
    const restricted = build({
      keys: [PermissionKey.recordsViewLinked],
      restricted: ['invoice-def'],
      seatType: 'worker',
    })
    expect(restricted.canViewEntity('invoice-def')).toBe(false)
  })

  it('recordsViewLinked does NOT carve out for a full seat (base None stays None)', () => {
    // ROLE_DEFAULTS.USER hands `recordsLinked` out at Full, so an ordinary member
    // holds this key alongside their base records level. Before the seat gate it
    // granted view of every unrestricted def to a base-None member.
    const fullSeat = build({ keys: [PermissionKey.recordsViewLinked], seatType: 'full' })
    expect(fullSeat.canViewEntity('invoice-def')).toBe(false)
  })

  it('mail-infrastructure defs bypass both layers (visibility governed by mail system)', () => {
    // No records verb at all — inbox/signature reads must still pass.
    const noVerb = build({ hasView: false })
    expect(noVerb.canViewEntity('inbox')).toBe(true)
    expect(noVerb.canViewEntity('signature')).toBe(true)
    expect(noVerb.canViewEntity('thread')).toBe(true)
    // Even listed as restricted (sharing rows must never restrict).
    const restricted = build({ hasView: false, restricted: ['inbox'] })
    expect(restricted.canViewEntity('inbox')).toBe(true)
  })

  it("baseline 'none' + group grant: grantee sees the def, non-grantee is denied", () => {
    // A `role:org_member @ none` baseline row flags the def restricted (present
    // in restrictedDefIds) but composes to NO defAccess entry for a non-grantee,
    // while a team/member grantee gets their own defAccess entry.
    const grantee = build({ restricted: ['invoice-def'], defAccess: { 'invoice-def': 'view' } })
    const nonGrantee = build({ restricted: ['invoice-def'], defAccess: {} })
    expect(grantee.canViewEntity('invoice-def')).toBe(true)
    expect(nonGrantee.canViewEntity('invoice-def')).toBe(false)
    // Admins bypass the lockdown regardless.
    const admin = build({ role: 'ADMIN', restricted: ['invoice-def'], defAccess: {} })
    expect(admin.canViewEntity('invoice-def')).toBe(true)
  })

  it('OWNER/ADMIN bypass both layers (effectiveRecordLevel → admin)', () => {
    const admin = build({ role: 'ADMIN', restricted: ['invoice-def'], defAccess: {} })
    expect(admin.canViewEntity('invoice-def')).toBe(true)
    const owner = build({ role: 'OWNER', restricted: ['invoice-def'], defAccess: {} })
    expect(owner.canViewEntity('invoice-def')).toBe(true)
    // Under most-specific-wins OWNER/ADMIN resolve to `admin` regardless of the
    // base verb — in practice they always hold records.view (role default Full).
    const adminNoVerb = build({ role: 'ADMIN', hasView: false, restricted: ['invoice-def'] })
    expect(adminNoVerb.canViewEntity('invoice-def')).toBe(true)
  })
})

describe('profile definition ceiling (doc 19 §0.13 / step 4)', () => {
  it('`only` admits exactly the listed defs — an unlisted one is denied (fails closed)', () => {
    const caps = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
      ceilingDefs: { mode: 'only', defIds: ['contact-def'] },
    })
    expect(caps.canViewEntity('contact-def')).toBe(true)
    expect(caps.canEditEntity('contact-def')).toBe(true)
    expect(caps.canViewEntity('invoice-def')).toBe(false)
    expect(caps.canEditEntity('invoice-def')).toBe(false)
  })

  it('`only` excludes a def created LATER — the allow-list is closed by construction', () => {
    // `defIds` is resolved from the profile's stored apiSlugs at read time, so a
    // definition nobody has listed is simply not in the set.
    const caps = build({ ceilingDefs: { mode: 'only', defIds: ['contact-def'] } })
    expect(caps.canViewEntity('brand-new-def')).toBe(false)
  })

  it('`except` denies exactly the listed defs and admits new ones (fails open)', () => {
    const caps = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
      ceilingDefs: { mode: 'except', defIds: ['salary-def'] },
    })
    expect(caps.canViewEntity('salary-def')).toBe(false)
    expect(caps.canEditEntity('salary-def')).toBe(false)
    expect(caps.canViewEntity('contact-def')).toBe(true)
    expect(caps.canViewEntity('brand-new-def')).toBe(true)
  })

  it('outranks an explicit def grant — the ceiling is a cap, not another grant tier', () => {
    const caps = build({
      restricted: ['invoice-def'],
      defAccess: { 'invoice-def': 'admin' },
      ceilingDefs: { mode: 'only', defIds: ['contact-def'] },
    })
    expect(caps.canViewEntity('invoice-def')).toBe(false)
    expect(caps.canAdministerDef('invoice-def')).toBe(false)
  })

  it('normalizes its argument before the ceiling check (slug/apiSlug forms)', () => {
    const caps = build({ ceilingDefs: { mode: 'except', defIds: ['invoice-def'] } })
    expect(caps.canViewEntity('invoice')).toBe(false)
    expect(caps.canViewEntity('invoices')).toBe(false)
  })

  it('OWNER is never clamped by it (§0.10 recovery guarantee)', () => {
    // The composer emits `null` for OWNER, but the resolver short-circuits before
    // the ceiling too — belt and braces, since a mis-shaped profile must always
    // stay fixable from inside the product.
    const owner = build({ role: 'OWNER', ceilingDefs: { mode: 'only', defIds: ['contact-def'] } })
    expect(owner.canViewEntity('invoice-def')).toBe(true)
    expect(owner.canAdministerDef('invoice-def')).toBe(true)
  })

  it('the worker `recordsViewLinked` carve-out respects it (a field seat cannot walk around it)', () => {
    // The carve-out returns true for ANY unrestricted def without consulting
    // `effectiveRecordLevel`, so the clamp has to be re-applied inside it.
    const fieldSeat = build({
      keys: [PermissionKey.recordsViewLinked],
      seatType: 'worker',
      ceilingDefs: { mode: 'only', defIds: ['work-order-def'] },
    })
    expect(fieldSeat.canViewEntity('work-order-def')).toBe(true)
    expect(fieldSeat.canViewEntity('invoice-def')).toBe(false)
  })

  it('a `null` ceiling leaves every def resolution exactly as it was', () => {
    const caps = build({ ceilingDefs: null })
    expect(caps.canViewEntity('invoice-def')).toBe(true)
    expect(caps.canViewEntity('anything-else')).toBe(true)
  })

  it('survives the server→client round trip (toClientCapabilities → toResolvedRecordAccess)', () => {
    const caps = build({
      keys: [PermissionKey.recordsView, PermissionKey.recordsEdit],
      ceilingDefs: { mode: 'only', defIds: ['contact-def'] },
    })
    const snapshot = caps.toClientCapabilities()
    expect(snapshot.ceilingDefs).toEqual({ mode: 'only', defIds: ['contact-def'] })
    const client = toResolvedRecordAccess(snapshot)
    expect(canViewRecord(client, 'contact-def')).toBe(true)
    // The UI must not offer what the server denies.
    expect(canViewRecord(client, 'invoice-def')).toBe(false)
    expect(canEditRecord(client, 'invoice-def')).toBe(false)
    expect(administersAnyDef(client)).toBe(false)
  })

  it('serializes `null` when uncapped, and rehydrates to an uncapped client view', () => {
    const snapshot = build({}).toClientCapabilities()
    expect(snapshot.ceilingDefs).toBeNull()
    expect(canViewRecord(toResolvedRecordAccess(snapshot), 'invoice-def')).toBe(true)
  })
})

describe('CapabilitySet.filterViewableDefIds', () => {
  it('drops non-viewable defs, keeps viewable ones (pure in-memory)', () => {
    const caps = build({
      restricted: ['invoice-def', 'salary-def'],
      defAccess: { 'invoice-def': 'view' },
    })
    // 'contact-def' unrestricted → kept; invoice granted → kept; salary restricted, not granted → dropped.
    expect(caps.filterViewableDefIds(['contact-def', 'invoice-def', 'salary-def'])).toEqual([
      'contact-def',
      'invoice-def',
    ])
  })
})

describe('CapabilitySet.assertViewEntity', () => {
  it('throws for a restricted def the member cannot see', () => {
    const caps = build({ restricted: ['invoice-def'], defAccess: {} })
    expect(() => caps.assertViewEntity('invoice-def')).toThrow()
  })

  it('does not throw for a viewable def', () => {
    const caps = build({ restricted: ['invoice-def'], defAccess: { 'invoice-def': 'admin' } })
    expect(() => caps.assertViewEntity('invoice-def')).not.toThrow()
  })
})
