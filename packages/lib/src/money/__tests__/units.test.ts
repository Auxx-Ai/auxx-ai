// packages/lib/src/money/__tests__/units.test.ts

import { describe, expect, it } from 'vitest'
import {
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemUnit,
  parseQuantityWithUnit,
} from '../units'

/** money plan 13 §1 canonical table — stored value, compact label, document label. */
const CANONICAL_UNITS: Array<[LineItemUnit, string, string]> = [
  ['each', 'ea', 'ea'],
  ['minute', 'min', 'min'],
  ['hour', 'hr', 'hr'],
  ['day', 'day', 'day'],
  ['week', 'wk', 'wk'],
  ['linear_foot', 'lf', 'lf'],
  ['square_foot', 'sf', 'sq ft'],
  ['cubic_foot', 'cf', 'cu ft'],
  ['cubic_yard', 'cy', 'cu yd'],
  ['gallon', 'gal', 'gal'],
  ['pound', 'lb', 'lb'],
  ['mile', 'mi', 'mi'],
  ['ton', 'ton', 'ton'],
  ['acre', 'ac', 'ac'],
]

/** money plan 13 §1 minimum-alias table — every alias must resolve to its stored unit. */
const MINIMUM_ALIASES: Array<[string, LineItemUnit]> = [
  ['ea', 'each'],
  ['each', 'each'],
  ['item', 'each'],
  ['piece', 'each'],
  ['pc', 'each'],
  ['min', 'minute'],
  ['mins', 'minute'],
  ['minute', 'minute'],
  ['minutes', 'minute'],
  ['h', 'hour'],
  ['hr', 'hour'],
  ['hrs', 'hour'],
  ['hour', 'hour'],
  ['hours', 'hour'],
  ['d', 'day'],
  ['day', 'day'],
  ['days', 'day'],
  ['wk', 'week'],
  ['wks', 'week'],
  ['week', 'week'],
  ['weeks', 'week'],
  ['lf', 'linear_foot'],
  ['lft', 'linear_foot'],
  ['ft', 'linear_foot'],
  ['foot', 'linear_foot'],
  ['feet', 'linear_foot'],
  ['linear foot', 'linear_foot'],
  ['linear feet', 'linear_foot'],
  ['sf', 'square_foot'],
  ['sqft', 'square_foot'],
  ['sq ft', 'square_foot'],
  ['square foot', 'square_foot'],
  ['square feet', 'square_foot'],
  ['cf', 'cubic_foot'],
  ['cuft', 'cubic_foot'],
  ['cu ft', 'cubic_foot'],
  ['cubic foot', 'cubic_foot'],
  ['cubic feet', 'cubic_foot'],
  ['cy', 'cubic_yard'],
  ['cuyd', 'cubic_yard'],
  ['cu yd', 'cubic_yard'],
  ['cubic yard', 'cubic_yard'],
  ['cubic yards', 'cubic_yard'],
  ['gal', 'gallon'],
  ['gals', 'gallon'],
  ['gallon', 'gallon'],
  ['gallons', 'gallon'],
  ['lb', 'pound'],
  ['lbs', 'pound'],
  ['pound', 'pound'],
  ['pounds', 'pound'],
  ['mi', 'mile'],
  ['mile', 'mile'],
  ['miles', 'mile'],
  ['t', 'ton'],
  ['ton', 'ton'],
  ['tons', 'ton'],
  ['ac', 'acre'],
  ['acre', 'acre'],
  ['acres', 'acre'],
]

describe('LINE_ITEM_UNIT_OPTIONS', () => {
  it('has one option per canonical unit, in table order, with no color', () => {
    expect(LINE_ITEM_UNIT_OPTIONS).toHaveLength(CANONICAL_UNITS.length)
    CANONICAL_UNITS.forEach(([value], index) => {
      expect(LINE_ITEM_UNIT_OPTIONS[index]).toEqual({
        label: expect.any(String),
        value,
      })
    })
  })
})

describe('formatLineItemUnit', () => {
  it.each(CANONICAL_UNITS)('formats %s compact as %s and document as %s', (unit, compact, doc) => {
    expect(formatLineItemUnit(unit, 'compact')).toBe(compact)
    expect(formatLineItemUnit(unit, 'document')).toBe(doc)
  })

  it('formats null/undefined as an empty string in both modes', () => {
    expect(formatLineItemUnit(null, 'compact')).toBe('')
    expect(formatLineItemUnit(undefined, 'compact')).toBe('')
    expect(formatLineItemUnit(null, 'document')).toBe('')
    expect(formatLineItemUnit(undefined, 'document')).toBe('')
  })
})

describe('parseQuantityWithUnit — number-only', () => {
  it('parses a bare integer and preserves the current unit', () => {
    expect(parseQuantityWithUnit('5', { quantity: 1, unit: 'hour' })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'hour',
    })
  })

  it('preserves a null current unit', () => {
    expect(parseQuantityWithUnit('5', { quantity: 1, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: null,
    })
  })

  it('parses a decimal quantity', () => {
    expect(parseQuantityWithUnit('1.5', { quantity: null, unit: 'hour' })).toEqual({
      ok: true,
      quantity: 1.5,
      unit: 'hour',
    })
  })

  it('parses a leading-dot decimal quantity', () => {
    expect(parseQuantityWithUnit('.5', { quantity: null, unit: 'hour' })).toEqual({
      ok: true,
      quantity: 0.5,
      unit: 'hour',
    })
  })

  it('parses a simple fraction', () => {
    expect(parseQuantityWithUnit('3/4', { quantity: null, unit: 'cubic_yard' })).toEqual({
      ok: true,
      quantity: 0.75,
      unit: 'cubic_yard',
    })
  })

  it('parses a mixed fraction', () => {
    expect(parseQuantityWithUnit('1 1/2', { quantity: null, unit: 'hour' })).toEqual({
      ok: true,
      quantity: 1.5,
      unit: 'hour',
    })
  })
})

describe('parseQuantityWithUnit — unit-only', () => {
  it('sets the unit and preserves the current quantity', () => {
    expect(parseQuantityWithUnit('hr', { quantity: 12, unit: null })).toEqual({
      ok: true,
      quantity: 12,
      unit: 'hour',
    })
  })

  it('preserves a null current quantity', () => {
    expect(parseQuantityWithUnit('hr', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: null,
      unit: 'hour',
    })
  })

  it('is case-insensitive and whitespace tolerant', () => {
    expect(parseQuantityWithUnit(' SQ FT ', { quantity: 5, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'square_foot',
    })
  })
})

describe('parseQuantityWithUnit — quantity + unit', () => {
  it.each([
    ['5sf', 5, 'square_foot'],
    ['5 SF', 5, 'square_foot'],
    ['5 sq ft', 5, 'square_foot'],
    ['2.375cy', 2.375, 'cubic_yard'],
    ['1.5hr', 1.5, 'hour'],
    ['1 1/2hr', 1.5, 'hour'],
    ['3/4 cy', 0.75, 'cubic_yard'],
    ['12 hr', 12, 'hour'],
    ['140lf', 140, 'linear_foot'],
    ['8.5 cy', 8.5, 'cubic_yard'],
  ] as const)('parses %s as quantity %s, unit %s', (input, quantity, unit) => {
    expect(parseQuantityWithUnit(input, { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity,
      unit,
    })
  })

  it.each(
    MINIMUM_ALIASES
  )('resolves alias "%s" to %s when suffixed to a quantity', (alias, unit) => {
    expect(parseQuantityWithUnit(`3${alias}`, { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 3,
      unit,
    })
    expect(parseQuantityWithUnit(`3 ${alias}`, { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 3,
      unit,
    })
    expect(
      parseQuantityWithUnit(`3 ${alias.toUpperCase()}`, { quantity: null, unit: null })
    ).toEqual({
      ok: true,
      quantity: 3,
      unit,
    })
  })

  it.each(
    MINIMUM_ALIASES
  )('resolves alias "%s" unit-only to %s, preserving quantity', (alias, unit) => {
    expect(parseQuantityWithUnit(alias, { quantity: 7, unit: null })).toEqual({
      ok: true,
      quantity: 7,
      unit,
    })
  })

  it('tolerates ordinary punctuation in multi-word aliases', () => {
    expect(parseQuantityWithUnit('5 sq.ft.', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'square_foot',
    })
    expect(parseQuantityWithUnit('5 cu-yd', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'cubic_yard',
    })
  })
})

describe('parseQuantityWithUnit — determinism and longest-alias-wins', () => {
  it('does not let a shorter overlapping alias win over the full suffix', () => {
    expect(parseQuantityWithUnit('5 sq ft', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'square_foot',
    })
    expect(parseQuantityWithUnit('5 sq ft', { quantity: null, unit: null })).not.toEqual(
      expect.objectContaining({ unit: 'linear_foot' })
    )
  })

  it('distinguishes ft (linear_foot) from sqft (square_foot) with no space', () => {
    expect(parseQuantityWithUnit('5ft', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'linear_foot',
    })
    expect(parseQuantityWithUnit('5sqft', { quantity: null, unit: null })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'square_foot',
    })
  })

  it('a recognized suffix always replaces the current unit', () => {
    expect(parseQuantityWithUnit('5 day', { quantity: null, unit: 'hour' })).toEqual({
      ok: true,
      quantity: 5,
      unit: 'day',
    })
  })

  it('parsing never converts units — changing the unit leaves quantity untouched', () => {
    const committed = parseQuantityWithUnit('5', { quantity: null, unit: null })
    expect(committed).toEqual({ ok: true, quantity: 5, unit: null })
    if (!committed.ok) throw new Error('expected ok result')

    const reUnit = parseQuantityWithUnit('day', {
      quantity: committed.quantity,
      unit: committed.unit,
    })
    expect(reUnit).toEqual({ ok: true, quantity: 5, unit: 'day' })
  })
})

describe('parseQuantityWithUnit — invalid input', () => {
  it('rejects empty input', () => {
    const result = parseQuantityWithUnit('', { quantity: 1, unit: 'hour' })
    expect(result.ok).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    const result = parseQuantityWithUnit('   ', { quantity: 1, unit: 'hour' })
    expect(result.ok).toBe(false)
  })

  it('rejects a zero-denominator simple fraction', () => {
    const result = parseQuantityWithUnit('3/0 cy', { quantity: null, unit: null })
    expect(result.ok).toBe(false)
  })

  it('rejects a zero-denominator mixed fraction', () => {
    const result = parseQuantityWithUnit('1 1/0 hr', { quantity: null, unit: null })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown unit suffix rather than keeping the numeric prefix', () => {
    const result = parseQuantityWithUnit('5xyz', { quantity: 1, unit: 'hour' })
    expect(result.ok).toBe(false)
  })

  it('rejects unit-only text that matches no alias', () => {
    const result = parseQuantityWithUnit('xyz', { quantity: 1, unit: 'hour' })
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed number with a stray extra decimal point', () => {
    const result = parseQuantityWithUnit('5.5.5hr', { quantity: null, unit: null })
    expect(result.ok).toBe(false)
  })

  it('rejects trailing garbage after a valid unit', () => {
    const result = parseQuantityWithUnit('5 sf extra', { quantity: null, unit: null })
    expect(result.ok).toBe(false)
  })

  it('does not persist either field on an invalid parse (returns error only)', () => {
    const result = parseQuantityWithUnit('5xyz', { quantity: 1, unit: 'hour' })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
  })
})
