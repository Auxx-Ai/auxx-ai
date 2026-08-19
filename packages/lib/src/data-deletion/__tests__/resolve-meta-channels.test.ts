// packages/lib/src/data-deletion/__tests__/resolve-meta-channels.test.ts
//
// plans/channels/meta-data-deletion-callback.md §8.2 — the resolver has exactly
// ONE join key (`signed_request.user_id`), and one Facebook login legitimately
// fans out to several channels across several orgs. Verified against live rows:
// one user id -> a `facebook` AND an `instagram` channel in the same org, the IG
// row carrying the FACEBOOK id because both providers go through the same
// `upsertSocialIntegration`.
//
// The drizzle mock below is an EVALUATOR, not a passthrough: `and`/`or`/`eq`/
// `isNull`/`sql` build real predicates that the fake `select()` applies to
// in-memory rows, so "skips deletedAt IS NOT NULL" asserts the predicate the
// code actually builds rather than a filter the test wrote itself.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  // Column markers are the column NAME, so the fake `select()` below can index
  // a plain object row with whatever the module referenced.
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Integration: {
        id: 'id',
        organizationId: 'organizationId',
        provider: 'provider',
        name: 'name',
        metadata: 'metadata',
        deletedAt: 'deletedAt',
      },
    }),
  }
})

// Partial mock, never a full replacement — a full one dies at COLLECTION as
// soon as anything in the graph reaches another drizzle export.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  type Row = Record<string, any>
  type Pred = ((row: Row) => boolean) & { __expr?: { strings: string[]; values: unknown[] } }

  const eq = (col: string, value: unknown) => (row: Row) => row[col] === value
  const isNull = (col: string) => (row: Row) => row[col] == null
  const and =
    (...preds: Pred[]) =>
    (row: Row) =>
      preds.every((p) => p(row))
  const or =
    (...preds: Pred[]) =>
    (row: Row) =>
      preds.some((p) => p(row))

  /** Handles both `metadata ->> 'x' = $v` (predicate) and `metadata ->> 'x'` (projection). */
  const sql = (strings: TemplateStringsArray | string[], ...values: unknown[]) => {
    const fn: Pred = (row: Row) => {
      const key = /->>\s*'([^']+)'/.exec(strings[1] ?? '')?.[1]
      const column = values[0] as string
      return row[column]?.[key ?? ''] === values[1]
    }
    fn.__expr = { strings: Array.from(strings), values }
    return fn
  }

  return { ...actual, and, or, eq, isNull, sql }
})

import { resolveMetaChannels } from '../resolve'

type Row = Record<string, any>

function resolveProjection(projection: Record<string, any>, row: Row): Row {
  const out: Row = {}
  for (const [alias, expr] of Object.entries(projection)) {
    if (typeof expr === 'function' && expr.__expr) {
      const key = /->>\s*'([^']+)'/.exec(expr.__expr.strings[1] ?? '')?.[1]
      const column = expr.__expr.values[0] as string
      out[alias] = row[column]?.[key ?? ''] ?? null
    } else {
      out[alias] = row[expr as string]
    }
  }
  return out
}

function makeDb(rows: Row[]) {
  return {
    select: (projection: Record<string, any>) => ({
      from: () => ({
        where: (predicate: (row: Row) => boolean) =>
          Promise.resolve(rows.filter(predicate).map((row) => resolveProjection(projection, row))),
      }),
    }),
  } as any
}

const FB_USER_ID = '10175030062710640'
const ORG = 'abgwpa1l81reht2zmwrcihfu'

const liveRows: Row[] = [
  {
    id: 'int_fb',
    organizationId: ORG,
    provider: 'facebook',
    name: 'Auxx Lift',
    metadata: { userId: FB_USER_ID, pageId: '869289333164075', pageName: 'Auxx Lift' },
    deletedAt: null,
  },
  {
    id: 'int_ig',
    organizationId: ORG,
    provider: 'instagram',
    name: 'auxxlift',
    metadata: { userId: FB_USER_ID, pageId: '869289333164075', pageName: 'Auxx Lift' },
    deletedAt: null,
  },
]

describe('resolveMetaChannels', () => {
  it('returns BOTH the facebook and the linked instagram channel for one user id', async () => {
    const result = await resolveMetaChannels(makeDb(liveRows), FB_USER_ID)

    expect(result.isOk()).toBe(true)
    const channels = result._unsafeUnwrap()
    expect(channels).toHaveLength(2)
    expect(channels.map((c) => c.provider).sort()).toEqual(['facebook', 'instagram'])
    expect(channels.map((c) => c.integrationId).sort()).toEqual(['int_fb', 'int_ig'])
    expect(new Set(channels.map((c) => c.organizationId))).toEqual(new Set([ORG]))
  })

  it('spans multiple orgs — one login administering Pages in two organizations', async () => {
    const rows = [
      ...liveRows,
      {
        id: 'int_fb_other',
        organizationId: 'org_two',
        provider: 'facebook',
        name: 'Second Page',
        metadata: { userId: FB_USER_ID },
        deletedAt: null,
      },
    ]

    const channels = (await resolveMetaChannels(makeDb(rows), FB_USER_ID))._unsafeUnwrap()
    expect(channels).toHaveLength(3)
    expect(new Set(channels.map((c) => c.organizationId))).toEqual(new Set([ORG, 'org_two']))
  })

  it('skips rows with deletedAt IS NOT NULL', async () => {
    const rows: Row[] = [
      { ...liveRows[0] },
      { ...liveRows[1], id: 'int_ig_gone', deletedAt: new Date('2026-01-01') },
    ]

    const channels = (await resolveMetaChannels(makeDb(rows), FB_USER_ID))._unsafeUnwrap()
    expect(channels).toHaveLength(1)
    expect(channels[0]?.integrationId).toBe('int_fb')
  })

  it('skips other providers and other user ids', async () => {
    const rows = [
      ...liveRows,
      {
        id: 'int_gmail',
        organizationId: ORG,
        provider: 'google',
        name: 'Support',
        metadata: { userId: FB_USER_ID },
        deletedAt: null,
      },
      {
        id: 'int_fb_someone_else',
        organizationId: ORG,
        provider: 'facebook',
        name: 'Other',
        metadata: { userId: '999' },
        deletedAt: null,
      },
    ]

    const channels = (await resolveMetaChannels(makeDb(rows), FB_USER_ID))._unsafeUnwrap()
    expect(channels.map((c) => c.integrationId).sort()).toEqual(['int_fb', 'int_ig'])
  })

  it('returns an empty set (not an error) when nothing matches — the retry / already-gone case', async () => {
    const result = await resolveMetaChannels(makeDb([]), FB_USER_ID)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('falls back to metadata pageName when Integration.name is null', async () => {
    const rows: Row[] = [{ ...liveRows[0], name: null }]
    const channels = (await resolveMetaChannels(makeDb(rows), FB_USER_ID))._unsafeUnwrap()
    expect(channels[0]?.name).toBe('Auxx Lift')
  })
})
