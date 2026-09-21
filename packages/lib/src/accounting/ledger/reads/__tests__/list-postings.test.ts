// packages/lib/src/accounting/ledger/reads/__tests__/list-postings.test.ts
//
// The two batched `GlPostingSource` readers. What matters is the PREDICATE they
// issue - thirteen hand-written copies disagreed on it - so the stub records the
// `where` values the module actually passed and the assertions read them back.

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { findLinkedPostings, findLiveSubjectPostings, type LinkedPosting } from '../list-postings'

/** Every scalar the module put into a `where` clause, flattened. See `read-posting.test.ts`. */
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

function stubDb(rows: unknown[]) {
  let params: string[] = []
  let queries = 0
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: (condition: unknown) => {
      params = whereValues(condition)
      return chain
    },
    orderBy: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  const db = {
    select: () => {
      queries++
      return chain
    },
  } as unknown as Database
  return { db, params: () => params, queries: () => queries }
}

function row(overrides: Partial<LinkedPosting> & { createdAt?: Date } = {}) {
  return {
    sourceKind: 'order',
    sourceId: 'ord_1',
    linkRole: 'parent',
    occurrence: 'original',
    glPostingId: 'glp_1',
    postingType: 'credit_memo',
    status: 'posted',
    docNumber: 'AUXX-CM-1',
    txnDate: '2026-09-14',
    totalMinor: 1000,
    createdAt: new Date('2026-09-14T00:00:00Z'),
    ...overrides,
  }
}

describe('findLinkedPostings', () => {
  it('issues no query for an empty source list', async () => {
    const stub = stubDb([row()])
    const found = await findLinkedPostings(stub.db, 'org_1', {
      sourceIds: [],
      linkRole: 'parent',
      statuses: ['posted'],
    })
    expect(found).toEqual([])
    expect(stub.queries()).toBe(0)
  })

  it('issues no query when the caller asks for no status at all', async () => {
    const stub = stubDb([row()])
    const found = await findLinkedPostings(stub.db, 'org_1', {
      sourceIds: ['ord_1'],
      linkRole: 'parent',
      statuses: [],
    })
    expect(found).toEqual([])
    expect(stub.queries()).toBe(0)
  })

  it('narrows on the org, the kind, the ids, the role, the types and the statuses', async () => {
    const stub = stubDb([row()])
    await findLinkedPostings(stub.db, 'org_1', {
      sourceKind: 'order',
      sourceIds: ['ord_1', 'ord_2'],
      linkRole: 'parent',
      postingTypes: ['credit_memo'],
      statuses: ['posted'],
    })
    const params = stub.params()
    for (const value of ['org_1', 'order', 'ord_1', 'ord_2', 'parent', 'credit_memo', 'posted'])
      expect(params).toContain(value)
    // Nothing widens it: `reversed` was NOT asked for.
    expect(params).not.toContain('reversed')
  })

  it('takes several link roles, and dedupes the ids it was handed', async () => {
    const stub = stubDb([row()])
    await findLinkedPostings(stub.db, 'org_1', {
      sourceIds: ['ord_1', 'ord_1'],
      linkRole: ['parent', 'subject'],
      statuses: ['posted', 'reversed'],
    })
    const params = stub.params()
    expect(params).toContain('subject')
    expect(params).toContain('reversed')
    expect(params.filter((value) => value === 'ord_1')).toHaveLength(1)
  })

  it('drops the internal ordering column from the rows it returns', async () => {
    const stub = stubDb([row()])
    const [found] = await findLinkedPostings(stub.db, 'org_1', {
      sourceIds: ['ord_1'],
      linkRole: 'parent',
      statuses: ['posted'],
    })
    expect(found).toEqual({
      sourceKind: 'order',
      sourceId: 'ord_1',
      linkRole: 'parent',
      occurrence: 'original',
      glPostingId: 'glp_1',
      postingType: 'credit_memo',
      status: 'posted',
      docNumber: 'AUXX-CM-1',
      txnDate: '2026-09-14',
      totalMinor: 1000,
    })
  })
})

describe('findLiveSubjectPostings', () => {
  it('asks for the subject role and both LIVE statuses - a draft holds the pointer too', async () => {
    const stub = stubDb([])
    await findLiveSubjectPostings(stub.db, 'org_1', {
      sourceKind: 'payout',
      sourceIds: ['ins_1'],
    })
    const params = stub.params()
    expect(params).toContain('subject')
    expect(params).toContain('draft')
    expect(params).toContain('posted')
    // A reversal deletes the subject row, so the status never reads `reversed`.
    expect(params).not.toContain('reversed')
  })

  it('keys by source, and the newest posting wins when one source has two', async () => {
    const stub = stubDb([
      row({ sourceKind: 'payout', sourceId: 'ins_1', linkRole: 'subject', glPostingId: 'glp_new' }),
      row({ sourceKind: 'payout', sourceId: 'ins_1', linkRole: 'subject', glPostingId: 'glp_old' }),
      row({ sourceKind: 'payout', sourceId: 'ins_2', linkRole: 'subject', glPostingId: 'glp_2' }),
    ])
    const live = await findLiveSubjectPostings(stub.db, 'org_1', {
      sourceKind: 'payout',
      sourceIds: ['ins_1', 'ins_2'],
    })
    expect(live.size).toBe(2)
    expect(live.get('ins_1')?.glPostingId).toBe('glp_new')
    expect(live.get('ins_2')?.glPostingId).toBe('glp_2')
  })
})
