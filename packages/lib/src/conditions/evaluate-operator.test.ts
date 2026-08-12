// packages/lib/src/conditions/evaluate-operator.test.ts

import { describe, expect, it } from 'vitest'
import { evaluateOperator, isEmptyValue, isKnownOperator, looseEquals } from './evaluate-operator'
import { ALL_OPERATOR_KEYS } from './operator-definitions'

// ═══════════════════════════════════════════════════════════════════════════
// THE unified operator table.
//
// One implementation now backs three surfaces (mail/record-rule filters via
// `evaluate.ts`, the workflow if-else node, the list node's filter), so this is the
// only place the meaning of `is` / `contains` / `empty` is pinned down.
//
// Each row states an input that MUST match and one that MUST NOT, and the table is
// asserted to be exhaustive against `ALL_OPERATOR_KEYS` — a new registry operator
// fails this suite until someone says what it means.
// ═══════════════════════════════════════════════════════════════════════════

const MB = 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

function createFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    fileId: 'file-1',
    assetId: 'asset-1',
    versionId: 'version-1',
    filename: 'notes.txt',
    mimeType: 'text/plain',
    size: 1024,
    url: 'https://example.com/notes.txt',
    nodeId: 'upload-1',
    uploadedAt: new Date(),
    ...overrides,
  }
}

type OperatorCase = {
  operator: string
  matching: unknown
  notMatching: unknown
  compareValue?: unknown
}

const OPERATOR_CASES: OperatorCase[] = [
  // EQUALITY — case-insensitive
  { operator: 'is', matching: 'Open', notMatching: 'Closed', compareValue: 'open' },
  { operator: 'is not', matching: 'Closed', notMatching: 'Open', compareValue: 'Open' },

  // COMPARISON
  { operator: '>', matching: 10, notMatching: 3, compareValue: 5 },
  { operator: '<', matching: 3, notMatching: 10, compareValue: 5 },
  { operator: '>=', matching: 5, notMatching: 4, compareValue: 5 },
  { operator: '<=', matching: 5, notMatching: 6, compareValue: 5 },

  // STRING — case-insensitive
  {
    operator: 'contains',
    matching: 'Urgent request',
    notMatching: 'all good',
    compareValue: 'URGENT',
  },
  {
    operator: 'not contains',
    matching: 'all good',
    notMatching: 'urgent now',
    compareValue: 'urgent',
  },
  {
    operator: 'starts with',
    matching: 'Refund me',
    notMatching: 'a refund',
    compareValue: 'refund',
  },
  {
    operator: 'ends with',
    matching: 'please refund',
    notMatching: 'refund please',
    compareValue: 'refund',
  },

  // SET
  { operator: 'in', matching: 'high', notMatching: 'low', compareValue: ['HIGH', 'medium'] },
  { operator: 'not in', matching: 'low', notMatching: 'high', compareValue: ['high', 'medium'] },

  // EXISTENCE
  { operator: 'empty', matching: '', notMatching: 'something' },
  { operator: 'not empty', matching: 'something', notMatching: '' },

  // DATE
  {
    operator: 'before',
    matching: new Date(2020, 0, 1),
    notMatching: new Date(2030, 0, 1),
    compareValue: new Date(2025, 0, 1),
  },
  {
    operator: 'after',
    matching: new Date(2030, 0, 1),
    notMatching: new Date(2020, 0, 1),
    compareValue: new Date(2025, 0, 1),
  },
  {
    operator: 'on_date',
    matching: new Date(2025, 5, 15, 9),
    notMatching: new Date(2025, 5, 16, 9),
    compareValue: new Date(2025, 5, 15, 18),
  },
  {
    operator: 'not_on_date',
    matching: new Date(2025, 5, 16, 9),
    notMatching: new Date(2025, 5, 15, 9),
    compareValue: new Date(2025, 5, 15, 18),
  },
  { operator: 'within_days', matching: daysAgo(2), notMatching: daysAgo(30), compareValue: 7 },
  { operator: 'older_than_days', matching: daysAgo(30), notMatching: daysAgo(1), compareValue: 7 },
  { operator: 'today', matching: new Date(), notMatching: daysAgo(3) },
  { operator: 'yesterday', matching: daysAgo(1), notMatching: new Date() },
  { operator: 'this_week', matching: new Date(), notMatching: daysAgo(60) },
  { operator: 'this_month', matching: new Date(), notMatching: daysAgo(60) },

  // ARRAY
  { operator: 'length =', matching: [1, 2], notMatching: [1], compareValue: 2 },
  { operator: 'length >', matching: [1, 2, 3], notMatching: [1], compareValue: 2 },
  { operator: 'length <', matching: [1], notMatching: [1, 2, 3], compareValue: 2 },
  { operator: 'length >=', matching: [1, 2], notMatching: [1], compareValue: 2 },
  { operator: 'length <=', matching: [1], notMatching: [1, 2, 3], compareValue: 1 },

  // OBJECT
  {
    operator: 'has key',
    matching: { sku: 'A1' },
    notMatching: { name: 'A1' },
    compareValue: 'sku',
  },
  {
    operator: 'key equals',
    matching: { status: 'open' },
    notMatching: { status: 'closed' },
    compareValue: 'status:open',
  },

  // FILE
  { operator: 'is_valid', matching: createFile(), notMatching: createFile({ filename: '  ' }) },
  { operator: 'is_invalid', matching: createFile({ filename: '  ' }), notMatching: createFile() },
  {
    operator: 'uploaded_today',
    matching: createFile(),
    notMatching: createFile({ uploadedAt: daysAgo(5) }),
  },
  {
    operator: 'uploaded_within_days',
    matching: createFile({ uploadedAt: daysAgo(2) }),
    notMatching: createFile({ uploadedAt: daysAgo(40) }),
    compareValue: 7,
  },
  {
    operator: 'matches_pattern',
    matching: createFile({ filename: 'invoice-903.pdf' }),
    notMatching: createFile({ filename: 'notes.txt' }),
    compareValue: '^invoice',
  },
  {
    operator: 'contains_numbers',
    matching: createFile({ filename: 'report7.pdf' }),
    notMatching: createFile({ filename: 'report.pdf' }),
  },
  {
    operator: 'contains_date',
    matching: createFile({ filename: 'report-2024-01-02.pdf' }),
    notMatching: createFile({ filename: 'report.pdf' }),
  },
  {
    operator: 'has_version',
    matching: createFile({ filename: 'app-v2.zip' }),
    notMatching: createFile({ filename: 'app.zip' }),
  },
  {
    operator: 'is_office_document',
    matching: createFile({ filename: 'contract.docx' }),
    notMatching: createFile({ filename: 'contract.txt' }),
  },
  {
    operator: 'is_image_format',
    matching: createFile({ filename: 'logo.png' }),
    notMatching: createFile({ filename: 'logo.txt' }),
  },
  {
    operator: 'is_text_format',
    matching: createFile({ filename: 'notes.txt' }),
    notMatching: createFile({ filename: 'notes.png' }),
  },
  {
    operator: 'is_compressed',
    matching: createFile({ filename: 'bundle.zip' }),
    notMatching: createFile({ filename: 'bundle.txt' }),
  },
  {
    operator: 'is_executable',
    matching: createFile({ filename: 'installer.exe' }),
    notMatching: createFile({ filename: 'installer.txt' }),
  },
  {
    operator: 'within_size_limit',
    matching: createFile({ size: 1 * MB }),
    notMatching: createFile({ size: 20 * MB }),
    compareValue: 5,
  },
  {
    operator: 'exceeds_limit',
    matching: createFile({ size: 20 * MB }),
    notMatching: createFile({ size: 1 * MB }),
    compareValue: 5,
  },
]

/**
 * Mail-search scope pseudo-operators. They are in the registry but describe a mailbox
 * scope rather than a value, so nothing can make them true.
 */
const SCOPE_OPERATORS = ['this_mailbox', 'everywhere']

describe('evaluateOperator', () => {
  it('handles every operator the registry defines', () => {
    const covered = new Set([...OPERATOR_CASES.map((c) => c.operator), ...SCOPE_OPERATORS])
    expect(ALL_OPERATOR_KEYS.filter((key) => !covered.has(key))).toEqual([])
  })

  it.each(
    OPERATOR_CASES.map((c) => [c.operator, c] as const)
  )('"%s" is true for a matching value and false for a non-matching one', (_operator, testCase) => {
    expect(evaluateOperator(testCase.matching, testCase.operator, testCase.compareValue)).toBe(true)
    expect(evaluateOperator(testCase.notMatching, testCase.operator, testCase.compareValue)).toBe(
      false
    )
  })

  it.each(SCOPE_OPERATORS)('scope operator "%s" is never true', (operator) => {
    expect(evaluateOperator('anything', operator, 'anything')).toBe(false)
  })

  describe('unknown operators fail closed', () => {
    // 🔴 The regression this whole unification exists for. `conditions/evaluate.ts`
    // used to `return true` here, so a retired or typo'd operator matched EVERY
    // record — and a mail filter whose conditions all did that reduced to the bare
    // org scope.
    it.each([
      'equals',
      'greater_than',
      'is_empty',
      'not_contains',
      '',
      'nonsense',
    ])('"%s" is false, not true', (operator) => {
      expect(evaluateOperator('anything', operator, 'anything')).toBe(false)
    })

    it('reports which operators the registry knows', () => {
      expect(isKnownOperator('is')).toBe(true)
      expect(isKnownOperator('length >=')).toBe(true)
      expect(isKnownOperator('equals')).toBe(false)
    })
  })

  describe('array values fan out', () => {
    it('matches when ANY element satisfies a positive operator', () => {
      expect(evaluateOperator(['vip', 'refund'], 'is', 'refund')).toBe(true)
      expect(evaluateOperator(['vip', 'newsletter'], 'is', 'refund')).toBe(false)
    })

    it('requires EVERY element to satisfy a negated operator', () => {
      expect(evaluateOperator(['vip', 'newsletter'], 'is not', 'refund')).toBe(true)
      expect(evaluateOperator(['vip', 'refund'], 'is not', 'refund')).toBe(false)
    })

    it('asks array-category operators about the array itself', () => {
      expect(evaluateOperator([1, 2, 3], 'length >', 2)).toBe(true)
      expect(evaluateOperator([1, 2, 3], 'length >', 5)).toBe(false)
    })

    it('asks existence operators about the array itself', () => {
      expect(evaluateOperator([], 'empty', undefined)).toBe(true)
      expect(evaluateOperator(['x'], 'empty', undefined)).toBe(false)
      expect(evaluateOperator(['x'], 'not empty', undefined)).toBe(true)
    })
  })

  describe('string comparison is case-insensitive everywhere', () => {
    it.each([
      ['is', 'SHIPPED', 'shipped'],
      ['contains', 'Order SHIPPED today', 'shipped'],
      ['starts with', 'SHIPPED today', 'shipped'],
      ['ends with', 'order SHIPPED', 'shipped'],
    ])('"%s"', (operator, value, compareValue) => {
      expect(evaluateOperator(value, operator, compareValue)).toBe(true)
    })

    it('applies to `in` membership too', () => {
      expect(evaluateOperator('HIGH', 'in', ['high', 'medium'])).toBe(true)
    })
  })

  describe('identity reduction', () => {
    it('matches a RecordId against the bare instance id', () => {
      expect(looseEquals('contact:inst-1', 'inst-1')).toBe(true)
      expect(looseEquals('contact:inst-1', 'inst-2')).toBe(false)
    })

    it('matches an actor object against its id', () => {
      expect(looseEquals({ type: 'user', id: 'user-1' }, 'user-1')).toBe(true)
      expect(looseEquals({ type: 'user', id: 'user-1' }, 'user-2')).toBe(false)
    })

    it('compares numbers and numeric strings as equal', () => {
      expect(looseEquals(25, '25')).toBe(true)
      expect(looseEquals(true, 'true')).toBe(true)
    })

    it('does not treat null and undefined as equal to a value', () => {
      expect(looseEquals(null, 'x')).toBe(false)
      expect(looseEquals(undefined, '')).toBe(false)
    })
  })

  describe('emptiness', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace-only string', '   '],
      ['empty array', []],
      ['empty object', {}],
    ])('%s is empty', (_label, value) => {
      expect(isEmptyValue(value)).toBe(true)
    })

    it.each([
      ['a string', 'x'],
      ['zero', 0],
      ['false', false],
      ['a filled array', ['x']],
      ['a filled object', { a: 1 }],
      ['a Date', new Date()],
    ])('%s is not empty', (_label, value) => {
      expect(isEmptyValue(value)).toBe(false)
    })
  })

  describe('gate-by-absence (procedures rely on this)', () => {
    it('treats a missing value as empty and as "is not" anything', () => {
      expect(evaluateOperator(undefined, 'empty', undefined)).toBe(true)
      expect(evaluateOperator(undefined, 'not empty', undefined)).toBe(false)
      expect(evaluateOperator(undefined, 'is not', 'anything')).toBe(true)
      expect(evaluateOperator(undefined, 'is', 'anything')).toBe(false)
    })
  })
})
