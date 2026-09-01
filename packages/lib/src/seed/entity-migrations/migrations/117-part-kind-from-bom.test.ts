// packages/lib/src/seed/entity-migrations/migrations/117-part-kind-from-bom.test.ts
//
// Migration 117 is a backfill of the rule `field-hooks/post/part-kind-derivation.ts`
// applies at write time, so what can silently go wrong is a divergence between
// the two: a part promoted when its BOM was entered and a part promoted here
// must be promoted by the SAME rule, or the field means one thing on old data
// and another on new.
//
// It pins that (the migration calls the rule's own function), the ordering
// constraint against 116, and every case of the promotion rule itself — the one
// piece of logic that decides whether a stored value is touched.

import { describe, expect, it } from 'vitest'
import { resolvePartKindPromotion } from '../../../field-hooks/post/part-kind-derivation'
import { PartKind } from '../../../resources/registry/enum-values'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration117PartKindFromBom } from './117-part-kind-from-bom'

describe('migration 117 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '117-part-kind-from-bom')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration117PartKindFromBom.id).toBe('117-part-kind-from-bom')
  })

  // 🛑 The promotion turns on `absorbsConversionCost` for every part it touches,
  // which changes those parts' standard cost at the next roll. 116 is what
  // decides WHICH rate they absorb, so this must not run first or it changes the
  // inputs 116's per-part overrides resolve against.
  it('sorts after 116, which decides what a promoted part absorbs', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf('117-part-kind-from-bom')).toBeGreaterThan(
      ids.indexOf('116-per-part-absorption')
    )
  })
})

describe('resolvePartKindPromotion — the whole of the rule', () => {
  // The default that made a stored `component` meaningless: `part-fields.ts`
  // ships `defaultValue: COMPONENT` and `applyDefaults` stamps it on import,
  // API, connectors and seed. Both of these read as "nobody classified this".
  it('promotes an unset kind', () => {
    expect(resolvePartKindPromotion(null)).toBe('promote')
    expect(resolvePartKindPromotion(undefined)).toBe('promote')
    expect(resolvePartKindPromotion('')).toBe('promote')
  })

  it('promotes a stored component', () => {
    expect(resolvePartKindPromotion(PartKind.COMPONENT)).toBe('promote')
  })

  // 🛑 Decision 1: this fills an unclassified part in, it does not adjudicate a
  // classified one. Overwriting `finished_good` is the move with a ledger
  // consequence — it is the only kind that maps to INVENTORY_FINISHED_GOODS, and
  // `complete-build.ts` stamps the produce row from it on every completion.
  it('leaves a part somebody classified as built', () => {
    expect(resolvePartKindPromotion(PartKind.SUBASSEMBLY)).toBe('leave')
    expect(resolvePartKindPromotion(PartKind.FINISHED_GOOD)).toBe('leave')
  })

  // Decision 3's escape hatch works only if an unrecognised value is left alone
  // too — an org that added a fourth kind owns it, exactly as `resolvePartKind`
  // assumes.
  it('leaves a value this codebase does not recognise', () => {
    expect(resolvePartKindPromotion('kit')).toBe('leave')
  })
})

describe('the promotion never reaches finished_good', () => {
  // 🛑 The tempting version is the full two-predicate derivation — *has a BOM
  // and is nobody's subpart => finished good* — and it does not work, because
  // the second predicate is unstable at write time. People build bottom-up, so
  // a subassembly is nobody's subpart at the instant it gets its own BOM; the
  // rule would stamp `finished_good` and then need to DEMOTE it, which silently
  // moves where the part posts from that point on.
  //
  // The rule has one output and this is the test that says so.
  it('has exactly two dispositions, neither of which is finished_good', () => {
    const outcomes = new Set(
      [null, '', PartKind.COMPONENT, PartKind.SUBASSEMBLY, PartKind.FINISHED_GOOD, 'kit'].map(
        (stored) => resolvePartKindPromotion(stored)
      )
    )
    expect([...outcomes].sort()).toEqual(['leave', 'promote'])
  })
})
