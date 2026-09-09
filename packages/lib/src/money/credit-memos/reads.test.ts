// packages/lib/src/money/credit-memos/reads.test.ts
//
// `countUnissuedChannelCreditMemos` - the count the month-end close refuses on
// (10 §3.4, 49 §8.4 decision 7).
//
// Two properties, and both fail SILENTLY:
//
//  1. **The month is matched by SLICING `credit_memo_issued_at`, never by
//     re-zoning it.** `valueDate` is `timestamp(3) with time zone` in
//     `mode: 'string'`, so a stored day comes back `'2026-07-31 00:00:00+00'`.
//     The issue date IS the calendar day the memo's entry would post on, and
//     deriving a book-zone month here while the poster slices there would let
//     the close block a memo that posts into a different month, or wave through
//     one that does not.
//  2. **A missing field answers 0, not a crash.** An org that has never seeded
//     the `credit_memo` def has no `credit_memo_source` field at all, and a
//     close that threw there would be unclosable for a reason with nothing to
//     do with credit memos.
//
// The database is a scripted stub in the `bank-deposits/__tests__/reads.test.ts`
// shape: each awaited query takes the next queued result.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Attributes the org has a field for. Anything else resolves to `null`. */
  present: new Set<string>(),
  /** One array per awaited query, consumed in order. */
  results: [] as unknown[][],
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_org: string, slug: string) => `def_${slug}`,
  getOrgCache: () => ({
    get: async () => ({}),
    from: () => ({
      bySystemAttributes: async (attributes: string[]) =>
        Object.fromEntries(
          attributes.map((attribute) => [
            attribute,
            h.present.has(attribute) ? { id: `fld_${attribute}` } : null,
          ])
        ),
    }),
  }),
}))

const { countUnissuedChannelCreditMemos } = await import('./reads')

const ORG = 'org_1'

function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      self[method] = () => self
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.results[index++] ?? []).then(resolve, reject)
    return self
  }
  return { select: () => chain() } as unknown as Database
}

/** What postgres hands back for a `DATETIME` field value. */
function issuedAt(day: string) {
  return { valueDate: `${day} 00:00:00+00` }
}

beforeEach(() => {
  h.present = new Set([
    'credit_memo_status',
    'credit_memo_source',
    'credit_memo_issued_at',
    'credit_memo_contact',
  ])
  h.results = []
})

describe('countUnissuedChannelCreditMemos', () => {
  it('counts the channel drafts dated inside the month', async () => {
    // The SQL has already narrowed to status draft and source channel; what
    // comes back is one row per such memo, carrying its issue date.
    h.results = [[issuedAt('2026-07-02'), issuedAt('2026-07-31'), issuedAt('2026-07-15')]]

    await expect(
      countUnissuedChannelCreditMemos(stubDb(), { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(3)
  })

  it('ignores a draft dated in another month, including the neighbouring days', async () => {
    h.results = [
      [
        issuedAt('2026-06-30'),
        issuedAt('2026-07-01'),
        issuedAt('2026-08-01'),
        issuedAt('2027-07-05'),
      ],
    ]

    await expect(
      countUnissuedChannelCreditMemos(stubDb(), { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(1)
  })

  it('does not count a draft with no issue date at all', async () => {
    h.results = [[{ valueDate: null }, issuedAt('2026-07-09')]]

    await expect(
      countUnissuedChannelCreditMemos(stubDb(), { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(1)
  })

  it('answers 0 for a month with nothing outstanding', async () => {
    h.results = [[]]

    await expect(
      countUnissuedChannelCreditMemos(stubDb(), { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(0)
  })

  it('answers 0 without querying when the org has no credit memo fields', async () => {
    h.present = new Set()
    const db = stubDb()
    const select = vi.spyOn(db, 'select')

    await expect(
      countUnissuedChannelCreditMemos(db, { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('answers 0 when the org has the status field but not the source field', async () => {
    // A half-provisioned def. Counting on status alone would block the close on
    // every native draft, which 10 §3.4 explicitly exempts.
    h.present = new Set(['credit_memo_status', 'credit_memo_issued_at'])

    await expect(
      countUnissuedChannelCreditMemos(stubDb(), { organizationId: ORG, month: '2026-07' })
    ).resolves.toBe(0)
  })
})
