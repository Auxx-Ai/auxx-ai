// packages/lib/src/record-rules/store.test.ts
// Phase 7 (B2 §7b): the user/DB rule-input validator rejects server-only `native`
// actions (the tRPC create/update path calls this). Pure — no DB.

import { describe, expect, it } from 'vitest'
import { assertRuleShape } from './store'

const fieldRule = { fieldId: 'fld_1', on: 'changed' as const }

describe('assertRuleShape — native actions', () => {
  it('rejects a native action on a user rule', () => {
    expect(() =>
      assertRuleShape({ ...fieldRule, actions: [{ type: 'native', handler: 'recalc' }] })
    ).toThrow(/server-declared/)
  })

  it('rejects native mixed with a non-native action', () => {
    expect(() =>
      assertRuleShape({
        ...fieldRule,
        actions: [
          { type: 'set-field', fieldRef: 'fld_1', value: 1 },
          { type: 'native', handler: 'recalc' },
        ],
      })
    ).toThrow(/server-declared/)
  })

  it('accepts a normal user rule', () => {
    expect(() =>
      assertRuleShape({ ...fieldRule, actions: [{ type: 'notify', userIds: ['u'], message: 'm' }] })
    ).not.toThrow()
  })
})
