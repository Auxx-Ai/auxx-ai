// packages/lib/src/accounting/money/__tests__/blocked-work.test.ts
//
// The Blocked tab over work items (91 §4.6): the Outbox's avenue filter narrowed to
// the categories that can park, the offset cursor, and the badge counting groups.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  groupCalls: [] as Array<Record<string, unknown>>,
  itemCalls: [] as Array<Record<string, unknown>>,
  groups: 0,
}))

vi.mock('../../work-items/reads', () => ({
  listWorkItemGroups: async (_db: unknown, _org: string, options: Record<string, unknown>) => {
    h.groupCalls.push(options)
    return ok({ items: [], nextOffset: (options.offset as number) + (options.limit as number) })
  },
  listWorkItemsInGroup: async (
    _db: unknown,
    _org: string,
    group: Record<string, unknown>,
    options: Record<string, unknown>
  ) => {
    h.itemCalls.push({ group, ...options })
    return ok({ items: [] })
  },
  countWorkItemGroups: async () => ok(h.groups),
}))

import type { Database } from '@auxx/database'
import { countBlockedWork, listBlockedWork, listBlockedWorkItems } from '../blocked-work'

const db = {} as Database
const GROUP = { reasonCode: 'ROLE_UNMAPPED', role: 'clearing', railId: 'pg_1', glAccountId: null }

beforeEach(() => {
  h.groupCalls = []
  h.itemCalls = []
  h.groups = 0
})

describe('listBlockedWork', () => {
  it('pages by offset and hands the next offset back as the cursor', async () => {
    const page = await listBlockedWork(db, 'org', { limit: 20, cursor: 40 })
    expect(h.groupCalls[0]).toMatchObject({ limit: 20, offset: 40 })
    expect(page._unsafeUnwrap()).toEqual({ items: [], nextCursor: 60 })
  })

  it('narrows the avenue filter to the categories that can park', async () => {
    await listBlockedWork(db, 'org', { limit: 20, categories: ['fulfillment', 'journal'] })
    expect(h.groupCalls[0]).toMatchObject({ categories: ['fulfillment'] })
  })

  it('reads nothing when every chosen category can never park', async () => {
    const page = await listBlockedWork(db, 'org', { limit: 20, categories: ['journal'] })
    expect(page._unsafeUnwrap()).toEqual({ items: [] })
    expect(h.groupCalls).toEqual([])
  })
})

describe('listBlockedWorkItems', () => {
  it('expands one group with the same filters', async () => {
    await listBlockedWorkItems(db, 'org', GROUP, { limit: 10, search: 'shop' })
    expect(h.itemCalls[0]).toMatchObject({ group: GROUP, limit: 10, offset: 0, search: 'shop' })
  })
})

describe('countBlockedWork', () => {
  it('counts groups, not items', async () => {
    h.groups = 3
    expect(await countBlockedWork(db, 'org')).toBe(3)
  })
})
