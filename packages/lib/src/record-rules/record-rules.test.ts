// packages/lib/src/record-rules/record-rules.test.ts
// Engine-core tests: transition matching, condition gating, ordered actions with
// continue-and-report outcomes, loop guard. External boundaries (db, cache,
// resource fetch, actions) are mocked — Drizzle column refs are undefined under
// vitest (project memory), so the store is exercised at the function level only.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { executeRuleAction } from './actions'
import { legacyActionTextToDoc } from './client'
import type { insertRecordRuleRun } from './store'
import type { CachedRecordRule } from './types'

const h = vi.hoisted(() => ({
  executeRuleAction: vi.fn<typeof executeRuleAction>(async () => 'ok'),
  insertRecordRuleRun: vi.fn<typeof insertRecordRuleRun>(async () => undefined),
  fetchResourceById: vi.fn(),
  getCachedResourceFields: vi.fn(async () => [
    { id: 'fld_status', key: 'status', systemAttribute: null },
    { id: 'fld_priority', key: 'priority', systemAttribute: 'ticket_priority' },
  ]),
}))

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('./actions', () => ({ executeRuleAction: h.executeRuleAction }))
vi.mock('./store', () => ({
  insertRecordRuleRun: h.insertRecordRuleRun,
  insertRecordRuleRuns: vi.fn(async () => {}),
}))
vi.mock('../resources/resource-fetcher', () => ({ fetchResourceById: h.fetchResourceById }))
vi.mock('../cache', () => ({ getCachedResourceFields: h.getCachedResourceFields }))

import { fireRecordRules } from './engine'
import { buildFieldKeyMap, makeSnapshotResolver } from './resolver'
import { matchesFieldTransition } from './transitions'

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
    fieldId: 'fld_status',
    name: 'Test rule',
    on: 'changed',
    condition: [],
    actions: [{ type: 'notify', userIds: ['u1'], message: legacyActionTextToDoc('hi') }],
    enabled: true,
    ...overrides,
  }
}

const baseCtx = {
  organizationId: 'org_1',
  entityDefinitionId: 'def_1',
  entityInstanceId: 'inst_1',
  source: 'interactive' as const,
  userId: 'user_1',
}

/** Assert a mock was called before returning its first typed argument tuple. */
function firstMockCall<TArgs extends unknown[]>(calls: TArgs[]): TArgs {
  const call = calls[0]
  expect(call).toBeDefined()
  if (!call) throw new Error('Expected mock to have been called')
  return call
}

beforeEach(() => {
  vi.clearAllMocks()
  h.executeRuleAction.mockResolvedValue('ok')
})

describe('matchesFieldTransition', () => {
  it('changed: value difference, including null → value', () => {
    expect(matchesFieldTransition('changed', 'a', 'b')).toBe(true)
    expect(matchesFieldTransition('changed', 'a', 'a')).toBe(false)
    expect(matchesFieldTransition('changed', null, 'a')).toBe(true)
    expect(matchesFieldTransition('changed', null, null)).toBe(false)
    expect(matchesFieldTransition('changed', ['x'], ['x'])).toBe(false)
    expect(matchesFieldTransition('changed', ['x'], ['y'])).toBe(true)
  })

  it('increased/decreased: numeric only, coerces numeric strings', () => {
    expect(matchesFieldTransition('increased', 1, 2)).toBe(true)
    expect(matchesFieldTransition('increased', 2, 1)).toBe(false)
    expect(matchesFieldTransition('decreased', '42', '39')).toBe(true)
    expect(matchesFieldTransition('decreased', null, 5)).toBe(false)
    expect(matchesFieldTransition('increased', 'abc', 5)).toBe(false)
  })

  it('set/cleared: empty transitions', () => {
    expect(matchesFieldTransition('set', null, 'x')).toBe(true)
    expect(matchesFieldTransition('set', 'x', 'y')).toBe(false)
    expect(matchesFieldTransition('cleared', 'x', null)).toBe(true)
    expect(matchesFieldTransition('cleared', null, null)).toBe(false)
  })

  it('lifecycle transitions never match field writes', () => {
    expect(matchesFieldTransition('created', null, 'x')).toBe(false)
    expect(matchesFieldTransition('deleted', 'x', null)).toBe(false)
  })

  // F4: jsonb round-trips reorder object keys — an identical object must compare equal
  // regardless of key order (deep, arrays keep their order).
  it('changed: object equality is key-order-insensitive (jsonb round-trip)', () => {
    expect(
      matchesFieldTransition('changed', { a: 1, b: { d: 4, c: 3 } }, { b: { c: 3, d: 4 }, a: 1 })
    ).toBe(false)
    expect(matchesFieldTransition('changed', { a: 1 }, { a: 2 })).toBe(true)
    expect(matchesFieldTransition('changed', [1, 2], [2, 1])).toBe(true)
  })
})

describe('resolver', () => {
  const fields = [
    { id: 'fld_a', key: 'title', systemAttribute: null },
    { id: 'fld_b', key: 'priority', systemAttribute: 'ticket_priority' },
  ] as never[]

  it('maps id, key, and systemAttribute to the snapshot output key', () => {
    const map = buildFieldKeyMap(fields as never)
    expect(map.get('fld_a')).toBe('title')
    expect(map.get('fld_b')).toBe('ticket_priority')
    expect(map.get('ticket_priority')).toBe('ticket_priority')
    expect(map.get('priority')).toBe('ticket_priority')
  })

  it('resolves from fieldValues, then top-level, else undefined', () => {
    const resolve = makeSnapshotResolver(fields as never)
    const snapshot = {
      id: 'inst_1',
      createdAt: 'now',
      fieldValues: { ticket_priority: 'urgent', title: 'Hello' },
    }
    expect(resolve(snapshot, 'fld_b')).toBe('urgent')
    expect(resolve(snapshot, 'title')).toBe('Hello')
    expect(resolve(snapshot, 'createdAt')).toBe('now')
    expect(resolve(snapshot, 'nope')).toBeUndefined()
  })
})

describe('fireRecordRules', () => {
  it('runs actions in order and logs an ok run', async () => {
    const r = rule({
      actions: [
        { type: 'notify', userIds: ['u1'], message: legacyActionTextToDoc('first') },
        { type: 'set-field', fieldRef: 'fld_x', value: 1 },
      ],
    })
    await fireRecordRules([r], { ...baseCtx, fieldId: 'fld_status', oldValue: 'a', newValue: 'b' })

    expect(h.executeRuleAction).toHaveBeenCalledTimes(2)
    expect(firstMockCall(h.executeRuleAction.mock.calls)[0]).toMatchObject({ type: 'notify' })
    expect(h.executeRuleAction.mock.calls[1]?.[0]).toMatchObject({ type: 'set-field' })
    expect(h.insertRecordRuleRun).toHaveBeenCalledTimes(1)
    const run = firstMockCall(h.insertRecordRuleRun.mock.calls)[1]
    expect(run.status).toBe('ok')
    expect(run.outcomes).toHaveLength(2)
  })

  it('continue-and-report: a failed action does not stop later ones; status = partial', async () => {
    h.executeRuleAction.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    const r = rule({
      actions: [
        { type: 'set-field', fieldRef: 'fld_x', value: 1 },
        { type: 'notify', userIds: ['u1'], message: legacyActionTextToDoc('still runs') },
      ],
    })
    await fireRecordRules([r], { ...baseCtx })

    expect(h.executeRuleAction).toHaveBeenCalledTimes(2)
    const run = firstMockCall(h.insertRecordRuleRun.mock.calls)[1]
    expect(run.status).toBe('partial')
    expect(run.outcomes[0]).toMatchObject({ status: 'failed', error: 'boom' })
    expect(run.outcomes[1]).toMatchObject({ status: 'ok' })
  })

  it('all actions failing yields status = failed', async () => {
    h.executeRuleAction.mockRejectedValue(new Error('down'))
    await fireRecordRules([rule()], { ...baseCtx })
    expect(firstMockCall(h.insertRecordRuleRun.mock.calls)[1].status).toBe('failed')
  })

  it('gates on conditions using the record snapshot', async () => {
    h.fetchResourceById.mockResolvedValue({
      id: 'inst_1',
      fieldValues: { ticket_priority: 'low' },
    })
    const conditioned = rule({
      condition: [
        {
          id: 'g1',
          logicalOperator: 'AND',
          conditions: [{ id: 'c1', fieldId: 'fld_priority', operator: 'is', value: 'urgent' }],
        },
      ] as never,
    })
    await fireRecordRules([conditioned], { ...baseCtx })
    expect(h.executeRuleAction).not.toHaveBeenCalled()
    expect(h.insertRecordRuleRun).not.toHaveBeenCalled()

    h.fetchResourceById.mockResolvedValue({
      id: 'inst_1',
      fieldValues: { ticket_priority: 'urgent' },
    })
    await fireRecordRules([conditioned], { ...baseCtx })
    expect(h.executeRuleAction).toHaveBeenCalledTimes(1)
  })

  it('skips condition evaluation entirely when the record is gone', async () => {
    h.fetchResourceById.mockResolvedValue(null)
    const conditioned = rule({
      condition: [
        {
          id: 'g1',
          logicalOperator: 'AND',
          conditions: [{ id: 'c1', fieldId: 'x', operator: 'is', value: 1 }],
        },
      ] as never,
    })
    await fireRecordRules([conditioned], { ...baseCtx })
    expect(h.executeRuleAction).not.toHaveBeenCalled()
  })

  it('loop guard: a rule whose action re-enters cannot re-fire itself for the same record', async () => {
    const r = rule()
    let reentered = 0
    h.executeRuleAction.mockImplementation(async () => {
      reentered += 1
      if (reentered < 10) {
        // Simulate a set-field write re-dispatching the same rule inline.
        await fireRecordRules([r], { ...baseCtx })
      }
      return 'ok'
    })
    await fireRecordRules([r], { ...baseCtx })
    // The chain's seen-set stops the immediate re-fire; only the original firing runs.
    expect(reentered).toBe(1)
  })

  it('loop guard: depth cap stops rule chains through different rules', async () => {
    const a = rule({ id: 'rule_a' })
    const b = rule({ id: 'rule_b' })
    let fires = 0
    h.executeRuleAction.mockImplementation(async () => {
      fires += 1
      // Each firing triggers the *other* rule — an A→B→A ping-pong.
      await fireRecordRules([fires % 2 === 0 ? a : b], { ...baseCtx })
      return 'ok'
    })
    await fireRecordRules([a], { ...baseCtx })
    // Depth cap (3) bounds the chain regardless of rule alternation.
    expect(fires).toBeLessThanOrEqual(3)
  })
})
