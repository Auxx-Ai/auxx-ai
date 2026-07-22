// packages/lib/src/events/handlers/auto-complete-tasks.test.ts
// The auto-complete-on-reply handler (Step 5): kind/backfill/contact-id gating, the
// query scope (open + snoozed match, completed/archived never touched — verified via the
// stubbed `and`/`eq`/`isNull` call args since the DB layer itself is faked), idempotent
// `.returning()`-gated notification, and the system-user creator skip (decision 12).
// Schema is a Proxy (Drizzle-columns-undefined-under-vitest gotcha — see project memory).

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything a `vi.mock` factory below reads must be created via `vi.hoisted` — a plain
// top-level `const` referenced by a hoisted factory races the SUT's own (hoisted) import
// of the mocked module and throws "Cannot access before initialization".
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
    inArray: vi.fn((col: any, vals: any) => ({ type: 'inArray', col, vals })),
    isNull: vi.fn((col: any) => ({ type: 'isNull', col })),
    state: {
      candidateRows: [] as any[],
      assignmentRows: [] as any[],
      updateReturning: [] as any[],
      systemUserId: 'sys_user' as string | null,
      selectCalls: 0,
    },
    sendNotification: vi.fn<(data: any) => Promise<void>>(async () => {}),
  }
})

vi.mock('drizzle-orm', () => ({ and: h.and, eq: h.eq, inArray: h.inArray, isNull: h.isNull }))

vi.mock('@auxx/database', () => ({
  database: {
    select: vi.fn(() => {
      h.state.selectCalls++
      if (h.state.selectCalls === 1) {
        // db.select({...}).from(Task).innerJoin(TaskReference, ...).where(...)
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => Promise.resolve(h.state.candidateRows),
            }),
          }),
        }
      }
      // db.select({userId}).from(TaskAssignment).where(...)
      return { from: () => ({ where: () => Promise.resolve(h.state.assignmentRows) }) }
    }),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(h.state.updateReturning),
        }),
      }),
    })),
  },
  schema: h.mockSchema,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.state.systemUserId }),
}))

vi.mock('../../notifications/notification-service', () => ({
  NotificationService: vi.fn().mockImplementation(function (this: any) {
    this.sendNotification = h.sendNotification
  }),
}))

import { autoCompleteTasks } from './auto-complete-tasks'

function replyEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'signal:recorded',
      data: {
        signalId: 'sig_1',
        organizationId: 'org_1',
        kind: 'message:replied',
        subtype: 'reply',
        occurredAt: new Date('2026-01-02'),
        contactEntityInstanceId: 'contact_1',
        recordKeys: ['contact:contact_1'],
        isBot: false,
        backfill: false,
        ...overrides,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.candidateRows = []
  h.state.assignmentRows = []
  h.state.updateReturning = []
  h.state.systemUserId = 'sys_user'
  h.state.selectCalls = 0
})

describe('autoCompleteTasks — gating', () => {
  it('ignores non-reply signal kinds', async () => {
    await autoCompleteTasks(replyEvent({ kind: 'email:opened' }) as never)
    expect(h.state.selectCalls).toBe(0)
  })

  it('ignores backfill replies', async () => {
    await autoCompleteTasks(replyEvent({ backfill: true }) as never)
    expect(h.state.selectCalls).toBe(0)
  })

  it('ignores replies with no contact', async () => {
    await autoCompleteTasks(replyEvent({ contactEntityInstanceId: null }) as never)
    expect(h.state.selectCalls).toBe(0)
  })
})

describe('autoCompleteTasks — query scope', () => {
  it('scopes the candidate query to open tasks with autoCompleteOn=contact_reply, never snoozedUntil', async () => {
    h.state.candidateRows = []
    await autoCompleteTasks(replyEvent() as never)

    const isNullCols = h.isNull.mock.calls.map(([col]) => col)
    expect(isNullCols).toContain('Task.completedAt')
    expect(isNullCols).toContain('Task.archivedAt')
    expect(isNullCols).toContain('TaskReference.deletedAt')
    // Snoozed tasks DO auto-complete (decision 10) — the query never filters on it.
    expect(isNullCols).not.toContain('Task.snoozedUntil')

    const eqPairs = h.eq.mock.calls.map(([col, val]) => [col, val])
    expect(eqPairs).toContainEqual(['Task.autoCompleteOn', 'contact_reply'])
    expect(eqPairs).toContainEqual(['TaskReference.referencedEntityInstanceId', 'contact_1'])
  })
})

describe('autoCompleteTasks — completion + notification', () => {
  it('skips notifying the system-user creator when there are no assignees (decision 12)', async () => {
    h.state.candidateRows = [
      { id: 't1', title: 'Follow up', organizationId: 'org_1', createdById: 'sys_user' },
    ]
    h.state.updateReturning = [{ id: 't1' }]
    h.state.assignmentRows = []

    await autoCompleteTasks(replyEvent() as never)

    expect(h.sendNotification).not.toHaveBeenCalled()
  })

  it('notifies a human creator plus active assignees with TASK_AUTO_COMPLETED', async () => {
    h.state.candidateRows = [
      { id: 't1', title: 'Call back Jane', organizationId: 'org_1', createdById: 'user_creator' },
    ]
    h.state.updateReturning = [{ id: 't1' }]
    h.state.assignmentRows = [{ userId: 'user_assignee' }]

    await autoCompleteTasks(replyEvent() as never)

    expect(h.sendNotification).toHaveBeenCalledTimes(2)
    const recipientIds = h.sendNotification.mock.calls.map((call) => (call[0] as any).userId).sort()
    expect(recipientIds).toEqual(['user_assignee', 'user_creator'].sort())
    expect(h.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TASK_AUTO_COMPLETED',
        message: 'Follow-up completed: Call back Jane (contact replied)',
      })
    )
  })

  it('only notifies for tasks the update actually completed (idempotent under a race)', async () => {
    h.state.candidateRows = [
      { id: 't1', title: 'Task one', organizationId: 'org_1', createdById: 'user_creator' },
      { id: 't2', title: 'Task two', organizationId: 'org_1', createdById: 'user_creator' },
    ]
    // Only t1 actually got updated (t2 lost the race to a manual complete).
    h.state.updateReturning = [{ id: 't1' }]
    h.state.assignmentRows = []

    await autoCompleteTasks(replyEvent() as never)

    expect(h.sendNotification).toHaveBeenCalledTimes(1)
    expect(h.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ entityId: 't1' }))
  })

  it('no-ops when nothing matches the candidate query', async () => {
    h.state.candidateRows = []
    await autoCompleteTasks(replyEvent() as never)
    expect(h.sendNotification).not.toHaveBeenCalled()
  })
})
