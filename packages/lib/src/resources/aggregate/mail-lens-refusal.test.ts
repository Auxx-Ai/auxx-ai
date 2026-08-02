// packages/lib/src/resources/aggregate/mail-lens-refusal.test.ts
//
// Step 0.1, the aggregate entry point. `thread` and `message` were dashboard
// aggregate sources, and `buildSystemAggregateSql` emits `organizationId = $1`
// as its ENTIRE predicate — no `buildMailVisibilityPredicate`, no
// `isNull(mergedIntoThreadId)`. A chart/KPI/gauge over `thread` therefore
// aggregated the whole organization's mailbox for anyone who could open the
// dashboard, and a high-cardinality group-by (`subject`) printed the content
// itself, because the group LABELS are the raw column values.
//
// The assertion that matters is not "an error came back" — it's that NOTHING
// was touched on the way to that error: not Postgres, not the shared aggregate
// result cache (which is keyed without a viewer, so one warm entry would serve
// every member), not even the field cache. A refusal that runs after a probe is
// not a refusal.

import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fieldCacheReads: [] as string[],
  aggCacheReads: [] as string[],
  aggCacheWrites: [] as string[],
}))

vi.mock('../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResourceFields: async (_orgId: string, defId: string) => {
      h.fieldCacheReads.push(defId)
      return []
    },
    getAggregateCache: () => ({
      read: async (key: string) => {
        h.aggCacheReads.push(key)
        return null
      },
      write: async (key: string) => {
        h.aggCacheWrites.push(key)
      },
    }),
  }
})

import type { Database } from '@auxx/database'
import { ForbiddenError, UnprocessableEntityError } from '../../errors'
import { MAIL_LENS_TABLE_IDS } from '../picker/mail-lens-tables'
import { runAggregate, runKpi } from './run-aggregate'
import { buildSystemAggregateSql, SYSTEM_AGGREGATE_TABLE_IDS } from './system-aggregate-builder'
import type { AggregateQuery } from './types'

/**
 * A `db` that fails loudly on ANY use. The aggregate engine only ever reaches
 * Postgres through `db.transaction` (`executeAggregate`) and, for labels,
 * `db.select` / `db.query` — every one of them detonates here, so a passing test
 * is proof the mail-lens query never left the process.
 */
function explodingDb() {
  const boom = (what: string) => () => {
    throw new Error(`db.${what} must never be reached for a mail-lens aggregate`)
  }
  return new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'then') return undefined
        return boom(key)
      },
    }
  ) as unknown as Database
}

function reset() {
  h.fieldCacheReads.length = 0
  h.aggCacheReads.length = 0
  h.aggCacheWrites.length = 0
}

// `tableId` is widened to `string` on purpose: several cases pass ids the
// allowlist rejects, which is the behaviour under test.
const countQuery = (tableId: string): AggregateQuery => ({
  source: { kind: 'system', tableId } as AggregateQuery['source'],
  metric: { op: 'count' },
  timezone: 'UTC',
})

describe('the aggregate allowlist no longer names mail content', () => {
  it('SYSTEM_AGGREGATE_TABLE_IDS and MAIL_LENS_TABLE_IDS are disjoint', () => {
    for (const id of SYSTEM_AGGREGATE_TABLE_IDS) {
      expect(MAIL_LENS_TABLE_IDS.has(id)).toBe(false)
    }
    expect(SYSTEM_AGGREGATE_TABLE_IDS).not.toContain('thread')
    expect(SYSTEM_AGGREGATE_TABLE_IDS).not.toContain('message')
  })

  it('buildSystemAggregateSql refuses a mail table even when handed one directly', () => {
    for (const tableId of ['thread', 'message'] as const) {
      expect(() =>
        buildSystemAggregateSql({
          organizationId: 'org_1',
          // The production caller reaches this through a cast, so the runtime
          // guard is the one that counts.
          tableId: tableId as never,
          metric: { op: 'count' },
          // Widest possible scope — the refusal must not depend on it. `'all'`
          // is the article predicate's OFF position (plan v3/06 §5.6), so a
          // mail table cannot slip through by looking unrestricted.
          viewableKbIds: 'all',
          timezone: 'UTC',
          fetchCap: 100,
        })
      ).toThrow(ForbiddenError)
    }
  })
})

describe.each(['thread', 'message'] as const)('runAggregate refuses %s', (tableId) => {
  it('never queries the DB, the result cache, or the field cache', async () => {
    reset()
    const result = await runAggregate(explodingDb(), 'org_1', 'user_1', countQuery(tableId))

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(result._unsafeUnwrapErr().message).toMatch(/mail search tools/)
    expect(h.aggCacheReads).toEqual([])
    expect(h.aggCacheWrites).toEqual([])
    expect(h.fieldCacheReads).toEqual([])
  })

  it('refuses a group-by too — group labels ARE the column values', async () => {
    reset()
    const result = await runAggregate(explodingDb(), 'org_1', 'user_1', {
      ...countQuery(tableId),
      groupBy: { fieldRef: `${tableId}.subject` as never },
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(h.aggCacheReads).toEqual([])
  })

  it('refuses the entity-shaped source too — a client can post that shape', async () => {
    reset()
    const result = await runAggregate(explodingDb(), 'org_1', 'user_1', {
      source: { kind: 'entity', entityDefinitionId: tableId },
      metric: { op: 'count' },
      timezone: 'UTC',
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(h.fieldCacheReads).toEqual([])
  })
})

describe.each(['thread', 'message'] as const)('runKpi refuses %s', (tableId) => {
  it('a bare COUNT(*) over the org mailbox is still a disclosure', async () => {
    reset()
    const result = await runKpi(explodingDb(), 'org_1', 'user_1', { base: countQuery(tableId) })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(h.aggCacheReads).toEqual([])
    expect(h.aggCacheWrites).toEqual([])
  })

  it('a trend comparison does not open a second door', async () => {
    reset()
    const result = await runKpi(explodingDb(), 'org_1', 'user_1', {
      base: countQuery(tableId),
      trend: { compare: 'previousPeriod' },
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(h.aggCacheReads).toEqual([])
  })
})

describe('the refusal is scoped to mail content', () => {
  it('article is not refused — it fails later, on its own merits', async () => {
    reset()
    // The field cache stub answers `[]`, so `article` gets past the mail gate
    // and dies on "unknown source" instead. The point is the ERROR TYPE: a
    // ForbiddenError here would mean the gate had become a blanket ban on
    // system sources.
    const result = await runAggregate(explodingDb(), 'org_1', 'user_1', countQuery('article'))

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(result._unsafeUnwrapErr()).not.toBeInstanceOf(ForbiddenError)
    // It got far enough to consult the field registry — proof the gate passed it.
    expect(h.fieldCacheReads).toEqual(['article'])
  })

  it('an entity source is not refused either', async () => {
    reset()
    const result = await runAggregate(explodingDb(), 'org_1', 'user_1', {
      source: { kind: 'entity', entityDefinitionId: 'contact' },
      metric: { op: 'count' },
      timezone: 'UTC',
    })

    expect(result._unsafeUnwrapErr()).not.toBeInstanceOf(ForbiddenError)
    expect(h.fieldCacheReads).toEqual(['contact'])
  })
})
