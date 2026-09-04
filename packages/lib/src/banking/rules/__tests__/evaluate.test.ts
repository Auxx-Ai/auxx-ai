// packages/lib/src/banking/rules/__tests__/evaluate.test.ts

import { describe, expect, it } from 'vitest'
import type { BankRuleRecord, RuleMatchInput } from '../client'
import { isSafeRegexPattern } from '../client'
import { evaluateRules } from '../evaluate'

/** A fully-populated rule, overridden per test so every case reads short. */
function rule(overrides: Partial<BankRuleRecord> = {}): BankRuleRecord {
  return {
    id: 'rule_1',
    recordId: 'bank_rule:rule_1',
    name: 'Test rule',
    enabled: true,
    autoApply: false,
    priority: 0,
    matchField: 'matchKey',
    matchOperator: 'contains',
    matchValue: 'FEE',
    amountMinMinor: null,
    amountMaxMinor: null,
    direction: 'any',
    bankAccountId: null,
    action: 'code',
    glAccountCode: '6100',
    counterpartBankAccountId: null,
    contactId: null,
    memo: null,
    appliedCount: 0,
    lastAppliedAt: null,
    createdAt: null,
    ...overrides,
  }
}

function txn(overrides: Partial<RuleMatchInput> = {}): RuleMatchInput {
  return {
    description: 'MONTHLY SVC FEE',
    matchKey: 'MONTHLY SVC FEE',
    amountMinor: -1500,
    bankAccountId: 'acct_1',
    ...overrides,
  }
}

describe('evaluateRules', () => {
  it('returns null when no rule is passed', () => {
    expect(evaluateRules([], txn())).toBeNull()
  })

  it('returns null when no rule matches', () => {
    const rules = [rule({ matchValue: 'SOMETHING ELSE' })]
    expect(evaluateRules(rules, txn())).toBeNull()
  })

  it('skips a disabled rule even when it would otherwise match', () => {
    const rules = [rule({ enabled: false })]
    expect(evaluateRules(rules, txn())).toBeNull()
  })

  describe('matchOperator', () => {
    it('contains matches a substring, case-insensitively', () => {
      const rules = [rule({ matchOperator: 'contains', matchValue: 'svc fee' })]
      expect(evaluateRules(rules, txn())?.id).toBe('rule_1')
    })

    it('equals refuses a partial match', () => {
      const rules = [rule({ matchOperator: 'equals', matchValue: 'SVC FEE' })]
      expect(evaluateRules(rules, txn())).toBeNull()
    })

    it('equals matches the whole value, case-insensitively', () => {
      const rules = [rule({ matchOperator: 'equals', matchValue: 'monthly svc fee' })]
      expect(evaluateRules(rules, txn())?.id).toBe('rule_1')
    })

    it('starts_with matches a prefix only', () => {
      const rules = [rule({ matchOperator: 'starts_with', matchValue: 'MONTHLY' })]
      expect(evaluateRules(rules, txn())?.id).toBe('rule_1')
      const failing = [rule({ matchOperator: 'starts_with', matchValue: 'SVC' })]
      expect(evaluateRules(failing, txn())).toBeNull()
    })

    it('regex matches a compiled, case-insensitive pattern', () => {
      const rules = [rule({ matchOperator: 'regex', matchValue: '^monthly.*fee$' })]
      expect(evaluateRules(rules, txn())?.id).toBe('rule_1')
    })

    it('regex never matches when the pattern is unsafe, rather than throwing', () => {
      const rules = [rule({ matchOperator: 'regex', matchValue: '(a+)+' })]
      expect(() =>
        evaluateRules(rules, txn({ matchKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' }))
      ).not.toThrow()
      expect(evaluateRules(rules, txn({ matchKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' }))).toBeNull()
    })

    it('matches against description when matchField is description', () => {
      const rules = [rule({ matchField: 'description', matchValue: 'MONTHLY' })]
      expect(
        evaluateRules(rules, txn({ description: 'MONTHLY SVC FEE', matchKey: 'SVC FEE' }))?.id
      ).toBe('rule_1')
    })

    it('never matches a null field value', () => {
      const rules = [rule({ matchField: 'description', matchValue: 'MONTHLY' })]
      expect(evaluateRules(rules, txn({ description: null }))).toBeNull()
    })
  })

  describe('direction', () => {
    it('any matches both directions', () => {
      const rules = [rule({ direction: 'any' })]
      expect(evaluateRules(rules, txn({ amountMinor: -100 }))?.id).toBe('rule_1')
      expect(evaluateRules(rules, txn({ amountMinor: 100 }))?.id).toBe('rule_1')
    })

    it('out matches only a negative (money-out) amount', () => {
      const rules = [rule({ direction: 'out' })]
      expect(evaluateRules(rules, txn({ amountMinor: -100 }))?.id).toBe('rule_1')
      expect(evaluateRules(rules, txn({ amountMinor: 100 }))).toBeNull()
    })

    it('in matches only a non-negative (money-in) amount', () => {
      const rules = [rule({ direction: 'in' })]
      expect(evaluateRules(rules, txn({ amountMinor: 100 }))?.id).toBe('rule_1')
      expect(evaluateRules(rules, txn({ amountMinor: -100 }))).toBeNull()
    })
  })

  describe('amount bounds', () => {
    it('refuses a magnitude below amountMinMinor', () => {
      const rules = [rule({ amountMinMinor: 2000 })]
      expect(evaluateRules(rules, txn({ amountMinor: -1500 }))).toBeNull()
    })

    it('refuses a magnitude above amountMaxMinor', () => {
      const rules = [rule({ amountMaxMinor: 1000 })]
      expect(evaluateRules(rules, txn({ amountMinor: -1500 }))).toBeNull()
    })

    it('accepts a magnitude within an inclusive [min, max]', () => {
      const rules = [rule({ amountMinMinor: 1500, amountMaxMinor: 1500 })]
      expect(evaluateRules(rules, txn({ amountMinor: -1500 }))?.id).toBe('rule_1')
    })

    it('bounds compare against the absolute value, sign-blind', () => {
      const rules = [rule({ amountMinMinor: 1500, amountMaxMinor: 1500, direction: 'any' })]
      expect(evaluateRules(rules, txn({ amountMinor: 1500 }))?.id).toBe('rule_1')
      expect(evaluateRules(rules, txn({ amountMinor: -1500 }))?.id).toBe('rule_1')
    })

    it('a null bound imposes no limit on that side', () => {
      const rules = [rule({ amountMinMinor: null, amountMaxMinor: null })]
      expect(evaluateRules(rules, txn({ amountMinor: -999_999 }))?.id).toBe('rule_1')
    })
  })

  describe('account scoping', () => {
    it('a null bankAccountId on the rule matches any account', () => {
      const rules = [rule({ bankAccountId: null })]
      expect(evaluateRules(rules, txn({ bankAccountId: 'acct_2' }))?.id).toBe('rule_1')
    })

    it('a set bankAccountId refuses a transaction on a different account', () => {
      const rules = [rule({ bankAccountId: 'acct_1' })]
      expect(evaluateRules(rules, txn({ bankAccountId: 'acct_2' }))).toBeNull()
    })

    it('a set bankAccountId matches the same account', () => {
      const rules = [rule({ bankAccountId: 'acct_1' })]
      expect(evaluateRules(rules, txn({ bankAccountId: 'acct_1' }))?.id).toBe('rule_1')
    })
  })

  describe('priority', () => {
    it('runs lower priority first, and the first match wins', () => {
      const rules = [
        rule({ id: 'low_priority', priority: 10, glAccountCode: '6200' }),
        rule({ id: 'high_priority', priority: 1, glAccountCode: '6100' }),
      ]
      expect(evaluateRules(rules, txn())?.id).toBe('high_priority')
    })

    it('treats a missing priority as 0', () => {
      const rules = [
        rule({ id: 'explicit_zero', priority: 0 }),
        rule({ id: 'negative', priority: -1 }),
      ]
      expect(evaluateRules(rules, txn())?.id).toBe('negative')
    })

    it('is stable on a priority tie - array order wins', () => {
      const rules = [rule({ id: 'first', priority: 5 }), rule({ id: 'second', priority: 5 })]
      expect(evaluateRules(rules, txn())?.id).toBe('first')
    })

    it('never returns more than one rule - only the first match', () => {
      const rules = [rule({ id: 'a', priority: 1 }), rule({ id: 'b', priority: 2 })]
      const result = evaluateRules(rules, txn())
      expect(result?.id).toBe('a')
    })
  })
})

describe('isSafeRegexPattern', () => {
  it('refuses a pattern over 200 characters', () => {
    expect(isSafeRegexPattern('a'.repeat(201))).toBe(false)
  })

  it('accepts a pattern at the 200 character boundary', () => {
    expect(isSafeRegexPattern('a'.repeat(200))).toBe(true)
  })

  it('refuses an empty pattern', () => {
    expect(isSafeRegexPattern('')).toBe(false)
  })

  it.each(['(a+)+', '(a*)+', '([a-z]+)+', '(a+){2,}'])('refuses the nested quantifier %s', (p) => {
    expect(isSafeRegexPattern(p)).toBe(false)
  })

  it.each([
    'MONTHLY.*FEE',
    '^SVC',
    'fee$',
    'a{1,3}',
    '[A-Z]+ FEE',
  ])('accepts the ordinary pattern %s', (p) => {
    expect(isSafeRegexPattern(p)).toBe(true)
  })
})
