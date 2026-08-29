// packages/lib/src/postings/__tests__/verify-balance.test.ts
//
// The third layer of the balance guarantee. `buildEntry` refuses to build an
// unbalanced entry and the poster re-asserts before commit, but both of those
// are assertions about a code path that ran. This sweep is an assertion about
// what is actually in the database - including rows written by an older version
// of that code, by a migration, or by hand - which is why it is the only one of
// the three that survives a bug in the other two.
//
// The database is a hand-written stub rather than a mock chain. The module makes
// two structurally different reads (a grouped LEFT JOIN and a flat ordered
// select), and the interesting cases here are about the SHAPE of the rows that
// come back - a header with no lines, an aggregate that arrives as a string -
// which a generic chainable spy cannot express.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'

import { BadRequestError } from '../../errors'
import { listUnpostedPeriods, verifyBooksBalance } from '../verify-balance'

const ORG = 'org_1'

/**
 * A stub `Database` that answers whatever chain is built with one row set.
 *
 * Every builder method returns the same thenable, so the stub does not care
 * whether the caller reaches the rows via `.groupBy()` or `.orderBy()`. What it
 * does care about is being awaitable exactly once per query, which is the
 * property the module relies on.
 */
function stubDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
    chain[method] = passthrough
  }
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)

  return { select: () => chain } as unknown as Database
}

/** A stub `Database` whose first read throws, to exercise the error arm. */
function throwingDb(error: unknown) {
  return {
    select: () => {
      throw error
    },
  } as unknown as Database
}

/**
 * One grouped row as Postgres hands it back.
 *
 * The aggregates are STRINGS on purpose: `SUM` over a `bigint` column returns
 * `numeric`, and node-postgres does not narrow that to a JS number. A test that
 * passed numbers here would pass while the real query compared `'500'` to `500`
 * and reported every single entry as a discrepancy.
 */
function groupedRow(overrides: {
  glPostingId: string
  debit: number
  credit: number
  recordedTotalMinor: number
  docNumber?: string
  postingType?: string
  periodKey?: string
}) {
  return {
    glPostingId: overrides.glPostingId,
    docNumber: overrides.docNumber ?? 'GL-ME-2026-08',
    postingType: overrides.postingType ?? 'month_end_inventory',
    periodKey: overrides.periodKey ?? '2026-08',
    recordedTotalMinor: overrides.recordedTotalMinor,
    totalDebitMinor: String(overrides.debit),
    totalCreditMinor: String(overrides.credit),
  }
}

describe('verifyBooksBalance', () => {
  it('reports an empty ledger as balanced, and says nothing was checked', async () => {
    const result = await verifyBooksBalance(stubDb([]), ORG)

    expect(result.isOk()).toBe(true)
    // "0 discrepancies out of 0" and "0 out of 412" are very different answers.
    // This is why the comparison is not a HAVING clause.
    expect(result._unsafeUnwrap()).toEqual({
      balanced: true,
      postingsChecked: 0,
      discrepancies: [],
    })
  })

  it('accepts an entry whose debits, credits and recorded total all agree', async () => {
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({
          glPostingId: 'gl_1',
          debit: 125_000,
          credit: 125_000,
          recordedTotalMinor: 125_000,
        }),
      ]),
      ORG
    )

    expect(result._unsafeUnwrap()).toEqual({
      balanced: true,
      postingsChecked: 1,
      discrepancies: [],
    })
  })

  it('coerces string aggregates rather than comparing them to numbers', async () => {
    // The regression this exists for: `'125000' === 125000` is false, so a
    // resolver that skipped the coercion would report a perfectly good ledger as
    // 100% unbalanced.
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({
          glPostingId: 'gl_1',
          debit: 125_000,
          credit: 125_000,
          recordedTotalMinor: 125_000,
        }),
      ]),
      ORG
    )
    expect(result._unsafeUnwrap().balanced).toBe(true)
  })

  it('flags an entry whose sides do not tie, carrying both totals', async () => {
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({
          glPostingId: 'gl_bad',
          debit: 125_000,
          credit: 120_000,
          recordedTotalMinor: 125_000,
          docNumber: 'GL-ME-2026-08',
          periodKey: '2026-08',
        }),
      ]),
      ORG
    )

    const report = result._unsafeUnwrap()
    expect(report.balanced).toBe(false)
    expect(report.postingsChecked).toBe(1)
    expect(report.discrepancies).toEqual([
      {
        glPostingId: 'gl_bad',
        docNumber: 'GL-ME-2026-08',
        postingType: 'month_end_inventory',
        periodKey: '2026-08',
        totalDebitMinor: 125_000,
        totalCreditMinor: 120_000,
        recordedTotalMinor: 125_000,
      },
    ])
  })

  it('flags an entry whose lines tie each other but not the header', async () => {
    // The lines balance, so a check that only compared the two sides would pass
    // this. The ledger and the entry disagree about how big the entry is, which
    // is a different corruption with the same invisibility.
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({ glPostingId: 'gl_hdr', debit: 100, credit: 100, recordedTotalMinor: 900 }),
      ]),
      ORG
    )

    const report = result._unsafeUnwrap()
    expect(report.balanced).toBe(false)
    expect(report.discrepancies[0]).toMatchObject({
      glPostingId: 'gl_hdr',
      totalDebitMinor: 100,
      totalCreditMinor: 100,
      recordedTotalMinor: 900,
    })
  })

  it('flags a posted header with no lines at all', async () => {
    // The LEFT JOIN case. Both sides coalesce to 0 and 0 = 0, so this reads as a
    // perfectly balanced entry unless the recorded total is part of the check.
    // An INNER JOIN would not even return the row.
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({ glPostingId: 'gl_empty', debit: 0, credit: 0, recordedTotalMinor: 125_000 }),
      ]),
      ORG
    )

    const report = result._unsafeUnwrap()
    expect(report.balanced).toBe(false)
    expect(report.discrepancies[0]).toMatchObject({
      glPostingId: 'gl_empty',
      totalDebitMinor: 0,
      totalCreditMinor: 0,
      recordedTotalMinor: 125_000,
    })
  })

  it('accepts a genuinely empty entry: 0 = 0 = 0', async () => {
    const result = await verifyBooksBalance(
      stubDb([groupedRow({ glPostingId: 'gl_zero', debit: 0, credit: 0, recordedTotalMinor: 0 })]),
      ORG
    )
    expect(result._unsafeUnwrap().balanced).toBe(true)
  })

  it('checks a reversal pair as two balanced entries, not one net-zero one', async () => {
    // Decision G4: a reversal is a second, opposite entry. The original is
    // `reversed` and still has to tie on its own; the reversal is `posted` and
    // ties on its own. Netting them would let two equal and opposite errors
    // cancel out.
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({
          glPostingId: 'gl_orig',
          debit: 125_000,
          credit: 125_000,
          recordedTotalMinor: 125_000,
          docNumber: 'GL-ME-2026-08',
        }),
        groupedRow({
          glPostingId: 'gl_rev',
          debit: 125_000,
          credit: 125_000,
          recordedTotalMinor: 125_000,
          docNumber: 'GL-ME-2026-08-R1',
        }),
      ]),
      ORG
    )

    const report = result._unsafeUnwrap()
    expect(report.balanced).toBe(true)
    expect(report.postingsChecked).toBe(2)
  })

  it('reports every offender, not the first', async () => {
    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({ glPostingId: 'gl_a', debit: 100, credit: 100, recordedTotalMinor: 100 }),
        groupedRow({ glPostingId: 'gl_b', debit: 100, credit: 90, recordedTotalMinor: 100 }),
        groupedRow({ glPostingId: 'gl_c', debit: 100, credit: 100, recordedTotalMinor: 50 }),
      ]),
      ORG
    )

    const report = result._unsafeUnwrap()
    expect(report.postingsChecked).toBe(3)
    expect(report.discrepancies.map((d) => d.glPostingId)).toEqual(['gl_b', 'gl_c'])
  })

  it('returns err rather than throwing when the read fails', async () => {
    const result = await verifyBooksBalance(throwingDb(new Error('connection reset')), ORG)
    expect(result.isErr()).toBe(true)
  })
})

/** One `GlPosting` row as the unposted read selects it. */
function unpostedRow(overrides: {
  glPostingId: string
  periodKey: string
  status?: 'pending' | 'failed'
  postingType?: string
  docNumber?: string
  attempts?: number
  failureReason?: string | null
}) {
  return {
    glPostingId: overrides.glPostingId,
    periodKey: overrides.periodKey,
    postingType: overrides.postingType ?? 'month_end_inventory',
    status: overrides.status ?? 'pending',
    docNumber: overrides.docNumber ?? `GL-ME-${overrides.periodKey}`,
    attempts: overrides.attempts ?? 0,
    failureReason: overrides.failureReason ?? null,
  }
}

describe('listUnpostedPeriods', () => {
  it('returns nothing when everything is posted', async () => {
    const result = await listUnpostedPeriods(stubDb([]), ORG)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('keeps pending and failed distinct, with the reason and the attempt count', async () => {
    // They call for different actions. A banner that collapsed them into
    // "unposted" would send someone to the logs for a string already in the row.
    const result = await listUnpostedPeriods(
      stubDb([
        unpostedRow({ glPostingId: 'gl_p', periodKey: '2026-07', status: 'pending' }),
        unpostedRow({
          glPostingId: 'gl_f',
          periodKey: '2026-08',
          status: 'failed',
          attempts: 3,
          failureReason: 'QuickBooks rate limit',
        }),
      ]),
      ORG
    )

    expect(result._unsafeUnwrap()).toEqual([
      {
        glPostingId: 'gl_p',
        periodKey: '2026-07',
        postingType: 'month_end_inventory',
        status: 'pending',
        docNumber: 'GL-ME-2026-07',
        attempts: 0,
        failureReason: null,
      },
      {
        glPostingId: 'gl_f',
        periodKey: '2026-08',
        postingType: 'month_end_inventory',
        status: 'failed',
        docNumber: 'GL-ME-2026-08',
        attempts: 3,
        failureReason: 'QuickBooks rate limit',
      },
    ])
  })

  describe('the `through` bound', () => {
    const rows = [
      unpostedRow({ glPostingId: 'gl_jun', periodKey: '2026-06' }),
      unpostedRow({ glPostingId: 'gl_jul_day', periodKey: '2026-07-18' }),
      unpostedRow({ glPostingId: 'gl_aug', periodKey: '2026-08' }),
      unpostedRow({ glPostingId: 'gl_sep_day', periodKey: '2026-09-01' }),
    ]

    it('is inclusive of the named month', async () => {
      const result = await listUnpostedPeriods(stubDb(rows), ORG, { through: '2026-07' })
      expect(result._unsafeUnwrap().map((r) => r.glPostingId)).toEqual(['gl_jun', 'gl_jul_day'])
    })

    it('bounds a day key by the month that contains it', async () => {
      // The comparison is `periodMonth` then `compareMonths`, never a raw string
      // compare - `'2026-07-18' <= '2026-07'` is false as a string and true as a
      // period, and the string answer would silently drop July's daily entries
      // from a July close.
      const result = await listUnpostedPeriods(stubDb(rows), ORG, { through: '2026-08' })
      expect(result._unsafeUnwrap().map((r) => r.glPostingId)).toEqual([
        'gl_jun',
        'gl_jul_day',
        'gl_aug',
      ])
    })

    it('accepts a day key as the bound and reads it as its month', async () => {
      const result = await listUnpostedPeriods(stubDb(rows), ORG, { through: '2026-07-02' })
      expect(result._unsafeUnwrap().map((r) => r.glPostingId)).toEqual(['gl_jun', 'gl_jul_day'])
    })

    it('returns everything when no bound is given', async () => {
      const result = await listUnpostedPeriods(stubDb(rows), ORG)
      expect(result._unsafeUnwrap()).toHaveLength(4)
    })

    it('keeps an unparseable period key regardless of the bound', async () => {
      // `GlPosting.periodKey` may hold a payout or build id, which cannot be
      // placed in a month at all. Under-reporting unposted work is the dangerous
      // direction: a bookkeeper who is not shown an entry closes without it.
      const result = await listUnpostedPeriods(
        stubDb([
          unpostedRow({ glPostingId: 'gl_payout', periodKey: 'payout_abc123' }),
          unpostedRow({ glPostingId: 'gl_dec', periodKey: '2026-12' }),
        ]),
        ORG,
        { through: '2026-07' }
      )
      expect(result._unsafeUnwrap().map((r) => r.glPostingId)).toEqual(['gl_payout'])
    })

    it('refuses a malformed bound rather than silently matching nothing', async () => {
      const result = await listUnpostedPeriods(stubDb(rows), ORG, { through: 'last july' })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    })
  })

  it('returns err rather than throwing when the read fails', async () => {
    const result = await listUnpostedPeriods(throwingDb(new Error('connection reset')), ORG)
    expect(result.isErr()).toBe(true)
  })
})
