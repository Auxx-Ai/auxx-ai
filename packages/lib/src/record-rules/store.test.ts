// packages/lib/src/record-rules/store.test.ts
// Phase 7 (B2 §7b): the user/DB rule-input validator rejects server-only `native`
// actions (the tRPC create/update path calls this). Pure — no DB.

import { describe, expect, it } from 'vitest'
import { legacyActionTextToDoc } from './client'
import {
  assertRecordRuleDefSupported,
  assertRuleShape,
  createRecordRule,
  updateRecordRule,
} from './store'

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

/**
 * Mail content is not a record-rule target (mail-filters plan §11).
 *
 * `thread` / `message` are system resource TABLES with no `EntityInstance` rows, so
 * neither dispatch door can reach them — a rule saved against one is permanently
 * silent. The record-type picker never offers them (they are `type: 'system'` and it
 * runs with `entityDefinedOnly`), but the router's `entityDefinitionId` is a bare
 * `z.string()`: these cases pin the SERVER refusal, which is the actual gate.
 */
describe('record-rule def guard — mail content', () => {
  const notify = [{ type: 'notify' as const, userIds: ['u'], message: legacyActionTextToDoc('m') }]

  /** Any DB access at all is a failure: the refusal is pure and must come first. */
  const explodingDb = new Proxy(
    {},
    {
      get() {
        throw new Error('the store must refuse mail defs before touching the database')
      },
    }
  ) as never

  it('rejects thread and message', () => {
    expect(() => assertRecordRuleDefSupported('thread')).toThrow(/could never fire/)
    expect(() => assertRecordRuleDefSupported('message')).toThrow(/could never fire/)
  })

  it('leaves every other def alone', () => {
    for (const defId of ['contact', 'participant', 'inbox', 'mzxt3cxyzhm3cbtgcbpmeir1']) {
      expect(() => assertRecordRuleDefSupported(defId)).not.toThrow()
    }
  })

  it('createRecordRule refuses a thread rule before any write', async () => {
    await expect(
      createRecordRule(explodingDb, 'org_1', {
        entityDefinitionId: 'thread',
        fieldId: null,
        name: 'Tag urgent threads',
        on: 'created',
        condition: [],
        actions: notify,
      })
    ).rejects.toThrow(/could never fire/)
  })

  it('updateRecordRule refuses re-pointing a rule at message before any read', async () => {
    await expect(
      updateRecordRule(explodingDb, 'org_1', 'rule_1', { entityDefinitionId: 'message' })
    ).rejects.toThrow(/could never fire/)
  })
})
