// packages/lib/src/record-rules/batch.test.ts
// Phase 7 (B2 unification): the batch engine entry point. Native actions fire ONCE per
// rule with the full recordIds batch; non-native rules run through the existing
// per-record path (batch-of-1 ≡ single). Boundaries (actions, store, cache, db) mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedRecordRule, RecordRuleBatchEvent } from './types'

const h = vi.hoisted(() => {
  const handlers = new Map<string, (e: unknown) => Promise<void>>()
  return {
    executeRuleAction: vi.fn(async () => 'ok' as const),
    insertRecordRuleRun: vi.fn(async () => {}),
    fetchResourceById: vi.fn(),
    getCachedResourceFields: vi.fn(async () => []),
    nativeHandler: vi.fn(async () => {}),
    handlers,
    getNativeRuleHandler: vi.fn((key: string) => handlers.get(key)),
  }
})

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('./actions', () => ({
  executeRuleAction: h.executeRuleAction,
  getNativeRuleHandler: h.getNativeRuleHandler,
}))
vi.mock('./store', () => ({ insertRecordRuleRun: h.insertRecordRuleRun }))
vi.mock('../resources/resource-fetcher', () => ({ fetchResourceById: h.fetchResourceById }))
vi.mock('../cache', () => ({ getCachedResourceFields: h.getCachedResourceFields }))

import { fireRecordRules, fireRecordRulesBatch } from './engine'

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
    fieldId: 'fld_status',
    name: 'r',
    on: 'changed',
    condition: [],
    actions: [{ type: 'notify', userIds: ['u1'], message: 'hi' }],
    enabled: true,
    ...overrides,
  }
}

const baseCtx = {
  organizationId: 'org_1',
  entityDefinitionId: 'def_1',
  source: 'sync' as const,
}

function fieldEvent(instance: string, o: unknown, n: unknown): RecordRuleBatchEvent {
  return { entityInstanceId: instance, fieldId: 'fld_status', oldValue: o, newValue: n }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.handlers.clear()
  h.executeRuleAction.mockResolvedValue('ok')
  h.handlers.set('recalc', h.nativeHandler)
})

describe('fireRecordRulesBatch — native actions', () => {
  it('invokes the native handler ONCE per rule with the full recordIds batch', async () => {
    const nativeRule = rule({ id: 'sys', actions: [{ type: 'native', handler: 'recalc' }] })
    await fireRecordRulesBatch([nativeRule], {
      ...baseCtx,
      events: [fieldEvent('i1', 'a', 'b'), fieldEvent('i2', 'a', 'b'), fieldEvent('i3', 'a', 'b')],
    })

    expect(h.nativeHandler).toHaveBeenCalledTimes(1)
    expect(h.nativeHandler).toHaveBeenCalledWith({
      recordIds: ['def_1:i1', 'def_1:i2', 'def_1:i3'],
      organizationId: 'org_1',
      userId: undefined,
    })
    // Per D11: one run row PER record.
    expect(h.insertRecordRuleRun).toHaveBeenCalledTimes(3)
    // Native path bypasses the per-record executor.
    expect(h.executeRuleAction).not.toHaveBeenCalled()
  })

  it('only batches records whose transition matches the rule', async () => {
    const nativeRule = rule({
      id: 'sys',
      on: 'increased',
      actions: [{ type: 'native', handler: 'recalc' }],
    })
    await fireRecordRulesBatch([nativeRule], {
      ...baseCtx,
      events: [
        { entityInstanceId: 'i1', fieldId: 'fld_status', oldValue: 1, newValue: 2 }, // increased ✓
        { entityInstanceId: 'i2', fieldId: 'fld_status', oldValue: 5, newValue: 3 }, // decreased ✗
      ],
    })
    expect(h.nativeHandler).toHaveBeenCalledTimes(1)
    expect(h.nativeHandler.mock.calls[0][0]).toMatchObject({ recordIds: ['def_1:i1'] })
    expect(h.insertRecordRuleRun).toHaveBeenCalledTimes(1)
  })

  it('unknown handler key → outcome failed, logged run row, never throws', async () => {
    const nativeRule = rule({ id: 'sys', actions: [{ type: 'native', handler: 'nope' }] })
    await fireRecordRulesBatch([nativeRule], { ...baseCtx, events: [fieldEvent('i1', 'a', 'b')] })

    expect(h.nativeHandler).not.toHaveBeenCalled()
    expect(h.insertRecordRuleRun).toHaveBeenCalledTimes(1)
    expect(h.insertRecordRuleRun.mock.calls[0][1]).toMatchObject({ status: 'failed' })
  })

  it('propagates userId to the native handler', async () => {
    const nativeRule = rule({ id: 'sys', actions: [{ type: 'native', handler: 'recalc' }] })
    await fireRecordRulesBatch([nativeRule], {
      ...baseCtx,
      userId: 'user_9',
      events: [fieldEvent('i1', 'a', 'b')],
    })
    expect(h.nativeHandler.mock.calls[0][0]).toMatchObject({ userId: 'user_9' })
  })

  // Phase 9 / Option A: lifecycle native rules receive the per-record raw values + the
  // lifecycle action so entity-trigger handlers reconstruct their `values` without a refetch.
  it('forwards eventData + action to the native handler on lifecycle firings', async () => {
    const nativeRule = rule({
      id: 'sys',
      fieldId: null,
      on: 'created',
      actions: [{ type: 'native', handler: 'recalc' }],
    })
    await fireRecordRulesBatch([nativeRule], {
      ...baseCtx,
      events: [
        { entityInstanceId: 'i1', eventData: { company_domain: 'a.com' } },
        { entityInstanceId: 'i2', eventData: { company_domain: 'b.com' } },
      ],
    })
    expect(h.nativeHandler).toHaveBeenCalledTimes(1)
    expect(h.nativeHandler.mock.calls[0][0]).toMatchObject({
      recordIds: ['def_1:i1', 'def_1:i2'],
      action: 'created',
      eventDataByRecordId: {
        'def_1:i1': { company_domain: 'a.com' },
        'def_1:i2': { company_domain: 'b.com' },
      },
    })
  })

  it('omits eventDataByRecordId when no event carried values (still sets action)', async () => {
    const nativeRule = rule({
      id: 'sys',
      fieldId: null,
      on: 'deleted',
      actions: [{ type: 'native', handler: 'recalc' }],
    })
    await fireRecordRulesBatch([nativeRule], {
      ...baseCtx,
      events: [{ entityInstanceId: 'i1' }],
    })
    const arg = h.nativeHandler.mock.calls[0][0] as {
      action?: string
      eventDataByRecordId?: unknown
    }
    expect(arg.action).toBe('deleted')
    expect(arg.eventDataByRecordId).toBeUndefined()
  })
})

describe('fireRecordRulesBatch — non-native (batch-of-1 ≡ single)', () => {
  it('runs a non-native rule through the per-record executor', async () => {
    await fireRecordRulesBatch([rule()], { ...baseCtx, events: [fieldEvent('i1', 'a', 'b')] })
    expect(h.executeRuleAction).toHaveBeenCalledTimes(1)
    expect(h.nativeHandler).not.toHaveBeenCalled()
    expect(h.insertRecordRuleRun).toHaveBeenCalledTimes(1)
  })

  it('batch-of-1 matches a direct single fireRecordRules call (same executor calls)', async () => {
    const r = rule()
    await fireRecordRulesBatch([r], { ...baseCtx, events: [fieldEvent('i1', 'a', 'b')] })
    const batchExecCalls = h.executeRuleAction.mock.calls.length
    const batchRunRow = h.insertRecordRuleRun.mock.calls[0][1]

    vi.clearAllMocks()
    h.executeRuleAction.mockResolvedValue('ok')

    await fireRecordRules([r], {
      organizationId: 'org_1',
      entityDefinitionId: 'def_1',
      entityInstanceId: 'i1',
      source: 'sync',
      fieldId: 'fld_status',
      oldValue: 'a',
      newValue: 'b',
    })
    expect(h.executeRuleAction.mock.calls.length).toBe(batchExecCalls)
    expect(h.insertRecordRuleRun.mock.calls[0][1]).toMatchObject({
      ruleId: batchRunRow.ruleId,
      entityInstanceId: batchRunRow.entityInstanceId,
      source: batchRunRow.source,
      fieldId: batchRunRow.fieldId,
    })
  })

  it('does not fire when no rule matches any event', async () => {
    await fireRecordRulesBatch([rule({ on: 'changed' })], {
      ...baseCtx,
      events: [fieldEvent('i1', 'a', 'a')], // unchanged
    })
    expect(h.executeRuleAction).not.toHaveBeenCalled()
    expect(h.insertRecordRuleRun).not.toHaveBeenCalled()
  })

  it('lifecycle events (no fieldId) match lifecycle rules', async () => {
    const created = rule({
      id: 'life',
      fieldId: null,
      on: 'created',
      actions: [{ type: 'notify', userIds: ['u'], message: 'm' }],
    })
    await fireRecordRulesBatch([created], {
      ...baseCtx,
      events: [{ entityInstanceId: 'i1' }, { entityInstanceId: 'i2' }],
    })
    // Two records, one non-native lifecycle rule → executor runs per record.
    expect(h.executeRuleAction).toHaveBeenCalledTimes(2)
  })
})
