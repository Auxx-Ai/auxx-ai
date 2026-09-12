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
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The completeness half's three subledger counts. Mocked because they read
// `FieldValue` through the org cache and this file's stub answers every query
// with the same rows; what is under test here is that the sweep CARRIES them,
// not how they are computed. They are only reached when a month is asked for.
const h = vi.hoisted(() => ({
  countUnpostedShipments:
    vi.fn<(db: unknown, params: { organizationId: string; month: string }) => Promise<unknown>>(),
  countUnissuedChannelCreditMemos:
    vi.fn<(db: unknown, params: { organizationId: string; month: string }) => Promise<number>>(),
  countUnpostedCreditMemos:
    vi.fn<(db: unknown, params: { organizationId: string; month: string }) => Promise<unknown>>(),
}))

vi.mock('../../money/fulfillment-posting/reads', () => ({
  countUnpostedShipments: h.countUnpostedShipments,
}))
vi.mock('../../money/credit-memos/reads', () => ({
  countUnissuedChannelCreditMemos: h.countUnissuedChannelCreditMemos,
}))
vi.mock('../../money/credit-memo-posting', () => ({
  countUnpostedCreditMemos: h.countUnpostedCreditMemos,
}))

import { err, ok } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { listFailedExports, verifyBooksBalance } from '../verify-balance'

beforeEach(() => {
  vi.clearAllMocks()
  h.countUnpostedShipments.mockResolvedValue(ok(0))
  h.countUnissuedChannelCreditMemos.mockResolvedValue(0)
  h.countUnpostedCreditMemos.mockResolvedValue(ok(0))
})

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
      // ⚠️ `null`, never `0`. No month was asked, so the completeness half was
      // never computed - and a `0` there would read as "nothing outstanding"
      // for a question nobody put.
      month: null,
      unpostedShipments: null,
      unissuedChannelCreditMemos: null,
      unpostedCreditMemos: null,
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
      month: null,
      unpostedShipments: null,
      unissuedChannelCreditMemos: null,
      unpostedCreditMemos: null,
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

/** One `GlPosting` row as the owed-export read selects it. */
function unpostedRow(overrides: {
  glPostingId: string
  periodKey: string
  exportStatus?: 'pending' | 'failed'
  postingType?: string
  docNumber?: string
  attempts?: number
  failureReason?: string | null
}) {
  return {
    glPostingId: overrides.glPostingId,
    periodKey: overrides.periodKey,
    postingType: overrides.postingType ?? 'month_end_inventory',
    exportStatus: overrides.exportStatus ?? 'pending',
    docNumber: overrides.docNumber ?? `GL-ME-${overrides.periodKey}`,
    attempts: overrides.attempts ?? 0,
    failureReason: overrides.failureReason ?? null,
  }
}

describe('listFailedExports', () => {
  it('returns nothing when every export has landed', async () => {
    const result = await listFailedExports(stubDb([]), ORG)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('keeps pending and failed distinct, with the reason and the attempt count', async () => {
    // They call for different actions. A banner that collapsed them into
    // "unposted" would send someone to the logs for a string already in the row
    // - and would also be lying, since both are IN the books.
    const result = await listFailedExports(
      stubDb([
        unpostedRow({ glPostingId: 'gl_p', periodKey: '2026-07', exportStatus: 'pending' }),
        unpostedRow({
          glPostingId: 'gl_f',
          periodKey: '2026-08',
          exportStatus: 'failed',
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
        exportStatus: 'pending',
        docNumber: 'GL-ME-2026-07',
        attempts: 0,
        failureReason: null,
      },
      {
        glPostingId: 'gl_f',
        periodKey: '2026-08',
        postingType: 'month_end_inventory',
        exportStatus: 'failed',
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
      const result = await listFailedExports(stubDb(rows), ORG, { through: '2026-07' })
      expect(result._unsafeUnwrap().map((r: { glPostingId: string }) => r.glPostingId)).toEqual([
        'gl_jun',
        'gl_jul_day',
      ])
    })

    it('bounds a day key by the month that contains it', async () => {
      // The comparison is `periodMonth` then `compareMonths`, never a raw string
      // compare - `'2026-07-18' <= '2026-07'` is false as a string and true as a
      // period, and the string answer would silently drop July's daily entries
      // from a July close.
      const result = await listFailedExports(stubDb(rows), ORG, { through: '2026-08' })
      expect(result._unsafeUnwrap().map((r: { glPostingId: string }) => r.glPostingId)).toEqual([
        'gl_jun',
        'gl_jul_day',
        'gl_aug',
      ])
    })

    it('accepts a day key as the bound and reads it as its month', async () => {
      const result = await listFailedExports(stubDb(rows), ORG, { through: '2026-07-02' })
      expect(result._unsafeUnwrap().map((r: { glPostingId: string }) => r.glPostingId)).toEqual([
        'gl_jun',
        'gl_jul_day',
      ])
    })

    it('returns everything when no bound is given', async () => {
      const result = await listFailedExports(stubDb(rows), ORG)
      expect(result._unsafeUnwrap()).toHaveLength(4)
    })

    it('keeps an unparseable period key regardless of the bound', async () => {
      // `GlPosting.periodKey` may hold a payout or build id, which cannot be
      // placed in a month at all. Under-reporting owed exports is the dangerous
      // direction: a bookkeeper who is not shown an entry closes without it.
      const result = await listFailedExports(
        stubDb([
          unpostedRow({ glPostingId: 'gl_payout', periodKey: 'payout_abc123' }),
          unpostedRow({ glPostingId: 'gl_dec', periodKey: '2026-12' }),
        ]),
        ORG,
        { through: '2026-07' }
      )
      expect(result._unsafeUnwrap().map((r: { glPostingId: string }) => r.glPostingId)).toEqual([
        'gl_payout',
      ])
    })

    it('refuses a malformed bound rather than silently matching nothing', async () => {
      const result = await listFailedExports(stubDb(rows), ORG, { through: 'last july' })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    })
  })

  it('returns err rather than throwing when the read fails', async () => {
    const result = await listFailedExports(throwingDb(new Error('connection reset')), ORG)
    expect(result.isErr()).toBe(true)
  })
})

// ── The completeness half (49 §2.4) ───────────────────────────────────────
//
// 🛑 Balance is not completeness, and the whole reason these counts ride on
// this report is that a screen showing only the first would report green books
// that are short a week of revenue.

describe('verifyBooksBalance completeness', () => {
  it('counts nothing, and asks nothing, without a month', async () => {
    const report = (await verifyBooksBalance(stubDb([]), ORG))._unsafeUnwrap()

    expect(report.month).toBeNull()
    expect(report.unpostedShipments).toBeNull()
    expect(report.unissuedChannelCreditMemos).toBeNull()
    expect(report.unpostedCreditMemos).toBeNull()
    expect(h.countUnpostedShipments).not.toHaveBeenCalled()
    expect(h.countUnissuedChannelCreditMemos).not.toHaveBeenCalled()
    expect(h.countUnpostedCreditMemos).not.toHaveBeenCalled()
  })

  it('carries all three counts for the month it was asked about', async () => {
    h.countUnpostedShipments.mockResolvedValue(ok(7))
    h.countUnissuedChannelCreditMemos.mockResolvedValue(2)
    h.countUnpostedCreditMemos.mockResolvedValue(ok(5))

    const report = (await verifyBooksBalance(stubDb([]), ORG, { month: '2026-08' }))._unsafeUnwrap()

    expect(report.month).toBe('2026-08')
    expect(report.unpostedShipments).toBe(7)
    expect(report.unissuedChannelCreditMemos).toBe(2)
    // 25 §9.1: the issued memo whose entry was never written. A different
    // question from the draft count above it, and neither covers the other.
    expect(report.unpostedCreditMemos).toBe(5)
    expect(h.countUnpostedShipments).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      month: '2026-08',
    })
    expect(h.countUnpostedCreditMemos).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      month: '2026-08',
    })
  })

  it('keeps the balance answer when a count fails, and reports the count as null', async () => {
    // ⚠️ Losing the report that proves the books tie, in order to report the one
    // that says they might be short, is the wrong trade in both directions.
    h.countUnpostedShipments.mockResolvedValue(err(new Error('the read is broken')))
    h.countUnpostedCreditMemos.mockResolvedValue(err(new Error('so is the netting read')))
    h.countUnissuedChannelCreditMemos.mockRejectedValue(new Error('so is the other one'))

    const result = await verifyBooksBalance(
      stubDb([
        groupedRow({ glPostingId: 'gl_1', debit: 100, credit: 100, recordedTotalMinor: 100 }),
      ]),
      ORG,
      { month: '2026-08' }
    )

    expect(result.isOk()).toBe(true)
    const report = result._unsafeUnwrap()
    expect(report.balanced).toBe(true)
    expect(report.postingsChecked).toBe(1)
    expect(report.unpostedShipments).toBeNull()
    expect(report.unissuedChannelCreditMemos).toBeNull()
    expect(report.unpostedCreditMemos).toBeNull()
  })
})
