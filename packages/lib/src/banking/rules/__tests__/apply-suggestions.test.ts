// packages/lib/src/banking/rules/__tests__/apply-suggestions.test.ts
//
// What "applied" means on a bank rule.
//
// 🛑 `appliedCount` and `lastAppliedAt` are the two numbers a person reads to
// decide whether to trust a rule enough to let it post unattended. Bumping them
// on a MATCH counts every line the rule merely proposed - including every line a
// locked period refused - so a rule that has never once written to the ledger
// reads as one that has done so hundreds of times.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rule: {} as Record<string, unknown>,
  row: {} as Record<string, unknown> | null,
  code: vi.fn(),
  crudUpdate: vi.fn(),
  bankRule: { id: 'rule_1', appliedCount: 7 },
}))

vi.mock('../../review/writes', () => ({
  codeTransaction: h.code,
  excludeTransaction: vi.fn(),
  transferTransaction: vi.fn(),
}))
vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
  },
}))
vi.mock('../evaluate', () => ({ evaluateRules: () => h.rule }))
vi.mock('../suggest', () => ({
  suggestFromHistory: async () => ({ isErr: () => false, value: null }),
}))
vi.mock('../reads', () => ({
  getBankRule: async () => ({ isErr: () => false, value: h.bankRule }),
  getTransactionMatchRow: async () => ({ isErr: () => false, value: h.row }),
  listBankRules: async () => ({ isErr: () => false, value: [h.rule] }),
  listForReviewTransactionIds: async () => ({ isErr: () => false, value: ['txn_1'] }),
  requireBankRuleFieldContext: async () => ({ bankRuleDefId: 'def_rule' }),
  requireRuleTransactionFieldContext: async () => ({ bankTransactionDefId: 'def_bt' }),
}))

const { applySuggestions } = await import('../writes')

const PARAMS = { organizationId: 'org_1', actorUserId: 'user_1', transactionIds: ['txn_1'] }

/** Did the rule's applied counter move? */
function bumped(): boolean {
  return h.crudUpdate.mock.calls.some(([id]) => id === 'def_rule:rule_1')
}

beforeEach(() => {
  vi.clearAllMocks()
  h.crudUpdate.mockResolvedValue(undefined)
  h.row = {
    id: 'txn_1',
    reviewStatus: 'for_review',
    description: 'WIRE FEE',
    matchKey: 'wire fee',
    amountMinor: -3_500,
    bankAccountId: 'acct_1',
  }
  h.rule = {
    id: 'rule_1',
    name: 'Wire fees',
    action: 'code',
    glAccountCode: '6100',
    autoApply: true,
    memo: null,
    counterpartBankAccountId: null,
  }
  h.code.mockResolvedValue({
    isErr: () => false,
    value: { transaction: { reviewStatus: 'coded' } },
  })
})

describe('applySuggestions', () => {
  it('bumps the applied count when the rule actually coded the line', async () => {
    const result = await applySuggestions({} as never, PARAMS)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.autoApplied).toBe(1)
    expect(bumped()).toBe(true)
  })

  it('🛑 does NOT bump for a rule that only PROPOSED - autoApply is off', async () => {
    h.rule.autoApply = false
    const result = await applySuggestions({} as never, PARAMS)
    if (result.isOk()) {
      expect(result.value.ruleMatched).toBe(1)
      expect(result.value.autoApplied).toBe(0)
    }
    expect(bumped()).toBe(false)
  })

  it('🛑 does NOT bump when the ledger refused the post', async () => {
    // A locked period is the ordinary case at month end, not an exception, and
    // `tryAutoApplyAction` answers false for it. The rule wrote nothing.
    h.code.mockResolvedValue({
      isErr: () => false,
      value: { transaction: { reviewStatus: 'for_review' } },
    })
    const result = await applySuggestions({} as never, PARAMS)
    if (result.isOk()) expect(result.value.autoApplied).toBe(0)
    expect(bumped()).toBe(false)
  })

  it('leaves a line somebody has already decided alone', async () => {
    h.row = { ...(h.row as object), reviewStatus: 'coded' } as Record<string, unknown>
    const result = await applySuggestions({} as never, PARAMS)
    if (result.isOk()) expect(result.value.skipped).toBe(1)
    expect(h.code).not.toHaveBeenCalled()
    expect(bumped()).toBe(false)
  })
})
