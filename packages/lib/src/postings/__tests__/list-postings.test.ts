// packages/lib/src/postings/__tests__/list-postings.test.ts

import { describe, expect, it, vi } from 'vitest'
import { listPostings } from '../list-postings'

/**
 * `listPostings` takes an OPTIONAL month, and the three cases must stay
 * distinguishable.
 *
 * 🛑 The one that matters: "no month given" and "the month you gave is not a
 * month" must never produce the same answer. An org whose accounting is
 * finalized with a cutoff in the future resolves no period at all, and the
 * ledger page's Entries section is the only door to a manual journal entry, so
 * an absent month has to widen to the whole ledger. But a TYPO in a period key
 * widening the same way would silently show a bookkeeper twelve months of
 * postings under an August heading, so a malformed value still refuses.
 */

/** A `db` that records the query it was handed and returns no rows. */
function recordingDb() {
  const calls: { where: unknown; limit: number }[] = []
  const builder = {
    from: () => builder,
    where(condition: unknown) {
      calls.push({ where: condition, limit: 0 })
      return builder
    },
    orderBy: () => builder,
    limit(value: number) {
      const last = calls[calls.length - 1]
      if (last) last.limit = value
      return Promise.resolve([])
    },
  }
  return { db: { select: () => builder } as never, calls }
}

describe('listPostings', () => {
  it('accepts a well-formed month', async () => {
    const { db } = recordingDb()
    const result = await listPostings(db, { organizationId: 'org-1', periodKey: '2026-08' })
    expect(result.isOk()).toBe(true)
  })

  it('accepts NO month, and reads the whole ledger rather than nothing', async () => {
    const { db } = recordingDb()
    const result = await listPostings(db, { organizationId: 'org-1' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('treats an explicit null the same as absent', async () => {
    const { db } = recordingDb()
    const result = await listPostings(db, { organizationId: 'org-1', periodKey: null })
    expect(result.isOk()).toBe(true)
  })

  it('still REFUSES a malformed month, which is what keeps a typo from widening', async () => {
    const { db } = recordingDb()
    for (const bad of ['2026-13', 'August', '2026', '2026-8', '']) {
      const result = await listPostings(db, { organizationId: 'org-1', periodKey: bad })
      expect(result.isErr(), `"${bad}" should refuse`).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('not an accounting month')
    }
  })

  it('narrows the query when a month is given and does not when it is not', async () => {
    // The date bounds are two extra conditions on the same `and(...)`. Comparing
    // the serialised shapes is enough to show the month is doing something,
    // without asserting on drizzle's internal AST.
    const scoped = recordingDb()
    await listPostings(scoped.db, { organizationId: 'org-1', periodKey: '2026-08' })
    const all = recordingDb()
    await listPostings(all.db, { organizationId: 'org-1' })

    expect(scoped.calls).toHaveLength(1)
    expect(all.calls).toHaveLength(1)
    expect(JSON.stringify(scoped.calls[0]?.where)).not.toBe(JSON.stringify(all.calls[0]?.where))
  })

  it('caps an unscoped read with the same limit a scoped one uses', async () => {
    const { db, calls } = recordingDb()
    await listPostings(db, { organizationId: 'org-1' })
    expect(calls[0]?.limit).toBe(200)
  })

  it('honours an explicit limit with no month', async () => {
    const { db, calls } = recordingDb()
    await listPostings(db, { organizationId: 'org-1', limit: 5 })
    expect(calls[0]?.limit).toBe(5)
  })
})

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
