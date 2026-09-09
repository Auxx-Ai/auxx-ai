// packages/lib/src/permissions/capabilities/entity-base-areas.test.ts

import { describe, expect, it } from 'vitest'
import {
  effectiveRecordLevel,
  levelToRecordBasePermission,
  type ResolvedRecordAccess,
} from './entity-access'
import { Area, areaLevelFromKeys, expandLevelsToKeys, Level } from './registry'
import { ENTITY_BASE_AREAS, ENTITY_WRITE_KEYS } from './seat-policy'

/**
 * Task 12 §4.1: `journal_entry`, `gl_account`, `bank_account`, `bank_transaction`,
 * `bank_deposit`, `bank_rule` and `payout` route through `Area.ledger` instead of
 * `Area.records`, and `stock_movement` deliberately stays out of both maps. These
 * tests pin `effectiveRecordLevel`'s behavior for a def with (and without) a base
 * override, and that the two maps stay aligned.
 */

/**
 * Mirrors `resolveCapabilityInputs`'s `defBaseOverrides` construction
 * (`resolve-capability-inputs.ts:98-109`) for a single def, without building
 * the `resources` projection that function normally reads.
 */
function buildCaps(
  levels: Partial<Record<Area, Level>>,
  defId: string,
  slug: string
): ResolvedRecordAccess {
  const keys = new Set(expandLevelsToKeys(levels))
  const area = ENTITY_BASE_AREAS[slug]
  const defBaseOverrides = area
    ? { [defId]: levelToRecordBasePermission(areaLevelFromKeys(keys, area)) ?? null }
    : {}
  return {
    role: 'USER',
    seatType: 'full',
    keys,
    defAccess: {},
    restrictedEntityDefIds: new Set(),
    defBaseOverrides,
  }
}

describe('journal_entry resolves through Area.ledger, not Area.records', () => {
  it('is undefined for records: Full, ledger: None (the door this closes)', () => {
    const caps = buildCaps(
      { [Area.records]: Level.Full, [Area.ledger]: Level.None },
      'je-def',
      'journal_entry'
    )
    expect(effectiveRecordLevel(caps, 'je-def')).toBeUndefined()
  })

  it("is 'view' for records: None, ledger: Read", () => {
    const caps = buildCaps(
      { [Area.records]: Level.None, [Area.ledger]: Level.Read },
      'je-def',
      'journal_entry'
    )
    expect(effectiveRecordLevel(caps, 'je-def')).toBe('view')
  })

  it("is 'edit', never 'admin', for ledger: Full", () => {
    // Pins levelToRecordBasePermission's cap: Level.Full maps to `edit`, never
    // `admin`: managing the ledger's records does not confer definition
    // administration.
    const caps = buildCaps(
      { [Area.records]: Level.None, [Area.ledger]: Level.Full },
      'je-def',
      'journal_entry'
    )
    expect(effectiveRecordLevel(caps, 'je-def')).toBe('edit')
  })
})

describe('stock_movement stays on Area.records (deliberate §4.1 exclusion)', () => {
  it('is absent from both ENTITY_BASE_AREAS and ENTITY_WRITE_KEYS', () => {
    expect(ENTITY_BASE_AREAS.stock_movement).toBeUndefined()
    expect(ENTITY_WRITE_KEYS.stock_movement).toBeUndefined()
  })

  it('still resolves through the Records area, unaffected by ledger', () => {
    const caps = buildCaps(
      { [Area.records]: Level.Edit, [Area.ledger]: Level.None },
      'sm-def',
      'stock_movement'
    )
    expect(effectiveRecordLevel(caps, 'sm-def')).toBe('edit')
  })
})

describe('ENTITY_BASE_AREAS / ENTITY_WRITE_KEYS stay aligned', () => {
  it('carry identical key sets', () => {
    expect(Object.keys(ENTITY_BASE_AREAS).sort()).toEqual(Object.keys(ENTITY_WRITE_KEYS).sort())
  })
})
