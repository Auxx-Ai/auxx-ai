// packages/lib/src/data-connectors/removed-upstream.test.ts
//
// The "Gone upstream" reads and the two human decisions (v12.1 Phases 3c and 5). What
// matters: every read scopes by org AND connector in SQL and excludes archived items;
// `unbindItem` deletes exactly one row under the org scope; and
// `requestArchiveCapOverride` refuses without a tripped stamp and, when it writes,
// MERGES one key into `DataConnector.state` with `jsonb_set` rather than replacing the
// column (the sync cursor lives there). The SQL is rendered through `PgDialect` so a
// rewrite to `set({ state: {...} })` fails the test; `removed-upstream.int.test.ts`
// proves the survival of an unrelated key against a real database.

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestError, NotFoundError } from '../errors'

// The default vitest setup mocks `@auxx/database` with an empty schema Proxy, under
// which a predicate built from a column renders as nothing. Re-mock with the real
// schema barrel (pure Drizzle, no connection) so the SQL text can be asserted.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../database/src/db/schema/index')
  const enums = await import('../../../database/src/enums')
  return { schema, ...enums, database: {} }
})

import type { Database } from '@auxx/database'
import {
  archiveCapTrippedOf,
  findRemovedUpstreamItem,
  listRemovedUpstreamItems,
} from './removed-upstream'
import { requestArchiveCapOverride, unbindItem } from './removed-upstream-mutations'

const render = (fragment: unknown) => new PgDialect().sqlToQuery(fragment as never)

const FLAGGED_AT = new Date('2026-09-09T02:00:00.000Z')

function flaggedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'item_1',
    externalId: 'gid://shopify/Product/1',
    entityDefinitionId: 'def_product',
    entityInstanceId: 'inst_1',
    removedUpstreamAt: FLAGGED_AT,
    lastSeenRunId: 'run_9',
    displayName: 'Widget',
    ...over,
  }
}

/** A `select().from().leftJoin().where().orderBy()|.limit()` chain resolving to `rows`. */
function selectDb(rows: unknown[]) {
  const captured: { where?: unknown } = {}
  const db = {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: (predicate: unknown) => {
            captured.where = predicate
            return {
              orderBy: () => Promise.resolve(rows),
              limit: () => Promise.resolve(rows),
            }
          },
        }),
      }),
    }),
  } as unknown as Database
  return { db, captured }
}

describe('listRemovedUpstreamItems', () => {
  it('scopes by org and connector, excludes archived rows, and only lists bound items', async () => {
    const { db, captured } = selectDb([])
    await listRemovedUpstreamItems(db, 'org_1', 'dc_1')
    const { sql, params } = render(captured.where)
    expect(sql).toContain('"organizationId" = $1')
    expect(sql).toContain('"dataConnectorId" = $2')
    expect(sql).toContain('"removedUpstreamAt" is not null')
    expect(sql).toContain('"archivedAt" is null')
    expect(sql).toContain('"entityInstanceId" is not null')
    expect(params).toEqual(['org_1', 'dc_1'])
  })

  it('maps the row and carries the record display name', async () => {
    const { db } = selectDb([flaggedRow()])
    const items = await listRemovedUpstreamItems(db, 'org_1', 'dc_1')
    expect(items).toEqual([
      {
        id: 'item_1',
        externalId: 'gid://shopify/Product/1',
        entityDefinitionId: 'def_product',
        entityInstanceId: 'inst_1',
        removedUpstreamAt: FLAGGED_AT,
        lastSeenRunId: 'run_9',
        displayName: 'Widget',
      },
    ])
  })

  it('drops a row with no bound instance rather than listing nothing to act on', async () => {
    const { db } = selectDb([flaggedRow({ entityInstanceId: null }), flaggedRow({ id: 'item_2' })])
    const items = await listRemovedUpstreamItems(db, 'org_1', 'dc_1')
    expect(items.map((i) => i.id)).toEqual(['item_2'])
  })
})

describe('findRemovedUpstreamItem', () => {
  it('adds the item id to the same scope and is a NotFound when nothing matches', async () => {
    const { db, captured } = selectDb([])
    const result = await findRemovedUpstreamItem(db, 'org_1', 'dc_1', 'item_1')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    const { sql, params } = render(captured.where)
    expect(sql).toContain('"id" = $1')
    expect(sql).toContain('"archivedAt" is null')
    expect(params).toEqual(['item_1', 'org_1', 'dc_1'])
  })

  it('returns the item when it is flagged under this org and connector', async () => {
    const { db } = selectDb([flaggedRow()])
    const result = await findRemovedUpstreamItem(db, 'org_1', 'dc_1', 'item_1')
    expect(result._unsafeUnwrap().entityInstanceId).toBe('inst_1')
  })
})

describe('unbindItem', () => {
  function deleteDb(returned: unknown[]) {
    const captured: { where?: unknown } = {}
    const db = {
      delete: () => ({
        where: (predicate: unknown) => {
          captured.where = predicate
          return { returning: () => Promise.resolve(returned) }
        },
      }),
    } as unknown as Database
    return { db, captured }
  }

  it('deletes the one row by id under the org scope', async () => {
    const { db, captured } = deleteDb([{ id: 'item_1' }])
    const result = await unbindItem(db, 'org_1', 'item_1')
    expect(result.isOk()).toBe(true)
    const { sql, params } = render(captured.where)
    expect(sql).toContain('"id" = $1')
    expect(sql).toContain('"organizationId" = $2')
    expect(params).toEqual(['item_1', 'org_1'])
  })

  it('is a NotFound when no row matched', async () => {
    const { db } = deleteDb([])
    const result = await unbindItem(db, 'org_1', 'item_missing')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('archiveCapTrippedOf', () => {
  it('reads the stamp off the untyped state and is null without one', () => {
    const tripped = { at: 'x', runId: 'r', orphans: 600, bound: 700, reason: 'why' }
    expect(archiveCapTrippedOf({ cursor: 'c', archiveCapTripped: tripped })).toEqual(tripped)
    expect(archiveCapTrippedOf({ cursor: 'c' })).toBeNull()
    expect(archiveCapTrippedOf(null)).toBeNull()
  })
})

describe('requestArchiveCapOverride', () => {
  const TRIPPED = {
    at: '2026-09-09T02:00:00.000Z',
    runId: 'run_9',
    orphans: 600,
    bound: 700,
    reason: 'more than 500 records vanished at once',
  }

  function updateDb(state: Record<string, unknown> | null, updated: unknown[]) {
    const captured: { set?: Record<string, unknown>; where?: unknown } = {}
    const db = {
      query: {
        DataConnector: {
          findFirst: vi.fn(async () => (state === null ? undefined : { state })),
        },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values
          return {
            where: (predicate: unknown) => {
              captured.where = predicate
              return { returning: () => Promise.resolve(updated) }
            },
          }
        },
      }),
    } as unknown as Database
    return { db, captured }
  }

  it('is a NotFound for a connector outside this org', async () => {
    const { db, captured } = updateDb(null, [])
    const result = await requestArchiveCapOverride(db, 'org_1', 'dc_1', 'user_1')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(captured.set).toBeUndefined()
  })

  it('refuses with a BadRequest when the cap has not tripped, without writing', async () => {
    const { db, captured } = updateDb({ cursor: 'c1' }, [])
    const result = await requestArchiveCapOverride(db, 'org_1', 'dc_1', 'user_1')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(captured.set).toBeUndefined()
  })

  it('merges ONE key with jsonb_set and never replaces the shared state column', async () => {
    const { db, captured } = updateDb({ cursor: 'c1', archiveCapTripped: TRIPPED }, [
      { id: 'dc_1' },
    ])
    const result = await requestArchiveCapOverride(db, 'org_1', 'dc_1', 'user_1')
    const override = result._unsafeUnwrap()
    expect(override.byUserId).toBe('user_1')
    expect(new Date(override.at).getTime()).not.toBeNaN()

    // A plain object here would be `set({ state: {...} })`: the cursor would be gone.
    const state = captured.set?.state
    expect(state).toHaveProperty('queryChunks')
    const { sql, params } = render(state)
    expect(sql).toContain('jsonb_set(coalesce(')
    expect(sql).toContain(`'{archiveCapOverride}'`)
    expect(sql).toContain('::jsonb, true)')
    expect(JSON.parse(String(params[0]))).toEqual(override)
    expect(sql).not.toContain('cursor')

    // The WHERE re-checks the stamp, so a clean pass racing this write wins.
    const where = render(captured.where)
    expect(where.sql).toContain('jsonb_exists(')
    expect(where.sql).toContain(`'archiveCapTripped'`)
    expect(where.params).toEqual(['dc_1', 'org_1'])
  })

  it('refuses when the stamp cleared between the read and the write', async () => {
    const { db } = updateDb({ cursor: 'c1', archiveCapTripped: TRIPPED }, [])
    const result = await requestArchiveCapOverride(db, 'org_1', 'dc_1', 'user_1')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })
})
