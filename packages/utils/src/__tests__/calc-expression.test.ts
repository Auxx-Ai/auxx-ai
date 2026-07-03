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
