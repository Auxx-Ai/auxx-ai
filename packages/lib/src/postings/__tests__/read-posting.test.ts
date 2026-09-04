// packages/lib/src/postings/__tests__/read-posting.test.ts
//
// `getPosting` is the drawer's only source of truth about a posted entry, and
// almost every way it could be wrong is a way that LOOKS right on screen. So
// these are mostly tests about what it must NOT do:
//
//  1. It must not re-derive the assertions. The stored `draft` carries what the
//     world looked like when the entry was posted, and a reversal SWAPS that
//     pair rather than recomputing it - re-reading the subledger would make a
//     reversed month render as though it had never been reversed.
//  2. It must not join the live chart for `accountName`. That column is a
//     snapshot; improving it would silently restate history the moment somebody
//     renames an account.
//  3. It must not leak across organizations, and "not yours" must be
//     indistinguishable from "does not exist".
//
// The database is a hand-written stub rather than a mock chain, for the reason
// `resolve-roles.test.ts` gives: the module issues two distinct reads against
// two tables and each has to answer differently. The stub identifies the table
// by REFERENCE (the `@auxx/database` mock in `src/test/setup.ts` memoizes
// `schema.*`, so identity is stable) and applies the org/id filter itself out of
// the parameters the module actually passed - which is what makes the cross-org
// test a real test rather than a stub returning what it was told to.

import { type Database, schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../../errors'
import { getPosting, readPostingLineSourceIds } from '../read-posting'

const ORG = 'org_1'
const OTHER_ORG = 'org_2'

interface PostingRow {
  id: string
  organizationId: string
  postingType: string
  periodKey: string
  txnDate: string
  docNumber: string
  status: string
  revision: number
  reversesId: string | null
  currency: string
  totalMinor: number
  draft: unknown
  providerId: string | null
  providerEntryId: string | null
  postedAt: Date | null
  postedByUserId: string | null
  failureReason: string | null
  attempts: number
  createdAt: Date
}

interface LineRow {
  id: string
  organizationId: string
  glPostingId: string
  lineNumber: number
  accountCode: string
  accountRole: string | null
  accountName: string | null
  direction: string
  amountMinor: number
  memo: string | null
  sourceType: string
  sourceId: string
}

/**
 * Every scalar the module put into a `where` clause, flattened.
 *
 * Under the `@auxx/database` mock a schema column is `undefined`, so Drizzle's
 * `eq(column, value)` pushes the value into `queryChunks` raw rather than
 * wrapping it in a `Param`. Both forms are handled, plus arrays (`inArray`),
 * so the stub can filter on what the caller actually asked for.
 */
function whereValues(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) whereValues(child, out, depth + 1)
    return out
  }
  const obj = node as Record<string, unknown>
  if ('value' in obj) whereValues(obj.value, out, depth + 1)
  if (Array.isArray(obj.queryChunks)) whereValues(obj.queryChunks, out, depth + 1)
  return out
}

interface Stub {
  db: Database
  /** How many reads were issued. Two is the contract; three would be an N+1. */
  reads(): number
}

function stubDb(data: { postings: PostingRow[]; lines: LineRow[] }): Stub {
  let reads = 0

  const db = {
    select: () => ({
      from: (table: unknown) => {
        reads++
        const isPosting = table === schema.GlPosting
        let params: string[] = []
        let ordered = false

        const chain: any = {
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          limit: () => chain,
          // The stub only sorts when the module ASKED it to. A scrambled fixture
          // therefore comes back scrambled unless `getPosting` called `orderBy`,
          // which is what makes the ordering test test the query and not the stub.
          orderBy: () => {
            ordered = true
            return chain
          },
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
            const rows = isPosting
              ? data.postings.filter(
                  (row) => params.includes(row.organizationId) && params.includes(row.id)
                )
              : data.lines.filter(
                  (row) => params.includes(row.organizationId) && params.includes(row.glPostingId)
                )
            const result =
              !isPosting && ordered
                ? [...rows].sort((a, b) => (a as LineRow).lineNumber - (b as LineRow).lineNumber)
                : rows
            return Promise.resolve(result).then(resolve, reject)
          },
        }
        return chain
      },
    }),
  } as unknown as Database

  return { db, reads: () => reads }
}

const DRAFT = {
  v: 1,
  postingType: 'month_end_inventory',
  assertions: {
    before: { inventoryRawMaterialsMinor: 1000 },
    after: { inventoryRawMaterialsMinor: 2500 },
  },
}

const POSTING: PostingRow = {
  id: 'gp_1',
  organizationId: ORG,
  postingType: 'month_end_inventory',
  periodKey: '2026-08',
  txnDate: '2026-08-31',
  docNumber: 'AUXX-ME-202608',
  status: 'posted',
  revision: 0,
  reversesId: null,
  currency: 'USD',
  totalMinor: 250_000,
  draft: DRAFT,
  providerId: 'quickbooks',
  providerEntryId: 'qbo_991',
  postedAt: new Date('2026-09-01T04:12:00.000Z'),
  postedByUserId: 'usr_1',
  failureReason: null,
  attempts: 1,
  createdAt: new Date('2026-09-01T04:11:59.000Z'),
}

function line(overrides: Partial<LineRow> & { lineNumber: number }): LineRow {
  return {
    id: `gpl_${overrides.lineNumber}`,
    organizationId: ORG,
    glPostingId: 'gp_1',
    accountCode: '1310',
    accountRole: 'inventory_raw_materials',
    accountName: 'Inventory - Raw Materials',
    direction: 'debit',
    amountMinor: 125_000,
    memo: null,
    sourceType: 'stock_movement',
    sourceId: 'sm_1',
    ...overrides,
  }
}

describe('getPosting - the header', () => {
  it('returns every column the drawer renders', async () => {
    const stub = stubDb({ postings: [POSTING], lines: [] })
    const result = await getPosting(stub.db, ORG, 'gp_1')

    expect(result.isOk()).toBe(true)
    const detail = result._unsafeUnwrap()
    expect(detail).toMatchObject({
      id: 'gp_1',
      postingType: 'month_end_inventory',
      periodKey: '2026-08',
      docNumber: 'AUXX-ME-202608',
      status: 'posted',
      revision: 0,
      reversesId: null,
      currency: 'USD',
      providerId: 'quickbooks',
      providerEntryId: 'qbo_991',
      postedByUserId: 'usr_1',
      failureReason: null,
      attempts: 1,
      lines: [],
    })
  })

  // A Postgres `date` carries no time and no zone. Turning it into an instant
  // renders a month-end entry as the previous month for any reader west of UTC,
  // which is the one presentation bug a bookkeeper cannot argue with.
  it('keeps txnDate as YYYY-MM-DD and serialises timestamps as ISO', async () => {
    const stub = stubDb({ postings: [POSTING], lines: [] })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.txnDate).toBe('2026-08-31')
    expect(detail.postedAt).toBe('2026-09-01T04:12:00.000Z')
    expect(detail.createdAt).toBe('2026-09-01T04:11:59.000Z')
  })

  it('returns nulls as nulls rather than as undefined', async () => {
    const stub = stubDb({
      postings: [
        {
          ...POSTING,
          providerId: null,
          providerEntryId: null,
          postedAt: null,
          postedByUserId: null,
          failureReason: 'QuickBooks said 6140',
        },
      ],
      lines: [],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.providerId).toBeNull()
    expect(detail.providerEntryId).toBeNull()
    expect(detail.postedAt).toBeNull()
    expect(detail.postedByUserId).toBeNull()
    expect(detail.failureReason).toBe('QuickBooks said 6140')
  })

  // 🛑 The header's own recorded total, never SUM(lines). If the two disagree
  // that is a real corruption and `verifyBooksBalance` reports it - summing here
  // would paper it over in the one view a person opens to investigate.
  it('returns the recorded total rather than the sum of the lines', async () => {
    const stub = stubDb({
      postings: [{ ...POSTING, totalMinor: 250_000 }],
      lines: [line({ lineNumber: 1, amountMinor: 1 })],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()
    expect(detail.totalMinor).toBe(250_000)
  })
})

describe('getPosting - the lines', () => {
  it('returns them in lineNumber order, having asked the database to order them', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [
        line({ lineNumber: 3, accountCode: '2160' }),
        line({ lineNumber: 1, accountCode: '1310' }),
        line({ lineNumber: 2, accountCode: '5000' }),
      ],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3])
    expect(detail.lines.map((l) => l.accountCode)).toEqual(['1310', '5000', '2160'])
  })

  // 🛑 `accountName` is frozen at posting time. Joining the live chart to
  // "improve" it would restate last year's ledger the moment somebody renames an
  // account - the exact failure decision G8 stores `accountRole` to prevent.
  it('returns the stored account name snapshot and the role beside it', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [
        line({
          lineNumber: 1,
          accountCode: '2160',
          accountRole: 'grni',
          accountName: 'Goods Received Not Invoiced (as it was named then)',
        }),
      ],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.lines[0]?.accountName).toBe('Goods Received Not Invoiced (as it was named then)')
    expect(detail.lines[0]?.accountRole).toBe('grni')
  })

  it('tolerates a legacy line with no role and no name', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [line({ lineNumber: 1, accountRole: null, accountName: null, memo: null })],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.lines[0]?.accountRole).toBeNull()
    expect(detail.lines[0]?.accountName).toBeNull()
    expect(detail.lines[0]?.memo).toBeNull()
  })

  it('carries the source pair that makes the line explainable later', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [line({ lineNumber: 1, sourceType: 'vendor_bill', sourceId: 'vb_9' })],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.lines[0]).toMatchObject({ sourceType: 'vendor_bill', sourceId: 'vb_9' })
  })

  // Two reads: the header, then all of its lines. A third would mean either an
  // N+1 over the lines or a join to the live chart, and both are forbidden.
  it('issues exactly two reads, whatever the line count', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [1, 2, 3, 4, 5].map((lineNumber) => line({ lineNumber })),
    })
    await getPosting(stub.db, ORG, 'gp_1')
    expect(stub.reads()).toBe(2)
  })
})

describe('getPosting - the stored draft', () => {
  // 🛑 The whole reason this reader exists in the shape it does. Task 09's
  // contract is that a posted entry asserts what the world looked like WHEN IT
  // WAS POSTED; a reversal swaps the pair rather than recomputing it.
  it('returns the stored envelope verbatim, assertions included', async () => {
    const stub = stubDb({ postings: [POSTING], lines: [] })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.draft).toBe(DRAFT)
    expect(detail.draft).toEqual({
      v: 1,
      postingType: 'month_end_inventory',
      assertions: {
        before: { inventoryRawMaterialsMinor: 1000 },
        after: { inventoryRawMaterialsMinor: 2500 },
      },
    })
  })

  // Parsing is the caller's decision, not this reader's: a caller that only
  // wants to hand the blob to an auditor must not be forced through a validator
  // that could refuse a legacy row.
  it('does not parse or validate the envelope', async () => {
    const junk = { v: 99, nothing: 'the schema recognises' }
    const stub = stubDb({ postings: [{ ...POSTING, draft: junk }], lines: [] })
    const result = await getPosting(stub.db, ORG, 'gp_1')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().draft).toBe(junk)
  })
})

describe('getPosting - scope', () => {
  it('returns NotFoundError for an id that does not exist', async () => {
    const stub = stubDb({ postings: [POSTING], lines: [] })
    const result = await getPosting(stub.db, ORG, 'gp_missing')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  // 🛑 The same error, deliberately. "This id exists but is not yours" is itself
  // a disclosure, so a cross-org read is indistinguishable from a missing row.
  it('returns NotFoundError for a posting belonging to another organization', async () => {
    const stub = stubDb({
      postings: [{ ...POSTING, organizationId: OTHER_ORG }],
      lines: [line({ lineNumber: 1, organizationId: OTHER_ORG })],
    })
    const result = await getPosting(stub.db, ORG, 'gp_1')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(result._unsafeUnwrapErr().message).toBe('Posting not found')
  })

  it('does not return another organization lines under our own header', async () => {
    const stub = stubDb({
      postings: [POSTING],
      lines: [
        line({ lineNumber: 1 }),
        line({ lineNumber: 2, organizationId: OTHER_ORG, accountCode: '9999' }),
      ],
    })
    const detail = (await getPosting(stub.db, ORG, 'gp_1'))._unsafeUnwrap()

    expect(detail.lines.map((l) => l.accountCode)).toEqual(['1310'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// readPostingLineSourceIds - how a caller tells a converged re-post from a
// period-key COLLISION. `already_posted` is a success status either way, so the
// only difference visible anywhere is whose lines are in the winning posting.
// ─────────────────────────────────────────────────────────────────────────────

/** `selectDistinct().from().innerJoin().where()`, filtered on what was asked. */
function sourceIdStub(lines: LineRow[]): Database {
  return {
    selectDistinct: () => ({
      from: () => {
        let params: string[] = []
        const chain: any = {
          innerJoin: () => chain,
          where: (condition: unknown) => {
            params = whereValues(condition)
            return chain
          },
          // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(
              // DISTINCT, like the query - a two-line posting names its source
              // once, not twice.
              [
                ...new Set(
                  lines
                    .filter(
                      (row) =>
                        params.includes(row.organizationId) &&
                        params.includes(row.glPostingId) &&
                        params.includes(row.sourceType)
                    )
                    .map((row) => row.sourceId)
                ),
              ].map((sourceId) => ({ sourceId }))
            ).then(resolve, reject),
        }
        return chain
      },
    }),
  } as unknown as Database
}

function paymentLine(sourceId: string, lineNumber: number): LineRow {
  return {
    id: `gpl_${lineNumber}`,
    organizationId: ORG,
    glPostingId: 'gp_1',
    lineNumber,
    accountCode: '1050',
    accountRole: 'undeposited_funds',
    accountName: 'Undeposited Funds',
    direction: lineNumber === 1 ? 'debit' : 'credit',
    amountMinor: 10_000,
    memo: null,
    sourceType: 'payment_transaction',
    sourceId,
  }
}

describe('readPostingLineSourceIds', () => {
  it('names the transaction whose lines are actually in the posting', async () => {
    const db = sourceIdStub([paymentLine('ptx_1', 1), paymentLine('ptx_1', 2)])
    const result = await readPostingLineSourceIds(db, ORG, {
      glPostingId: 'gp_1',
      sourceType: 'payment_transaction',
    })
    expect(result._unsafeUnwrap()).toEqual(['ptx_1'])
  })

  it('names ANOTHER transaction when the key was collided into - the caller refuses on this', async () => {
    const db = sourceIdStub([paymentLine('ptx_other', 1), paymentLine('ptx_other', 2)])
    const owners = (
      await readPostingLineSourceIds(db, ORG, {
        glPostingId: 'gp_1',
        sourceType: 'payment_transaction',
      })
    )._unsafeUnwrap()
    expect(owners).toEqual(['ptx_other'])
    expect(owners.includes('ptx_mine')).toBe(false)
  })

  it('reads nothing for another organization - a posting id is not a cross-org handle', async () => {
    const db = sourceIdStub([paymentLine('ptx_1', 1)])
    const result = await readPostingLineSourceIds(db, OTHER_ORG, {
      glPostingId: 'gp_1',
      sourceType: 'payment_transaction',
    })
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('ignores lines of a different sourceType on the same posting', async () => {
    const other = { ...paymentLine('ord_9', 3), sourceType: 'order' }
    const db = sourceIdStub([paymentLine('ptx_1', 1), other])
    const result = await readPostingLineSourceIds(db, ORG, {
      glPostingId: 'gp_1',
      sourceType: 'payment_transaction',
    })
    expect(result._unsafeUnwrap()).toEqual(['ptx_1'])
  })
})
