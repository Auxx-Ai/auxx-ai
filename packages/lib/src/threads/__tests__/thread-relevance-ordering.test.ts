// packages/lib/src/threads/__tests__/thread-relevance-ordering.test.ts
//
// Relevance ordering for mail free-text search.
//
// This file renders REAL SQL, which is why it declares its own `@auxx/database`
// mock: the global one in `src/test/setup.ts` hands out `{}` for every table, so
// `schema.Thread.subject` is `undefined` and any assertion about the rank
// expression would pass vacuously
// (`project_drizzle_columns_undefined_in_vitest`). `createSchemaMock` keeps the
// auto-vivification for every OTHER table the import graph touches at module
// scope, so pinning one table doesn't take the collection down.
//
// The sibling suite `thread-query.service.test.ts` partially mocks `drizzle-orm`
// and therefore cannot render anything; the two are deliberately separate.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ThreadTable } = await vi.hoisted(async () => {
  const { pgTable: table, text: textCol, timestamp: ts } = await import('drizzle-orm/pg-core')
  return {
    ThreadTable: table('Thread', {
      id: textCol('id').primaryKey(),
      organizationId: textCol('organizationId'),
      subject: textCol('subject'),
      searchText: textCol('searchText'),
      lastMessageAt: ts('lastMessageAt'),
    }),
  }
})

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({ Thread: ThreadTable }),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

// PARTIAL, not a replacement: `credentials/credential-lock.ts` binds
// `createCredentialLockProvider()` at MODULE SCOPE, so a factory that omits it
// kills this file at collection — reported as 0 tests, not as a failure.
// `importOriginal` cannot go stale the way an enumerated list does.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRedisClient: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../mail-views/mail-view-service', () => ({
  MailViewService: class {
    getMailView = vi.fn().mockResolvedValue(null)
  },
}))

// The predicate is not what this suite is about — it is pinned in
// `mail-query/__tests__/condition-query-builder.test.ts`. A fixed clause here
// keeps the rendered WHERE readable so the cursor arm is unambiguous.
vi.mock('../../mail-query/condition-query-builder', async () => {
  const { sql } = await import('drizzle-orm')
  return {
    buildConditionGroupsQuery: vi.fn(() => sql`"Thread"."organizationId" = 'org-1'`),
  }
})

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import type { ConditionGroup } from '../../conditions/types'
import type { UserInstanceGrants } from '../../permissions/visibility/context'
import { ThreadQueryService } from '../thread-query.service'
import { extractFreeTextSearchTerm } from '../thread-search-term'

const dialect = new PgDialect()

/** Renders any Drizzle SQL fragment to text so it can be asserted on. */
function render(fragment: unknown): string {
  return dialect.sqlToQuery(fragment as never).sql
}

/** A plain member viewer — no grants, no admin short-circuit. */
function viewer(): UserInstanceGrants {
  return {
    userId: 'user-123',
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
  }
}

function searchFilter(value: string): ConditionGroup[] {
  return [
    {
      id: 'search',
      logicalOperator: 'AND',
      conditions: [{ id: 'q', fieldId: 'freeText', operator: 'contains', value }],
    } as ConditionGroup,
  ]
}

function dateFilter(): ConditionGroup[] {
  return [
    {
      id: 'ctx',
      logicalOperator: 'AND',
      conditions: [{ id: 'ctx-status', fieldId: 'status', operator: 'is', value: 'open' }],
    } as ConditionGroup,
  ]
}

interface Capture {
  /** Every `where(...)` argument, in call order. Index 0 is the id query. */
  where: unknown[]
  /** Every `orderBy(...)` argument list, in call order. */
  orderBy: unknown[][]
  /** Every raw `db.execute(...)` fragment (the mixed threads+drafts path). */
  executed: unknown[]
}

/**
 * A Drizzle-shaped stand-in that records the clauses it is handed.
 *
 * `limit()` resolves from `pages`, so a test can hand page 1 more rows than the
 * limit and get a real `nextCursor` back. The builder itself is thenable so the
 * un-`limit`ed `COUNT(*)` query resolves too.
 */
function createCapturingDb(pages: Record<string, unknown>[][]) {
  const captured: Capture = { where: [], orderBy: [], executed: [] }
  let page = 0

  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    from: () => builder,
    where: (clause: unknown) => {
      captured.where.push(clause)
      return builder
    },
    orderBy: (...expressions: unknown[]) => {
      captured.orderBy.push(expressions)
      return builder
    },
    limit: () => Promise.resolve(pages[page++] ?? []),
    // A Drizzle query builder IS thenable — that is how the COUNT query in
    // `listThreadIds` (`await db.select().from().where()`, no terminal method)
    // resolves at all. The stand-in has to be thenable for the same reason.
    // biome-ignore lint/suspicious/noThenProperty: mirroring Drizzle's builder
    then: (resolve: (rows: unknown) => unknown) => resolve([{ count: 0 }]),
  })

  const db = {
    select: () => builder,
    execute: (fragment: unknown) => {
      captured.executed.push(fragment)
      return Promise.resolve({ rows: [] })
    },
  }

  return { db, captured }
}

describe('extractFreeTextSearchTerm', () => {
  it('finds the term wherever the caller put it', () => {
    expect(extractFreeTextSearchTerm(searchFilter('order refund'))).toBe('order refund')
  })

  it('reports no search when the filter carries no free text', () => {
    expect(extractFreeTextSearchTerm(dateFilter())).toBeNull()
    expect(extractFreeTextSearchTerm([])).toBeNull()
  })

  it('treats a value that tokenizes to nothing as no search', () => {
    // The predicate builds no clause for these, so nothing was narrowed and the
    // list must not flip into relevance order.
    expect(extractFreeTextSearchTerm(searchFilter('   '))).toBeNull()
    expect(extractFreeTextSearchTerm(searchFilter('""'))).toBeNull()
  })

  it('accepts any operator, because the predicate builder ignores it too', () => {
    const groups = [
      {
        id: 'search',
        logicalOperator: 'AND',
        conditions: [{ id: 'q', fieldId: 'freeText', operator: 'not contains', value: 'refund' }],
      } as ConditionGroup,
    ]
    expect(extractFreeTextSearchTerm(groups)).toBe('refund')
  })

  it('holds a quoted phrase together and concatenates multiple conditions', () => {
    const groups = [
      {
        id: 'search',
        logicalOperator: 'AND',
        conditions: [
          { id: 'a', fieldId: 'freeText', operator: 'contains', value: '"order number"' },
          { id: 'b', fieldId: 'freeText', operator: 'contains', value: 'refund' },
        ],
      } as ConditionGroup,
    ]
    expect(extractFreeTextSearchTerm(groups)).toBe('order number refund')
  })
})

describe('relevance ordering', () => {
  let captured: Capture
  let service: ThreadQueryService

  function build(pages: Record<string, unknown>[][] = [[]]) {
    const harness = createCapturingDb(pages)
    captured = harness.captured
    service = new ThreadQueryService('org-1', harness.db as never, viewer())
  }

  beforeEach(() => {
    vi.clearAllMocks()
    build()
  })

  it('orders newest-first when no search term is present', async () => {
    await service.listThreadIds({ filter: dateFilter(), userId: 'user-123' })

    const orderBy = captured.orderBy[0]!.map(render)
    expect(orderBy).toEqual(['"Thread"."lastMessageAt" desc', '"Thread"."id" desc'])
    expect(orderBy.join(' ')).not.toContain('ts_rank_cd')
  })

  it('orders best-first when a search term is present', async () => {
    await service.listThreadIds({ filter: searchFilter('order refund'), userId: 'user-123' })

    const orderBy = captured.orderBy[0]!.map(render)
    expect(orderBy).toHaveLength(2)
    expect(orderBy[0]).toContain('similarity("Thread"."subject"')
    expect(orderBy[0]).toContain(`ts_rank_cd(to_tsvector('english', COALESCE("Thread"."searchText"`)
    expect(orderBy[0]!.endsWith(' desc')).toBe(true)
    // Exactly (rank, id) — the shape `threadSearchCursor` can resume.
    expect(orderBy[1]).toBe('"Thread"."id" desc')
  })

  it('still orders newest-first when the search term is whitespace only', async () => {
    await service.listThreadIds({ filter: searchFilter('  '), userId: 'user-123' })

    expect(captured.orderBy[0]!.map(render)).toEqual([
      '"Thread"."lastMessageAt" desc',
      '"Thread"."id" desc',
    ])
  })

  it('lets an explicit column sort beat relevance', async () => {
    await service.listThreadIds({
      filter: searchFilter('order refund'),
      sort: { field: 'subject', direction: 'asc' },
      userId: 'user-123',
    })

    const orderBy = captured.orderBy[0]!.map(render)
    expect(orderBy).toEqual(['"Thread"."subject" asc', '"Thread"."id" asc'])
    expect(orderBy.join(' ')).not.toContain('ts_rank_cd')
  })

  it('lets an explicit non-default date direction beat relevance', async () => {
    await service.listThreadIds({
      filter: searchFilter('order refund'),
      sort: { field: 'lastMessageAt', direction: 'asc' },
      userId: 'user-123',
    })

    expect(captured.orderBy[0]!.map(render)).toEqual([
      '"Thread"."lastMessageAt" asc',
      '"Thread"."id" asc',
    ])
  })

  it('treats the mail list’s always-sent default descriptor as no preference', async () => {
    // `mail-box.tsx` sends this on every request, so it cannot mean "the user
    // chose Newest First" — see `isDefaultSort`.
    await service.listThreadIds({
      filter: searchFilter('order refund'),
      sort: { field: 'lastMessageAt', direction: 'desc' },
      userId: 'user-123',
    })

    expect(render(captured.orderBy[0]![0])).toContain('ts_rank_cd')
  })
})

describe('relevance keyset pagination', () => {
  it('carries the score in the cursor and resumes from it on page 2', async () => {
    const filter = searchFilter('order refund')

    // Page 1: limit 2, three rows back, so the third mints the cursor.
    const page1 = createCapturingDb([
      [
        { id: 'thread-a', lastMessageAt: new Date(), sortValue: 0.9 },
        { id: 'thread-b', lastMessageAt: new Date(), sortValue: 0.5 },
        { id: 'thread-c', lastMessageAt: new Date(), sortValue: 0.25 },
      ],
    ])
    const service1 = new ThreadQueryService('org-1', page1.db as never, viewer())
    const first = await service1.listThreadIds({ filter, limit: 2, userId: 'user-123' })

    expect(first.ids).toEqual(['thread:thread-a', 'thread:thread-b'])
    expect(first.nextCursor).toBeTruthy()

    const decoded = (service1 as never as { decodeCursor(c: string): unknown }).decodeCursor(
      first.nextCursor!
    )
    expect(decoded).toMatchObject({ field: 'relevance', direction: 'desc', id: 'thread-c' })
    // The score, not a date — the rank is not stored anywhere else.
    expect((decoded as { value: string }).value).toBe('0.25')

    // Page 2: the SAME filter is re-sent alongside the cursor (tRPC's infinite
    // query merges `pageParam` into the original input), so the rank can be
    // recomputed from the same term.
    const page2 = createCapturingDb([
      [{ id: 'thread-c', lastMessageAt: new Date(), sortValue: 0.25 }],
    ])
    const service2 = new ThreadQueryService('org-1', page2.db as never, viewer())
    const second = await service2.listThreadIds({
      filter,
      limit: 2,
      cursor: first.nextCursor!,
      userId: 'user-123',
    })

    expect(second.ids).toEqual(['thread:thread-c'])
    expect(second.nextCursor).toBeNull()

    // The ordering is unchanged across the page boundary...
    const orderBy = page2.captured.orderBy[0]!.map(render)
    expect(orderBy[0]).toContain('ts_rank_cd')
    expect(orderBy[1]).toBe('"Thread"."id" desc')

    // ...and the WHERE gained the keyset arm, recomputing the rank rather than
    // referencing a select alias (a Postgres WHERE cannot see output aliases).
    const where = render(page2.captured.where[0])
    expect(where).toContain('ts_rank_cd')
    expect(where).toContain('"Thread"."id" < ')
    expect(where).toMatch(/\) < \$\d+ OR \(/)
  })

  it('drops a relevance cursor whose score cannot be recovered', async () => {
    const harness = createCapturingDb([[]])
    const service = new ThreadQueryService('org-1', harness.db as never, viewer())
    const encode = (service as never as { encodeCursor(s: unknown, r: unknown): string })
      .encodeCursor

    const broken = encode.call(
      service,
      { field: 'relevance', direction: 'desc' },
      { id: 'thread-x', sortValue: null }
    )

    await service.listThreadIds({
      filter: searchFilter('order refund'),
      cursor: broken,
      userId: 'user-123',
    })

    // No `id <` tie-break smuggled in: an id-only keyset under relevance
    // ordering drops rows silently. Re-serving page 1 is the visible failure.
    const where = render(harness.captured.where[0])
    expect(where).not.toContain('"Thread"."id" <')
  })

  it('still decodes a v1 cursor minted before relevance existed', () => {
    const harness = createCapturingDb([[]])
    const service = new ThreadQueryService('org-1', harness.db as never, viewer())

    // Byte-for-byte what `encodeCursor` produced on `main` at 96db55769.
    const legacy = `v1:${Buffer.from(
      JSON.stringify({
        field: 'lastMessageAt',
        direction: 'desc',
        id: 'thread-legacy',
        value: '2026-07-30T12:00:00.000Z',
      }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}`

    const decoded = (service as never as { decodeCursor(c: string): unknown }).decodeCursor(legacy)
    expect(decoded).toEqual({
      field: 'lastMessageAt',
      direction: 'desc',
      id: 'thread-legacy',
      value: '2026-07-30T12:00:00.000Z',
    })
  })
})

describe('mixed threads + drafts path', () => {
  it('stays on lastMessageAt even when a search is active', async () => {
    const harness = createCapturingDb([[]])
    const service = new ThreadQueryService('org-1', harness.db as never, viewer())

    const filter: ConditionGroup[] = [
      {
        id: 'ctx',
        logicalOperator: 'AND',
        conditions: [{ id: 'ctx-hasDraft', fieldId: 'hasDraft', operator: 'is', value: true }],
      } as ConditionGroup,
      ...searchFilter('order refund'),
    ]

    await service.listThreadIds({ filter, userId: 'user-123' })

    // The union runs through `db.execute`, not the Drizzle builder.
    expect(harness.captured.orderBy).toHaveLength(0)
    expect(harness.captured.executed).toHaveLength(1)

    const unionSql = render(harness.captured.executed[0])
    expect(unionSql).toContain('"sortDate"')
    expect(unionSql).not.toContain('ts_rank_cd')
    // Standalone drafts are still unioned in — the decision is about ordering,
    // not about dropping rows.
    expect(unionSql).toContain('FROM "Draft"')
  })
})
