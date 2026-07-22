// packages/lib/src/record-rules/actions.test.ts
// Executor tests for the `create-task` rule action (plans/signals/06-follow-ups-build.md
// Step 4). Schema is a Proxy (avoids the known Drizzle-columns-undefined-under-vitest
// gotcha — see project memory); drizzle-orm's `and`/`eq`/`gte`/`isNull`/`or` are stubbed
// so the real query builder never runs against the fake columns — the dedupe/cooldown
// query's actual date filtering is Postgres-side and out of scope here; these tests
// verify the executor builds the right predicate shape and branches correctly on
// whether the (mocked) query returns a matching row.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedRecordRule, RecordRuleFireContext } from './types'

// Everything a `vi.mock` factory reads must come from `vi.hoisted` — a plain top-level
// `const` referenced by a hoisted factory races the SUT's own hoisted import of the
// mocked module (project memory: "Cannot access before initialization").
const h = vi.hoisted(() => {
  const schemaHandler: ProxyHandler<any> = {
    get(_target, tableProp) {
      return new Proxy(
        {},
        {
          get(_t, colProp) {
            return `${String(tableProp)}.${String(colProp)}`
          },
        }
      )
    },
  }
  return {
    mockSchema: new Proxy({}, schemaHandler),
    and: vi.fn((...conds: any[]) => ({ type: 'and', conds })),
    eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
    gte: vi.fn((col: any, val: any) => ({ type: 'gte', col, val })),
    isNull: vi.fn((col: any) => ({ type: 'isNull', col })),
    or: vi.fn((...conds: any[]) => ({ type: 'or', conds })),
    select: vi.fn(),
    createTask: vi.fn<
      (input: any, organizationId: string, userId: string) => Promise<{ id: string }>
    >(async () => ({ id: 'task_new' })),
    getSystemUserForActions: vi.fn<(organizationId: string) => Promise<string>>(
      async () => 'user_system_1'
    ),
  }
})

vi.mock('drizzle-orm', () => ({
  and: h.and,
  eq: h.eq,
  gte: h.gte,
  isNull: h.isNull,
  or: h.or,
}))
vi.mock('@auxx/database', () => ({
  database: { select: h.select },
  schema: h.mockSchema,
}))
vi.mock('../tasks', () => ({
  createTaskService: () => ({ createTask: h.createTask }),
}))
vi.mock('../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: h.getSystemUserForActions },
}))

import { executeRuleAction } from './actions'

/** One `database.select(...).from(...)` chain, resolving `.limit()` to `rows`. */
function chain(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const innerJoin = vi.fn().mockReturnValue({ where })
  // `from` supports both call shapes: the dedupe query joins Task→TaskReference, the
  // display-name lookup goes straight to `.where()`.
  const from = vi.fn().mockReturnValue({ innerJoin, where })
  return { from }
}

/** Queue the two sequential `select()` calls the executor makes: dedupe, then displayName. */
function stubQueries(dedupeRows: any[], instanceRows: any[]) {
  h.select.mockReset()
  h.select
    .mockImplementationOnce(() => chain(dedupeRows))
    .mockImplementationOnce(() => chain(instanceRows))
}

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_contact',
    fieldId: null,
    name: 'Hot contact follow-up',
    on: 'signal',
    signalKind: 'email:opened',
    condition: [],
    actions: [],
    enabled: true,
    ...overrides,
  }
}

const baseCtx: RecordRuleFireContext = {
  organizationId: 'org_1',
  entityDefinitionId: 'def_contact',
  entityInstanceId: 'contact_1',
  source: 'interactive',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createTask.mockResolvedValue({ id: 'task_new' })
  h.getSystemUserForActions.mockResolvedValue('user_system_1')
})

describe("executeRuleAction — 'create-task'", () => {
  it('skips (dedupe) when an open task from the same rule already references the record', async () => {
    stubQueries([{ id: 'task_dup' }], [])
    const result = await executeRuleAction(
      { type: 'create-task', title: 'Follow up with {{record}}' },
      rule(),
      baseCtx,
      null
    )
    expect(result).toBe('skipped')
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('skips (cooldown) when the matching task was completed within the last 7 days', async () => {
    // The dedupe query's WHERE folds the open/cooldown check into one clause (or(isNull,
    // gte)); a matched row here represents Postgres having found either case. Assert the
    // predicate actually asks for a 7-day-ish cutoff.
    stubQueries([{ id: 'task_recently_completed' }], [])
    const result = await executeRuleAction(
      { type: 'create-task', title: 'Follow up' },
      rule(),
      baseCtx,
      null
    )
    expect(result).toBe('skipped')
    expect(h.or).toHaveBeenCalled()
    const [, cutoffArg] = h.gte.mock.calls[0] as [unknown, Date]
    const daysAgo = (Date.now() - cutoffArg.getTime()) / (24 * 60 * 60 * 1000)
    expect(daysAgo).toBeGreaterThan(6.9)
    expect(daysAgo).toBeLessThan(7.1)
  })

  it('creates when no dedupe/cooldown match is found (e.g. prior task completed >7 days ago)', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    const result = await executeRuleAction(
      { type: 'create-task', title: 'Follow up with {{record}}' },
      rule(),
      baseCtx,
      null
    )
    expect(result).toBe('ok')
    expect(h.createTask).toHaveBeenCalledTimes(1)
  })

  it('interpolates {{record}} with the fired record display name, falling back to the id', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    await executeRuleAction(
      { type: 'create-task', title: 'Follow up with {{record}} about opens' },
      rule(),
      baseCtx,
      null
    )
    const [input] = h.createTask.mock.calls[0] as [any, string, string]
    expect(input.title).toBe('Follow up with Jane Doe about opens')

    stubQueries([], [{ displayName: null }])
    await executeRuleAction(
      { type: 'create-task', title: 'Follow up with {{record}}' },
      rule(),
      baseCtx,
      null
    )
    const [fallbackInput] = h.createTask.mock.calls[1] as [any, string, string]
    expect(fallbackInput.title).toBe('Follow up with contact_1')
  })

  it('creates with the org system user as creator, source=rule, and sourceRuleId set', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    await executeRuleAction({ type: 'create-task', title: 'Follow up' }, rule(), baseCtx, null)

    expect(h.getSystemUserForActions).toHaveBeenCalledWith('org_1')
    const [input, organizationId, userId] = h.createTask.mock.calls[0] as [any, string, string]
    expect(organizationId).toBe('org_1')
    expect(userId).toBe('user_system_1')
    expect(input.source).toBe('rule')
    expect(input.sourceRuleId).toBe('rule_1')
  })

  it('passes signal provenance through (sourceSignalId + a distinct contact reference)', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    const ctxWithSignal: RecordRuleFireContext = {
      ...baseCtx,
      entityInstanceId: 'order_1',
      signal: { signalId: 'sig_1', kind: 'email:opened', contactEntityInstanceId: 'contact_1' },
    }
    await executeRuleAction(
      { type: 'create-task', title: 'Follow up' },
      rule(),
      ctxWithSignal,
      null
    )
    const [input] = h.createTask.mock.calls[0] as [any, string, string]
    expect(input.sourceSignalId).toBe('sig_1')
    expect(input.referencedEntities).toEqual(['def_contact:order_1', 'def_contact:contact_1'])
  })

  it('does not duplicate the reference when the signal contact IS the fired record', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    const ctxWithSignal: RecordRuleFireContext = {
      ...baseCtx,
      signal: { signalId: 'sig_1', kind: 'email:opened', contactEntityInstanceId: 'contact_1' },
    }
    await executeRuleAction(
      { type: 'create-task', title: 'Follow up' },
      rule(),
      ctxWithSignal,
      null
    )
    const [input] = h.createTask.mock.calls[0] as [any, string, string]
    expect(input.referencedEntities).toEqual(['def_contact:contact_1'])
  })

  it('resolves deadlineDays, priority, autoCompleteOn, and assigneeIds onto the task input', async () => {
    stubQueries([], [{ displayName: 'Jane Doe' }])
    await executeRuleAction(
      {
        type: 'create-task',
        title: 'Follow up',
        deadlineDays: 2,
        priority: 'high',
        autoCompleteOn: 'contact_reply',
        assigneeIds: ['u1', 'u2'],
      },
      rule(),
      baseCtx,
      null
    )
    const [input] = h.createTask.mock.calls[0] as [any, string, string]
    expect(input.deadline).toEqual({ days: 2 })
    expect(input.priority).toBe('high')
    expect(input.autoCompleteOn).toBe('contact_reply')
    expect(input.assigneeActorIds).toEqual(['user:u1', 'user:u2'])
  })

  it("skips without querying anything on a 'deleted' firing", async () => {
    const result = await executeRuleAction(
      { type: 'create-task', title: 'Follow up' },
      rule({ on: 'deleted' }),
      baseCtx,
      null
    )
    expect(result).toBe('skipped')
    expect(h.select).not.toHaveBeenCalled()
    expect(h.createTask).not.toHaveBeenCalled()
  })
})
