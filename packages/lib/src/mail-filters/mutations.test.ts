// packages/lib/src/mail-filters/mutations.test.ts
// Write-path validation: the shape validator every create/update goes through,
// and the reorder guards that keep `order` a total order within one inbox.
//
// Pure + a hand-rolled `db` — these functions take `db` as their first
// parameter, so nothing here needs the database module replaced (the shared
// `src/test/setup.ts` proxy stays in place, per the lib-test rule about never
// fully replacing `@auxx/database`).

import { describe, expect, it, vi } from 'vitest'
import { assertFilterShape, reorderMailFilters } from './mutations'
import type { MailFilterAction } from './types'

const archive: MailFilterAction = { type: 'set-status', status: 'ARCHIVED' }

describe('assertFilterShape — accepted', () => {
  it('accepts a named filter with one action', () => {
    expect(() => assertFilterShape({ name: 'Newsletters', actions: [archive] })).not.toThrow()
  })

  it('accepts run-agent when BOTH the agent and its trigger are set', () => {
    expect(() =>
      assertFilterShape({
        name: 'Triage',
        actions: [{ type: 'run-agent', agentId: 'agt_1', agentTriggerId: 'trg_1' }],
      })
    ).not.toThrow()
  })

  it('accepts every status in the mail vocabulary', () => {
    for (const status of ['OPEN', 'ARCHIVED', 'TRASH', 'SPAM'] as const) {
      expect(() =>
        assertFilterShape({ name: 'S', actions: [{ type: 'set-status', status }] })
      ).not.toThrow()
    }
  })
})

describe('assertFilterShape — rejected', () => {
  it('rejects an empty name', () => {
    expect(() => assertFilterShape({ name: '   ', actions: [archive] })).toThrow(/needs a name/)
  })

  it('rejects a filter with no actions', () => {
    expect(() => assertFilterShape({ name: 'Empty', actions: [] })).toThrow(/at least one action/)
  })

  it('rejects a non-array actions value', () => {
    expect(() =>
      assertFilterShape({ name: 'Bad', actions: 'archive' as unknown as MailFilterAction[] })
    ).toThrow(/at least one action/)
  })

  it('rejects an unknown action type', () => {
    expect(() =>
      assertFilterShape({
        name: 'Bad',
        actions: [{ type: 'delete-thread' } as unknown as MailFilterAction],
      })
    ).toThrow(/Unknown filter action/)
  })

  it('rejects RESOLVED — mail "done" is ARCHIVED, and ThreadUpdates has no RESOLVED', () => {
    expect(() =>
      assertFilterShape({
        name: 'Done',
        actions: [{ type: 'set-status', status: 'RESOLVED' } as unknown as MailFilterAction],
      })
    ).toThrow(/Unsupported filter status/)
  })

  it('rejects add-tag / remove-tag with no tags', () => {
    expect(() =>
      assertFilterShape({ name: 'T', actions: [{ type: 'add-tag', tagIds: [] }] })
    ).toThrow(/at least one tag/)
    expect(() =>
      assertFilterShape({ name: 'T', actions: [{ type: 'remove-tag', tagIds: [] }] })
    ).toThrow(/at least one tag/)
  })

  it('rejects assign without an assignee', () => {
    expect(() =>
      assertFilterShape({
        name: 'A',
        actions: [{ type: 'assign' } as unknown as MailFilterAction],
      })
    ).toThrow(/needs an assignee/)
  })

  it('rejects move-inbox without a destination', () => {
    expect(() =>
      assertFilterShape({
        name: 'M',
        actions: [{ type: 'move-inbox' } as unknown as MailFilterAction],
      })
    ).toThrow(/needs an inbox/)
  })

  it('rejects run-agent that carries only an agentId', () => {
    expect(() =>
      assertFilterShape({
        name: 'R',
        actions: [{ type: 'run-agent', agentId: 'agt_1' } as unknown as MailFilterAction],
      })
    ).toThrow(/an agent and a trigger/)
  })

  it('rejects run-workflow without a workflow', () => {
    expect(() =>
      assertFilterShape({
        name: 'W',
        actions: [{ type: 'run-workflow' } as unknown as MailFilterAction],
      })
    ).toThrow(/needs a workflow/)
  })
})

/** `select({id}).from().where().orderBy()` resolving to the inbox's filter ids. */
function fakeDb(existingIds: string[]) {
  const updates: { set: Record<string, unknown> }[] = []
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ set: values })
          },
        }),
      }),
    }
    await fn(tx)
  })

  return {
    updates,
    transaction,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: async () => existingIds.map((id) => ({ id })) }),
        }),
      }),
      transaction,
    } as never,
  }
}

describe('reorderMailFilters', () => {
  it('rejects an id that belongs to another inbox and writes nothing', async () => {
    const { db, transaction } = fakeDb(['flt_a', 'flt_b'])

    const result = await reorderMailFilters(db, 'org_1', 'ibx_1', ['flt_a', 'flt_foreign'])

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/does not belong to this inbox/)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a partial list — a half-rewrite collides with the untouched rows', async () => {
    const { db, transaction } = fakeDb(['flt_a', 'flt_b'])

    const result = await reorderMailFilters(db, 'org_1', 'ibx_1', ['flt_a'])

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/every filter in the inbox/)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids', async () => {
    const { db } = fakeDb(['flt_a', 'flt_b'])

    const result = await reorderMailFilters(db, 'org_1', 'ibx_1', ['flt_a', 'flt_a'])

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/duplicate/)
  })

  it('renumbers a complete list to its array positions in one transaction', async () => {
    const { db, updates, transaction } = fakeDb(['flt_a', 'flt_b', 'flt_c'])

    const result = await reorderMailFilters(db, 'org_1', 'ibx_1', ['flt_c', 'flt_a', 'flt_b'])

    expect(result.isOk()).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(updates.map((u) => u.set.order)).toEqual([0, 1, 2])
  })
})
