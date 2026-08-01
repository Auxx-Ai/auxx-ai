// packages/lib/src/ingest/threads/__tests__/resolve-thread.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Thread-splitting plan §Phase 3 — the resolution ladder that runs before the
 * Thread upsert on the hottest write path in the system.
 *
 * Every assertion here is about a way the ladder can be *wrong* rather than
 * slow: resolving to a hidden (merged-away) thread, honouring a `References`
 * entry over `In-Reply-To`, reaching across an organization boundary, or
 * applying header resolution to Gmail — which splits long conversations on
 * purpose and re-uses `References` across the halves.
 */

const h = vi.hoisted(() => ({
  /** Rows per table name, filtered through the predicate evaluator below. */
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  /** Every table `.from()`-ed, in order — lets a test assert a table was NOT read. */
  reads: [] as string[],
  /** Table whose read should blow up, to prove failures degrade to `null`. */
  throwOn: null as string | null,
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../test/database-mock'
  )
  const table = (name: string) =>
    new Proxy({}, { get: (_t, key) => `${name}.${String(key)}` }) as Record<string, unknown>
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock({
      Thread: table('Thread'),
      Message: table('Message'),
      ThreadExternalKey: table('ThreadExternalKey'),
      Integration: table('Integration'),
    }),
  }
})

// Partial mock — a full replacement of `drizzle-orm` dies at COLLECTION time in
// this package once the import graph grows. Only the predicate builders this
// module uses are swapped for inspectable plain objects.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    and: (...conds: unknown[]) => ({ op: 'and', conds: conds.filter(Boolean) }),
    eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
    isNull: (col: unknown) => ({ op: 'isNull', col }),
    inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
  }
})

import { resolveThreadId } from '../resolve-thread'

const ORG = 'org_1'
const INT = 'int_1'

/** `'Message.organizationId'` → `'organizationId'`. */
const field = (col: unknown) => String(col).split('.').slice(1).join('.')

function matches(row: Record<string, unknown>, pred: any): boolean {
  if (!pred || typeof pred !== 'object') return true
  switch (pred.op) {
    case 'and':
      return pred.conds.every((c: unknown) => matches(row, c))
    case 'eq':
      return row[field(pred.col)] === pred.value
    case 'isNull':
      return row[field(pred.col)] == null
    case 'inArray':
      return pred.values.includes(row[field(pred.col)])
    default:
      return true
  }
}

/** Minimal select-only Drizzle double backed by `h.rows`. */
function db() {
  return {
    select: () => {
      let table = ''
      let pred: unknown = null
      let lim: number | undefined
      const chain: any = {
        from(t: any) {
          table = String(t?.id ?? '').split('.')[0] ?? ''
          return chain
        },
        where(p: unknown) {
          pred = p
          return chain
        },
        limit(n: number) {
          lim = n
          return chain
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          try {
            h.reads.push(table)
            if (h.throwOn === table) throw new Error(`db exploded reading ${table}`)
            const all = (h.rows[table] ?? []).filter((r) => matches(r, pred))
            return Promise.resolve(lim === undefined ? all : all.slice(0, lim)).then(
              resolve,
              reject
            )
          } catch (error) {
            return Promise.reject(error).then(resolve, reject)
          }
        },
      }
      return chain
    },
  }
}

function ctx() {
  return {
    organizationId: ORG,
    db: db(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    providerByIntegrationId: new Map<string, string>(),
  } as any
}

function messageData(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    integrationId: INT,
    externalId: 'ext_1',
    externalThreadId: 'convB',
    subject: 'Re: Hello',
    isInbound: true,
    ...overrides,
  } as any
}

/** Integration row shaped for the `id = ? AND deletedAt IS NULL` probe. */
const integrationRow = (provider: string) => ({ id: INT, provider, deletedAt: null })

beforeEach(() => {
  h.rows = {}
  h.reads = []
  h.throwOn = null
})

describe('resolveThreadId — rung 1 (alias)', () => {
  it('returns the aliased thread without ever touching Message', async () => {
    h.rows.ThreadExternalKey = [{ integrationId: INT, externalId: 'convB', threadId: 't_1' }]
    h.rows.Thread = [{ id: 't_1', mergedIntoThreadId: null }]

    const result = await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))

    expect(result).toEqual({ threadId: 't_1', viaAlias: true })
    expect(h.reads).not.toContain('Message')
    expect(h.reads).not.toContain('Integration')
  })

  it('ignores an alias belonging to a different integration', async () => {
    h.rows.ThreadExternalKey = [
      { integrationId: 'int_other', externalId: 'convB', threadId: 't_1' },
    ]

    expect(await resolveThreadId(ctx(), messageData())).toBeNull()
  })
})

describe('resolveThreadId — rung 3 (header chain)', () => {
  beforeEach(() => {
    h.rows.ThreadExternalKey = []
    h.rows.Integration = [integrationRow('outlook')]
  })

  it('resolves In-Reply-To to the parent message thread', async () => {
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<m1>', threadId: 't_2' },
    ]
    h.rows.Thread = [{ id: 't_2', mergedIntoThreadId: null }]

    const result = await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))

    expect(result).toEqual({ threadId: 't_2', viaAlias: false })
  })

  it('walks a References-only chain newest → oldest', async () => {
    // RFC 5322 orders References oldest-first; the newest entry is the parent.
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<old@x>', threadId: 't_old' },
      { organizationId: ORG, integrationId: INT, internetMessageId: '<new@x>', threadId: 't_new' },
    ]
    h.rows.Thread = [
      { id: 't_old', mergedIntoThreadId: null },
      { id: 't_new', mergedIntoThreadId: null },
    ]

    const result = await resolveThreadId(
      ctx(),
      messageData({ references: '<old@x> <mid@x> <new@x>' })
    )

    expect(result).toEqual({ threadId: 't_new', viaAlias: false })
  })

  it('lets In-Reply-To beat a References entry when BOTH match', async () => {
    // Deliberately returned References-first: Postgres orders an `IN (…)` result
    // arbitrarily, so taking `rows[0]` would silently pick the wrong thread.
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<ref@x>', threadId: 't_ref' },
      {
        organizationId: ORG,
        integrationId: INT,
        internetMessageId: '<parent@x>',
        threadId: 't_parent',
      },
    ]
    h.rows.Thread = [
      { id: 't_ref', mergedIntoThreadId: null },
      { id: 't_parent', mergedIntoThreadId: null },
    ]

    const result = await resolveThreadId(
      ctx(),
      messageData({ inReplyTo: '<parent@x>', references: '<ref@x>' })
    )

    expect(result).toEqual({ threadId: 't_parent', viaAlias: false })
  })

  it('matches a bare-form internetMessageId as well as the bracketed one', async () => {
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: 'm1@x', threadId: 't_bare' },
    ]
    h.rows.Thread = [{ id: 't_bare', mergedIntoThreadId: null }]

    const result = await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1@x>' }))

    expect(result).toEqual({ threadId: 't_bare', viaAlias: false })
  })

  it('returns null when no candidate matches', async () => {
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<other>', threadId: 't_x' },
    ]

    expect(await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))).toBeNull()
  })

  it('does not reach across an organization boundary', async () => {
    h.rows.Message = [
      {
        organizationId: 'org_other',
        integrationId: INT,
        internetMessageId: '<m1>',
        threadId: 't_alien',
      },
    ]
    h.rows.Thread = [{ id: 't_alien', mergedIntoThreadId: null }]

    expect(await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))).toBeNull()
  })

  // `Thread` is keyed per-integration, so a thread has never spanned two of them.
  // Without this scope, two mailboxes connected as separate integrations in one
  // org and both on the same conversation would merge — and the caller's `set`
  // would then rewrite the thread's `inboxId`, moving it across a permission
  // boundary.
  it('does not reach across an integration boundary within the same org', async () => {
    h.rows.Message = [
      {
        organizationId: ORG,
        integrationId: 'int_other',
        internetMessageId: '<m1>',
        threadId: 't_other_mailbox',
      },
    ]
    h.rows.Thread = [{ id: 't_other_mailbox', mergedIntoThreadId: null }]

    expect(await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))).toBeNull()
  })

  it('skips the header chain entirely for a google integration', async () => {
    h.rows.Integration = [integrationRow('google')]
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<m1>', threadId: 't_gmail' },
    ]
    h.rows.Thread = [{ id: 't_gmail', mergedIntoThreadId: null }]

    expect(await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))).toBeNull()
    expect(h.reads).not.toContain('Message')
  })

  it('applies the header chain for an imap integration', async () => {
    h.rows.Integration = [integrationRow('imap')]
    h.rows.Message = [
      { organizationId: ORG, integrationId: INT, internetMessageId: '<m1>', threadId: 't_imap' },
    ]
    h.rows.Thread = [{ id: 't_imap', mergedIntoThreadId: null }]

    expect(await resolveThreadId(ctx(), messageData({ inReplyTo: '<m1>' }))).toEqual({
      threadId: 't_imap',
      viaAlias: false,
    })
  })

  it('never probes the provider when the message carries no threading headers', async () => {
    expect(await resolveThreadId(ctx(), messageData())).toBeNull()
    expect(h.reads).not.toContain('Integration')
    expect(h.reads).not.toContain('Message')
  })
})

describe('resolveThreadId — merged threads', () => {
  it('follows mergedIntoThreadId to the surviving thread', async () => {
    h.rows.ThreadExternalKey = [{ integrationId: INT, externalId: 'convB', threadId: 't_src' }]
    h.rows.Thread = [
      { id: 't_src', mergedIntoThreadId: 't_dst' },
      { id: 't_dst', mergedIntoThreadId: null },
    ]

    expect(await resolveThreadId(ctx(), messageData())).toEqual({
      threadId: 't_dst',
      viaAlias: true,
    })
  })

  it('does not loop forever on a merge cycle', async () => {
    h.rows.ThreadExternalKey = [{ integrationId: INT, externalId: 'convB', threadId: 't_a' }]
    h.rows.Thread = [
      { id: 't_a', mergedIntoThreadId: 't_b' },
      { id: 't_b', mergedIntoThreadId: 't_a' },
    ]

    expect(await resolveThreadId(ctx(), messageData())).toEqual({ threadId: 't_b', viaAlias: true })
  })

  it('returns null when the resolved thread no longer exists', async () => {
    h.rows.ThreadExternalKey = [{ integrationId: INT, externalId: 'convB', threadId: 't_gone' }]
    h.rows.Thread = []

    expect(await resolveThreadId(ctx(), messageData())).toBeNull()
  })
})

describe('resolveThreadId — failure handling', () => {
  it('degrades to null (today’s behaviour) instead of propagating a DB error', async () => {
    h.throwOn = 'ThreadExternalKey'
    const c = ctx()

    await expect(resolveThreadId(c, messageData())).resolves.toBeNull()
    expect(c.logger.error).toHaveBeenCalled()
  })
})
