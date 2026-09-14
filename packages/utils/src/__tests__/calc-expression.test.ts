// packages/utils/src/__tests__/calc-expression.test.ts

import { describe, expect, it } from 'vitest'
import { evaluateCalcExpression, validateCalcExpression } from '../calc-expression'

/** Evaluate against an empty field map (literal-only expressions). */
const evalExpr = (expr: string, fields: Record<string, unknown> = {}) =>
  evaluateCalcExpression(expr, fields)

describe('comparison functions', () => {
  describe('eq', () => {
    it('matches equal string literals (case-sensitive)', () => {
      expect(evalExpr("eq('a', 'a')")).toBe(true)
      expect(evalExpr("eq('a', 'A')")).toBe(false)
    })

    it('compares numerically when both sides are numeric', () => {
      expect(evalExpr("eq(2, '2')")).toBe(true)
      expect(evalExpr('eq(2, 3)')).toBe(false)
    })

    it('treats null/undefined/missing field as empty string', () => {
      // {missing} resolves to undefined → normalized to ''
      expect(evalExpr("eq({missing}, '')")).toBe(true)
      expect(evalExpr('eq({missing}, {alsoMissing})')).toBe(true)
    })

    it('reads field values', () => {
      expect(evalExpr("eq({opt}, 'Default Title')", { opt: 'Default Title' })).toBe(true)
      expect(evalExpr("eq({opt}, 'Default Title')", { opt: 'Red' })).toBe(false)
    })
  })

  describe('ne', () => {
    it('is the negation of eq', () => {
      expect(evalExpr("ne('a', 'b')")).toBe(true)
      expect(evalExpr("ne('a', 'a')")).toBe(false)
      expect(evalExpr("ne(2, '2')")).toBe(false)
    })
  })

  describe('gt/gte/lt/lte', () => {
    it('compares numbers', () => {
      expect(evalExpr('gt(3, 2)')).toBe(true)
      expect(evalExpr('gt(2, 3)')).toBe(false)
      expect(evalExpr('gte(2, 2)')).toBe(true)
      expect(evalExpr('lt(1, 2)')).toBe(true)
      expect(evalExpr('lte(2, 2)')).toBe(true)
    })

    it('coerces numeric strings', () => {
      expect(evalExpr("gt('3', '2')")).toBe(true)
    })

    it('returns null when either side is non-numeric', () => {
      expect(evalExpr("gt('abc', 2)")).toBe(null)
      expect(evalExpr("lt(2, 'xyz')")).toBe(null)
      expect(evalExpr("gte('foo', 'bar')")).toBe(null)
    })
  })
})

describe('logic functions', () => {
  it('and is true only when all args are truthy', () => {
    expect(evalExpr('and(true, true)')).toBe(true)
    expect(evalExpr('and(true, false)')).toBe(false)
    expect(evalExpr('and(1, 1, 1)')).toBe(true)
    expect(evalExpr('and(1, 0)')).toBe(false)
  })

  it('or is true when any arg is truthy', () => {
    expect(evalExpr('or(false, true)')).toBe(true)
    expect(evalExpr('or(false, false)')).toBe(false)
    expect(evalExpr('or(0, 0, 1)')).toBe(true)
  })

  it('not negates truthiness', () => {
    expect(evalExpr('not(true)')).toBe(false)
    expect(evalExpr('not(false)')).toBe(true)
    expect(evalExpr("not('')")).toBe(true)
  })

  describe('isEmpty', () => {
    it('is true for null/undefined/empty/whitespace', () => {
      expect(evalExpr('isEmpty({missing})')).toBe(true)
      expect(evalExpr("isEmpty('')")).toBe(true)
      expect(evalExpr("isEmpty('   ')")).toBe(true)
      expect(evalExpr('isEmpty({blank})', { blank: '  \t ' })).toBe(true)
    })

    it('is false for non-empty values including 0', () => {
      expect(evalExpr("isEmpty('x')")).toBe(false)
      expect(evalExpr('isEmpty(0)')).toBe(false)
      expect(evalExpr('isEmpty({v})', { v: 'hello' })).toBe(false)
    })
  })
})

describe('joinNonEmpty', () => {
  it('joins non-empty values with the separator', () => {
    expect(evalExpr("joinNonEmpty(' / ', 'Grey', 'M', '43')")).toBe('Grey / M / 43')
  })

  it('skips blanks in head, middle, and tail positions', () => {
    expect(evalExpr("joinNonEmpty(' / ', {missing}, 'M', '43')", {})).toBe('M / 43')
    expect(evalExpr("joinNonEmpty(' / ', 'Grey', {missing}, '43')", {})).toBe('Grey / 43')
    expect(evalExpr("joinNonEmpty(' / ', 'Grey', 'M', {missing})", {})).toBe('Grey / M')
  })

  it('skips whitespace-only values', () => {
    expect(evalExpr("joinNonEmpty(' / ', 'Grey', '   ', '43')")).toBe('Grey / 43')
  })

  it('stringifies numeric values including 0', () => {
    expect(evalExpr("joinNonEmpty('-', 0, 1, 2)")).toBe('0-1-2')
  })
})

describe('nesting / composition', () => {
  it('evaluates the canonical variant-title formula', () => {
    const formula =
      "if(eq({Option 1}, 'Default Title'), " +
      '{Product Title}, ' +
      "concat({Product Title}, ' - ', joinNonEmpty(' / ', {Option 1}, {Option 2}, {Option 3})))"

    // Default Title → just the product title
    expect(
      evalExpr(formula, {
        'Option 1': 'Default Title',
        'Product Title': 'Cool Shirt',
      })
    ).toBe('Cool Shirt')

    // Real variant → title + joined options, blank middle skipped
    expect(
      evalExpr(formula, {
        'Option 1': 'Grey',
        'Option 2': '',
        'Option 3': '43',
        'Product Title': 'Cool Shirt',
      })
    ).toBe('Cool Shirt - Grey / 43')
  })
})

describe('regression: existing functions untouched', () => {
  it('if tests raw truthiness', () => {
    expect(evalExpr("if({flag}, 'yes', 'no')", { flag: true })).toBe('yes')
    expect(evalExpr("if({flag}, 'yes', 'no')", { flag: '' })).toBe('no')
    expect(evalExpr("if({flag}, 'yes', 'no')", { flag: 0 })).toBe('no')
  })

  it('coalesce skips null and empty string', () => {
    expect(evalExpr('coalesce({a}, {b})', { a: null, b: 'fallback' })).toBe('fallback')
    expect(evalExpr('coalesce({a}, {b})', { a: '', b: 'fallback' })).toBe('fallback')
    expect(evalExpr('coalesce({a}, {b})', { a: 'first', b: 'fallback' })).toBe('first')
  })
})

describe('field reference extraction', () => {
  it('passes a plain object through as the value (ADDRESS_STRUCT, raw JSON)', () => {
    // The defect: an address struct is an object with no TypedFieldValue `type`
    // discriminant and no `value` box, so it took the `default:` branch and
    // evaluated to null — every connector-mapped ADDRESS_STRUCT / JSON source
    // value was silently discarded before it ever reached a write.
    const address = {
      street1: '123 Main St',
      street2: null,
      city: 'Austin',
      state: 'Texas',
      zipCode: '78701',
      country: 'United States',
    }
    expect(evalExpr('{shippingAddress}', { shippingAddress: address })).toEqual(address)

    const raw = { shippingLines: [{ title: 'Standard' }], discountApplications: [] }
    expect(evalExpr('{raw}', { raw })).toEqual(raw)

    // An empty object is still an object, not a null.
    expect(evalExpr('{a}', { a: {} })).toEqual({})
  })

  it('still resolves a TypedFieldValue via its type discriminant', () => {
    expect(evalExpr('{a}', { a: { type: 'text', value: 'hello' } })).toBe('hello')
    expect(evalExpr('{a}', { a: { type: 'number', value: 42 } })).toBe(42)
    expect(evalExpr('{a}', { a: { type: 'boolean', value: false } })).toBe(false)
    expect(evalExpr('{a}', { a: { type: 'date', value: '2026-09-13T00:00:00.000Z' } })).toBe(
      '2026-09-13T00:00:00.000Z'
    )
    expect(evalExpr('{a}', { a: { type: 'option', optionId: 'o1', label: 'Red' } })).toBe('Red')
    expect(evalExpr('{a}', { a: { type: 'json', value: { k: 'v' } } })).toEqual({ k: 'v' })
    expect(
      evalExpr('{a}', { a: { type: 'relationship', recordId: 'd:i', displayName: 'Acme' } })
    ).toBe('Acme')
  })

  it('still unwraps a bare `{ value }` box', () => {
    expect(evalExpr('{a}', { a: { value: 42 } })).toBe(42)
    expect(evalExpr('{a}', { a: { value: null } })).toBe(null)
  })

  it('leaves a TypedFieldValue with an unhandled discriminant unreadable (null)', () => {
    // `actor` has no `value` key and no case in the switch. It read as null before
    // the plain-object passthrough and must keep reading as null, or a CALC
    // sourcing an ACTOR field would start stringifying the whole row.
    expect(
      evalExpr('{a}', { a: { type: 'actor', actorType: 'user', id: 'u1', actorId: 'user:u1' } })
    ).toBe(null)
  })

  it('leaves array-shaped and non-plain-object values as null', () => {
    // Multi-value sourcing is out of scope (data-connectors B1): `map-record`'s
    // no-write guard is written against arrays flattening to null here.
    expect(evalExpr('{a}', { a: ['x', 'y'] })).toBe(null)
    expect(evalExpr('{a}', { a: [] })).toBe(null)
    expect(evalExpr('{a}', { a: new Date('2026-09-13T00:00:00.000Z') })).toBe(null)
  })

  it('leaves null, undefined and scalars unchanged', () => {
    expect(evalExpr('{a}', { a: null })).toBe(null)
    expect(evalExpr('{a}', { a: undefined })).toBe(undefined)
    expect(evalExpr('{missing}', {})).toBe(undefined)
    expect(evalExpr('{a}', { a: 'plain' })).toBe('plain')
    expect(evalExpr('{a}', { a: 0 })).toBe(0)
    expect(evalExpr('{a}', { a: false })).toBe(false)
  })
})

describe('validateCalcExpression', () => {
  it('accepts the new function names', () => {
    for (const expr of [
      "eq({a}, 'x')",
      'ne({a}, {b})',
      'gt({a}, 1)',
      'gte({a}, 1)',
      'lt({a}, 1)',
      'lte({a}, 1)',
      'and({a}, {b})',
      'or({a}, {b})',
      'not({a})',
      'isEmpty({a})',
      "joinNonEmpty(' / ', {a}, {b})",
    ]) {
      const result = validateCalcExpression(expr)
      expect(result.isValid, `expected ${expr} to be valid`).toBe(true)
    }
  })

  it('extracts source fields from nested calls', () => {
    const result = validateCalcExpression(
      "if(eq({Option 1}, 'Default Title'), {Product Title}, {Option 2})"
    )
    expect(result.isValid).toBe(true)
    expect(result.extractedFields.sort()).toEqual(['Option 1', 'Option 2', 'Product Title'])
  })

  it('still rejects unknown functions', () => {
    const result = validateCalcExpression('bogus({a}, {b})')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Unknown function')
  })
})
