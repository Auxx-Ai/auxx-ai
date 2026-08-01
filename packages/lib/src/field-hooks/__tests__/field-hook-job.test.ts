// packages/lib/src/field-hooks/__tests__/field-hook-job.test.ts
// B2 §8: the interactive field-trigger door now routes native (system) record rules through
// the engine's batch API instead of the deleted FIELD_TRIGGERS registry. Boundaries (cache,
// engine) mocked — this asserts the dispatch shape the migration must preserve.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldTriggerJobEvent } from '../../events/types'
import type { CachedRecordRule, RecordRuleBatchContext } from '../../record-rules/types'

const h = vi.hoisted(() => ({
  getCachedRecordRules: vi.fn(),
  getAllCachedCustomFields: vi.fn(),
  // Declare the real parameters — a zero-arity spy types `mock.calls[n]` as the
  // empty tuple, so destructuring the recorded arguments below reads as an error.
  fireRecordRulesBatch: vi.fn(
    async (_rules: CachedRecordRule[], _ctx: RecordRuleBatchContext) => {}
  ),
}))

vi.mock('../../cache', () => ({
  getCachedRecordRules: h.getCachedRecordRules,
  getAllCachedCustomFields: h.getAllCachedCustomFields,
}))
vi.mock('../../record-rules/engine', () => ({ fireRecordRulesBatch: h.fireRecordRulesBatch }))

import { handleFieldTriggerJob, INTERACTIVE_FIELD_WRITE } from '../field-hook-job'

function event(
  recordIds: string[],
  systemAttribute = 'vendor_part_unit_price'
): {
  data: FieldTriggerJobEvent
} {
  return {
    data: {
      type: 'field:trigger',
      data: {
        systemAttribute,
        recordIds: recordIds as never,
        organizationId: 'org_1',
        userId: 'user_1',
      },
    } as FieldTriggerJobEvent,
  }
}

const nativeRule = {
  id: 'system:mfg-vendor-part-unit-price',
  organizationId: 'org_1',
  entityDefinitionId: 'def_vp',
  fieldId: 'fld_price',
  name: 'recalc',
  on: 'changed',
  condition: [],
  actions: [{ type: 'native', handler: 'recalculatePartCostFromVendorPart' }],
  enabled: true,
  isSystem: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getAllCachedCustomFields.mockResolvedValue([
    { id: 'fld_price', systemAttribute: 'vendor_part_unit_price', entityDefinitionId: 'def_vp' },
  ])
  h.getCachedRecordRules.mockResolvedValue([nativeRule])
})

describe('handleFieldTriggerJob — native record-rule dispatch', () => {
  it('fires the native rules once per def with source interactive + write sentinel', async () => {
    await handleFieldTriggerJob(event(['def_vp:i1', 'def_vp:i2']))

    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    const [rules, ctx] = h.fireRecordRulesBatch.mock.calls[0]!
    expect(rules).toEqual([nativeRule])
    expect(ctx).toMatchObject({
      organizationId: 'org_1',
      entityDefinitionId: 'def_vp',
      source: 'interactive',
      userId: 'user_1',
    })
    expect(ctx.events).toEqual([
      {
        entityInstanceId: 'i1',
        fieldId: 'fld_price',
        oldValue: undefined,
        newValue: INTERACTIVE_FIELD_WRITE,
      },
      {
        entityInstanceId: 'i2',
        fieldId: 'fld_price',
        oldValue: undefined,
        newValue: INTERACTIVE_FIELD_WRITE,
      },
    ])
  })

  it('the write sentinel always satisfies the changed transition (unequal to undefined)', async () => {
    const { matchesFieldTransition } = await import('../../record-rules/transitions')
    expect(matchesFieldTransition('changed', undefined, INTERACTIVE_FIELD_WRITE)).toBe(true)
  })

  it('excludes non-native (user) rules on the same field — those fire via door 1', async () => {
    h.getCachedRecordRules.mockResolvedValue([
      nativeRule,
      {
        ...nativeRule,
        id: 'user_rule',
        actions: [{ type: 'notify', userIds: ['u'], message: 'm' }],
        isSystem: false,
      },
    ])
    await handleFieldTriggerJob(event(['def_vp:i1']))
    const [rules] = h.fireRecordRulesBatch.mock.calls[0]!
    expect(rules).toHaveLength(1)
    expect(rules[0]?.id).toBe('system:mfg-vendor-part-unit-price')
  })

  it('does not fire when the org has no native rule on the field', async () => {
    h.getCachedRecordRules.mockResolvedValue([])
    await handleFieldTriggerJob(event(['def_vp:i1']))
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('skips defs whose field is absent for the org', async () => {
    h.getAllCachedCustomFields.mockResolvedValue([]) // field not provisioned
    await handleFieldTriggerJob(event(['def_vp:i1']))
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('groups a mixed-def batch into one call per def', async () => {
    h.getAllCachedCustomFields.mockResolvedValue([
      { id: 'fld_price', systemAttribute: 'vendor_part_unit_price', entityDefinitionId: 'def_vp' },
      {
        id: 'fld_price2',
        systemAttribute: 'vendor_part_unit_price',
        entityDefinitionId: 'def_vp2',
      },
    ])
    h.getCachedRecordRules.mockResolvedValue([
      nativeRule,
      { ...nativeRule, id: 'sys2', entityDefinitionId: 'def_vp2', fieldId: 'fld_price2' },
    ])
    await handleFieldTriggerJob(event(['def_vp:i1', 'def_vp2:i9']))
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(2)
    const defs = h.fireRecordRulesBatch.mock.calls.map((c) => c[1].entityDefinitionId).sort()
    expect(defs).toEqual(['def_vp', 'def_vp2'])
  })

  it('never throws — swallows a downstream error', async () => {
    h.fireRecordRulesBatch.mockRejectedValueOnce(new Error('boom'))
    await expect(handleFieldTriggerJob(event(['def_vp:i1']))).resolves.toBeUndefined()
  })

  it('no-ops on an empty batch', async () => {
    await handleFieldTriggerJob(event([]))
    expect(h.getCachedRecordRules).not.toHaveBeenCalled()
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })
})
