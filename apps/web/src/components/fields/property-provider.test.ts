// apps/web/src/components/fields/property-provider.test.ts

import { describe, expect, it } from 'vitest'
import { hasValueChanged, isOrderSensitive } from './property-provider'

/**
 * Regression guard for the silently-dropped "set as primary" write.
 *
 * `commitValue` skips the mutation entirely when `hasValueChanged` says nothing
 * changed. That comparison sorted both arrays before diffing, which is right for
 * MULTI_SELECT/TAGS (an unordered set) but wrong for `options.multi` scalars,
 * where index 0 IS the primary — the address outbound mail/SMS actually uses.
 *
 * The user-visible bug: set-as-primary reordered the picker, then the reorder
 * was discarded — no request, no DB write, order reverted on reload. Adding and
 * removing values worked, because those change the array LENGTH. Found in
 * browser verification of the multi-phone flip; it affected live multi-email too.
 */
describe('hasValueChanged — order sensitivity', () => {
  const a = 'a@x.com'
  const b = 'b@x.com'

  it('treats a pure reorder as CHANGED when order-sensitive', () => {
    expect(hasValueChanged([b, a], [a, b], true)).toBe(true)
  })

  it('treats a pure reorder as unchanged when order-insensitive (sets)', () => {
    expect(hasValueChanged([b, a], [a, b], false)).toBe(false)
  })

  it('defaults to order-insensitive so set-valued fields keep their behavior', () => {
    expect(hasValueChanged([b, a], [a, b])).toBe(false)
  })

  it('still reports no change for an identical ordered list', () => {
    expect(hasValueChanged([a, b], [a, b], true)).toBe(false)
  })

  it('detects add and remove under both modes (length differs)', () => {
    for (const ordered of [true, false]) {
      expect(hasValueChanged([a, b], [a], ordered)).toBe(true)
      expect(hasValueChanged([a], [a, b], ordered)).toBe(true)
    }
  })

  it('handles empty and null consistently under both modes', () => {
    for (const ordered of [true, false]) {
      expect(hasValueChanged([], [], ordered)).toBe(false)
      expect(hasValueChanged(null, null, ordered)).toBe(false)
      expect(hasValueChanged([a], null, ordered)).toBe(true)
      expect(hasValueChanged(null, [a], ordered)).toBe(true)
    }
  })

  it('leaves non-array comparisons untouched by the flag', () => {
    expect(hasValueChanged('x', 'x', true)).toBe(false)
    expect(hasValueChanged('x', 'y', true)).toBe(true)
    expect(hasValueChanged({ a: 1 }, { a: 1 }, true)).toBe(false)
  })
})

describe('isOrderSensitive', () => {
  it('is true only for options.multi scalar fields', () => {
    expect(isOrderSensitive({ options: { multi: true } })).toBe(true)
  })

  it('is false for set-valued and plain fields', () => {
    // MULTI_SELECT/TAGS/RELATIONSHIP arrays carry no meaningful order.
    expect(isOrderSensitive({ options: { multiple: true } })).toBe(false)
    expect(isOrderSensitive({ options: {} })).toBe(false)
    expect(isOrderSensitive({})).toBe(false)
    expect(isOrderSensitive(undefined)).toBe(false)
  })

  it('does not treat a truthy non-true multi as order-sensitive', () => {
    expect(isOrderSensitive({ options: { multi: 'yes' } })).toBe(false)
  })
})

/**
 * Regression guard for the currency write storm.
 *
 * `input-currency` calls `setValue` on EVERY blur, edited or not, and the table's
 * inline editor force-blurs on outside click. That is harmless only while the
 * comparator can tell "same value" from "different value". It could not, for one
 * turn of this branch: `toRawValue` returned `{ code?, amount }` while the input
 * committed a bare number, so both sides fell through to the `String(...)`
 * branch and `"20000" !== "[object Object]"` was true forever. Every currency
 * field committed on every blur, and the store re-extracted the object right
 * back, so it never converged.
 *
 * The shape is symmetric again, and `normalizeByFieldType` collapses the
 * asymmetric types generically — ACTOR is the one that is still asymmetric by
 * design, so it is pinned here too.
 */
describe('hasValueChanged — read/write-asymmetric field types', () => {
  it('CURRENCY: the same minor-unit amount is not a change', () => {
    expect(hasValueChanged(20_000, 20_000, false, 'CURRENCY')).toBe(false)
  })

  it('CURRENCY: a legacy { amount } object compares equal to the bare number', () => {
    expect(hasValueChanged(20_000, { amount: 20_000 }, false, 'CURRENCY')).toBe(false)
    expect(hasValueChanged({ amount: 20_000 }, 20_000, false, 'CURRENCY')).toBe(false)
  })

  it('CURRENCY: a genuinely different amount still reports changed', () => {
    expect(hasValueChanged(20_001, 20_000, false, 'CURRENCY')).toBe(true)
    expect(hasValueChanged(null, 20_000, false, 'CURRENCY')).toBe(true)
  })

  it('ACTOR: the rich read object compares equal to the committed ActorId', () => {
    const server = { actorType: 'user', id: 'abc', actorId: 'user:abc' }
    expect(hasValueChanged('user:abc', server, false, 'ACTOR')).toBe(false)
    expect(hasValueChanged('user:xyz', server, false, 'ACTOR')).toBe(true)
  })

  it('ACTOR: derives the ActorId when the read object carries none', () => {
    expect(hasValueChanged('group:g1', { actorType: 'group', id: 'g1' }, false, 'ACTOR')).toBe(
      false
    )
  })

  it('NAME: symmetric already — the plain-object branch answers it', () => {
    const name = { firstName: 'Ada', lastName: 'Lovelace' }
    expect(hasValueChanged({ ...name }, name, false, 'NAME')).toBe(false)
    expect(hasValueChanged({ ...name, lastName: 'Byron' }, name, false, 'NAME')).toBe(true)
  })
})
