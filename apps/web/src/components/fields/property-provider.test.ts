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
