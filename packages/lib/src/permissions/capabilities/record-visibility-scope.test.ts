// packages/lib/src/permissions/capabilities/record-visibility-scope.test.ts
//
// Plan v3/03 §5.1–§5.3 (P5) — the four-arm record scope, the `_access` stamp fold,
// and the row-effective verb gates.
//
// The ARM decision and the FOLD are asserted here rather than the built SQL: under
// the default Vitest config `@auxx/database`'s `schema` is a Proxy whose columns are
// `undefined`, so asserting on a Drizzle predicate passes vacuously
// (`project_drizzle_columns_undefined_in_vitest`). Everything in this file is pure.

import type { Rung } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { ResolvedRecordAccess } from './entity-access'
import { canDeleteRecordAtRung, canRecordVerbAtRung, hasDefPresence } from './entity-access'
import {
  deriveThreadRungFromRecordGrant,
  recordThreadDerivationCap,
} from './record-thread-derivation'
import {
  recordScopeArm,
  recordScopeArmFor,
  recordSearchVisibilitySql,
  recordUnionVisibilitySql,
  rungsAtOrAbove,
} from './record-visibility-scope'
import { PermissionKey } from './registry'
import { foldRecordAccess, RUNG_ORDER, rankToRung } from './rung'

const DEF = 'edf_deals'

/** A `CapabilityView`-shaped stub with only the two members the arm reads. */
const view = (defViewable: boolean, grantedDef: boolean) =>
  ({
    canViewEntity: () => defViewable,
    hasRecordGrantsOn: () => grantedDef,
  }) as never

/** A minimal `ResolvedRecordAccess` for the pure predicates. */
function caps(over: Partial<ResolvedRecordAccess> = {}): ResolvedRecordAccess {
  return {
    role: 'USER',
    seatType: 'full',
    keys: new Set(),
    defAccess: {},
    restrictedEntityDefIds: new Set(),
    ...over,
  }
}

describe('§5.1 — the four arms', () => {
  it('arm 1: def viewable and no restrictions ⇒ ALL (no predicate at all)', () => {
    expect(recordScopeArm({ defViewable: true, hasRestrictions: false, grantedDef: false })).toBe(
      'all'
    )
    // …and holding grants on a def you can already see does not change the arm:
    // paying for a predicate would buy nothing.
    expect(recordScopeArm({ defViewable: true, hasRestrictions: false, grantedDef: true })).toBe(
      'all'
    )
  })

  it('arm 2: def viewable WITH restrictions ⇒ the anti-join arm', () => {
    expect(recordScopeArm({ defViewable: true, hasRestrictions: true, grantedDef: false })).toBe(
      'restricted'
    )
  })

  it('arm 3: def NOT viewable but grants held ⇒ the grant-only lane', () => {
    expect(recordScopeArm({ defViewable: false, hasRestrictions: false, grantedDef: true })).toBe(
      'grant-only'
    )
  })

  it('arm 4: def NOT viewable and no grants ⇒ NONE (the caller must not query)', () => {
    expect(recordScopeArm({ defViewable: false, hasRestrictions: false, grantedDef: false })).toBe(
      'none'
    )
    // hasRestrictions is irrelevant once there is nothing to restrict.
    expect(recordScopeArm({ defViewable: false, hasRestrictions: true, grantedDef: false })).toBe(
      'none'
    )
  })
})

describe('recordScopeArmFor — the capability-view entry point', () => {
  it('undefined capabilities ⇒ ALL (internal caller, no enforcement)', () => {
    expect(recordScopeArmFor(undefined, DEF)).toBe('all')
  })

  it('maps the view onto the four arms', () => {
    expect(recordScopeArmFor(view(true, false), DEF)).toBe('all')
    expect(recordScopeArmFor(view(false, true), DEF)).toBe('grant-only')
    expect(recordScopeArmFor(view(false, false), DEF)).toBe('none')
    expect(recordScopeArmFor(view(true, false), DEF, true)).toBe('restricted')
  })
})

describe('rungsAtOrAbove — the threshold constants', () => {
  it('the read floor is exactly read/edit/admin', () => {
    expect(rungsAtOrAbove('read')).toEqual(['read', 'edit', 'admin'])
  })

  it('is derived from RUNG_ORDER, never hand-listed', () => {
    for (const rung of rungsAtOrAbove('metadata')) {
      expect(RUNG_ORDER[rung]).toBeGreaterThanOrEqual(RUNG_ORDER.metadata)
    }
    // ≤ 6 constants, always — the predicate can never grow with the data.
    expect(rungsAtOrAbove('none').length).toBeLessThanOrEqual(6)
  })
})

describe('§5.1 — the two multi-def search shapes', () => {
  // Only the ABSENT/PRESENT decision is asserted, not the built predicate: the
  // `schema` Proxy makes a rendered Drizzle condition vacuous here (see the file
  // header). The predicate's effect is covered end-to-end by
  // `resources/picker/global-union-record-grants.test.ts`.
  const grantees = { userId: 'user_1', groupIds: [], profileId: null } as never
  const columns = { instanceIdColumn: 'ei.id', defIdColumn: 'ei.def' }

  it('def-list arm: nothing reachable ⇒ null (the caller must not query)', () => {
    expect(
      recordSearchVisibilitySql({
        organizationId: 'org_1',
        grantees,
        fullyViewableDefIds: [],
        grantOnlyDefIds: [],
        ...columns,
      })
    ).toBeNull()
  })

  it('def-list arm: every def fully viewable ⇒ undefined (no narrowing, no cost)', () => {
    expect(
      recordSearchVisibilitySql({
        organizationId: 'org_1',
        grantees,
        fullyViewableDefIds: [DEF],
        grantOnlyDefIds: [],
        ...columns,
      })
    ).toBeUndefined()
  })

  it('def-list arm: a grant-only def in the list ⇒ a predicate', () => {
    expect(
      recordSearchVisibilitySql({
        organizationId: 'org_1',
        grantees,
        fullyViewableDefIds: [DEF],
        grantOnlyDefIds: ['edf_other'],
        ...columns,
      })
    ).toBeDefined()
  })

  it('union arm: no grant-only def ⇒ undefined — the common member pays NOTHING', () => {
    expect(
      recordUnionVisibilitySql({
        organizationId: 'org_1',
        grantees,
        grantOnlyDefIds: [],
        ...columns,
      })
    ).toBeUndefined()
  })

  it('union arm: a grant-only def ⇒ a predicate (additive, so no viewable list)', () => {
    expect(
      recordUnionVisibilitySql({
        organizationId: 'org_1',
        grantees,
        grantOnlyDefIds: [DEF],
        ...columns,
      })
    ).toBeDefined()
  })
})

describe('§5.2 — the `_access` fold', () => {
  it('takes the HIGHER of the def level and the row grant', () => {
    expect(foldRecordAccess('read', RUNG_ORDER.admin)).toBe('admin')
    expect(foldRecordAccess('edit', RUNG_ORDER.read)).toBe('edit')
  })

  it('a def-less member is stamped purely by their grant (the grant-only lane)', () => {
    expect(foldRecordAccess(undefined, RUNG_ORDER.edit)).toBe('edit')
  })

  it('no def level and no grant rows ⇒ `none`', () => {
    expect(foldRecordAccess(undefined, null)).toBe('none')
  })

  it('rankToRung fails closed on null and on an unknown rank', () => {
    expect(rankToRung(null)).toBe('none')
    expect(rankToRung(undefined)).toBe('none')
    expect(rankToRung(99)).toBe('none')
    expect(rankToRung(RUNG_ORDER.identity)).toBe('identity')
  })
})

describe('§5.3 — the row-effective verb gates, evaluated at the stamp', () => {
  const holder = caps({ keys: new Set([PermissionKey.recordsDelete]) })
  const nonHolder = caps()

  it('holds `recordsDelete` + row shared at `edit` ⇒ MAY delete', () => {
    expect(canDeleteRecordAtRung(holder, 'edit')).toBe(true)
  })

  it('no `recordsDelete` + row shared at `edit` ⇒ MAY NOT delete (collaboration, not destruction)', () => {
    expect(canDeleteRecordAtRung(nonHolder, 'edit')).toBe(false)
  })

  it('any member + row shared at `admin` ⇒ MAY delete', () => {
    expect(canDeleteRecordAtRung(nonHolder, 'admin')).toBe(true)
    expect(canDeleteRecordAtRung(holder, 'admin')).toBe(true)
  })

  it('the `edit` floor applies to BOTH branches — `read` never deletes', () => {
    for (const rung of ['none', 'metadata', 'identity', 'read'] as Rung[]) {
      expect(canDeleteRecordAtRung(holder, rung)).toBe(false)
      expect(canDeleteRecordAtRung(nonHolder, rung)).toBe(false)
    }
  })

  it('import rides the same rule (no separate vocabulary)', () => {
    const importer = caps({ keys: new Set([PermissionKey.recordsImport]) })
    expect(canRecordVerbAtRung(importer, 'edit', PermissionKey.recordsImport)).toBe(true)
    expect(canRecordVerbAtRung(nonHolder, 'edit', PermissionKey.recordsImport)).toBe(false)
    expect(canRecordVerbAtRung(nonHolder, 'admin', PermissionKey.recordsImport)).toBe(true)
  })
})

describe('§6.1 — hasDefPresence is a SECOND predicate', () => {
  it('is true when the def is viewable, with no grants at all', () => {
    // A member whose base records level reaches `view` sees every def.
    const viewer = caps({ keys: new Set([PermissionKey.recordsView]) })
    expect(hasDefPresence(viewer, DEF)).toBe(true)
  })

  it('is true for a grant-only def — the nav entry APPEARS with a grant', () => {
    const granted = caps({ grantedDefIds: { [DEF]: true } })
    expect(hasDefPresence(granted, DEF)).toBe(true)
  })

  it('is false with neither — the nav entry DISAPPEARS when the grant is revoked', () => {
    const granted = caps({ grantedDefIds: { [DEF]: true } })
    expect(hasDefPresence(granted, DEF)).toBe(true)
    // Revocation reaches the client as a recomposed blob with the def gone.
    const revoked = caps({ grantedDefIds: {} })
    expect(hasDefPresence(revoked, DEF)).toBe(false)
  })

  it('absent `grantedDefIds` closes the front door (fail-closed default)', () => {
    expect(hasDefPresence(caps(), DEF)).toBe(false)
  })

  it('a grant on ANOTHER def does not open this one', () => {
    expect(hasDefPresence(caps({ grantedDefIds: { edf_other: true } }), DEF)).toBe(false)
  })
})

describe('§13.1 — the cascade cap', () => {
  it('a ticket-like def derives thread `read`, never more', () => {
    expect(recordThreadDerivationCap('ticket')).toBe('read')
    expect(deriveThreadRungFromRecordGrant('admin', 'ticket')).toBe('read')
    expect(deriveThreadRungFromRecordGrant('edit', 'ticket')).toBe('read')
    expect(deriveThreadRungFromRecordGrant('read', 'ticket')).toBe('read')
  })

  it('a generic record def derives NOTHING, however strong the grant', () => {
    expect(recordThreadDerivationCap('deal')).toBe('none')
    expect(deriveThreadRungFromRecordGrant('admin', 'deal')).toBe('none')
    // …including a CUSTOM def, whose entityType is null.
    expect(deriveThreadRungFromRecordGrant('admin', null)).toBe('none')
  })

  it('the cap is a ceiling in both directions — a weak grant is not raised', () => {
    expect(deriveThreadRungFromRecordGrant('metadata', 'ticket')).toBe('metadata')
    expect(deriveThreadRungFromRecordGrant(undefined, 'ticket')).toBe('none')
  })
})
