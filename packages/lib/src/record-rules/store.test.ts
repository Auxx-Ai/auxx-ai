// packages/lib/src/record-rules/store.test.ts
// Phase 7 (B2 §7b): the user/DB rule-input validator rejects server-only `native`
// actions (the tRPC create/update path calls this). Pure — no DB.

import { describe, expect, it } from 'vitest'
import { legacyActionTextToDoc } from './client'
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
      assertRuleShape({
        ...fieldRule,
        actions: [{ type: 'notify', userIds: ['u'], message: legacyActionTextToDoc('m') }],
      })
    ).not.toThrow()
  })

  it('accepts a native action on a MANAGED rule', () => {
    expect(() =>
      assertRuleShape({
        ...fieldRule,
        on: 'decreased',
        actions: [{ type: 'native', handler: 'deductInventory' }],
        managed: 'inventory',
      })
    ).not.toThrow()
  })

  it('still rejects native without the managed marker', () => {
    expect(() =>
      assertRuleShape({
        ...fieldRule,
        on: 'decreased',
        actions: [{ type: 'native', handler: 'deductInventory' }],
      })
    ).toThrow(/server-declared/)
  })
})

describe('assertRuleShape — signal door (decision 4)', () => {
  const notify = [{ type: 'notify' as const, userIds: ['u'], message: legacyActionTextToDoc('m') }]

  it('accepts a signal rule with a recognized signalKind and no fieldId', () => {
    expect(() =>
      assertRuleShape({ fieldId: null, on: 'signal', signalKind: 'email:opened', actions: notify })
    ).not.toThrow()
  })

  it('rejects a signal rule carrying a fieldId', () => {
    expect(() =>
      assertRuleShape({
        fieldId: 'fld_1',
        on: 'signal',
        signalKind: 'email:opened',
        actions: notify,
      })
    ).toThrow(/must not have a fieldId/)
  })

  it('rejects a signal rule with no signalKind', () => {
    expect(() =>
      assertRuleShape({ fieldId: null, on: 'signal', signalKind: null, actions: notify })
    ).toThrow(/requires a signalKind/)
  })

  it('rejects a signal rule with an unrecognized signalKind', () => {
    expect(() =>
      assertRuleShape({
        fieldId: null,
        on: 'signal',
        signalKind: 'not:a:real:kind',
        actions: notify,
      })
    ).toThrow(/Unknown signal kind/)
  })

  it('rejects signalKind on a non-signal rule', () => {
    expect(() =>
      assertRuleShape({ ...fieldRule, signalKind: 'email:opened', actions: notify })
    ).toThrow(/only valid on a 'signal' rule/)
  })
})

describe('assertRuleShape — stale signal:* conditions (decision 15)', () => {
  const notify = [{ type: 'notify' as const, userIds: ['u'], message: legacyActionTextToDoc('m') }]

  it('rejects a condition referencing a signal:* pseudo-field on a non-signal rule', () => {
    expect(() =>
      assertRuleShape({
        ...fieldRule,
        actions: notify,
        condition: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [
              { id: 'c1', fieldId: 'signal:openCount30d', operator: 'not empty', value: undefined },
            ],
          },
        ] as never,
      })
    ).toThrow(/signal field/)
  })

  it('allows a signal:* condition on a signal rule', () => {
    expect(() =>
      assertRuleShape({
        fieldId: null,
        on: 'signal',
        signalKind: 'email:opened',
        actions: notify,
        condition: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [{ id: 'c1', fieldId: 'signal:openCount30d', operator: '>=', value: 3 }],
          },
        ] as never,
      })
    ).not.toThrow()
  })

  it('allows ordinary field conditions on a non-signal rule', () => {
    expect(() =>
      assertRuleShape({
        ...fieldRule,
        actions: notify,
        condition: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [{ id: 'c1', fieldId: 'status', operator: 'is', value: 'open' }],
          },
        ] as never,
      })
    ).not.toThrow()
  })
})
