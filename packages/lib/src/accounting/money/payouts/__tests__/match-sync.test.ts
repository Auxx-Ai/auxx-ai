// packages/lib/src/accounting/money/payouts/__tests__/match-sync.test.ts
import type { Transaction } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { syncStoredMatches } from '../match-sync'

/** Whether a value appears anywhere in a drizzle statement tree. */
function mentions(value: unknown, needle: unknown): boolean {
  if (value === needle) return true
  if (Array.isArray(value)) return value.some((item) => mentions(item, needle))
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => mentions(item, needle))
  return false
}

/**
 * The query order `syncStoredMatches` issues: entries, accounts, the matcher's
 * gateways and candidates, the frozen ids (`selectDistinct`), and - only when
 * something is frozen - the postings' `unidentified_receipts` credits.
 */
function transaction(results: unknown[][], frozen: unknown[], credits: unknown[] = []) {
  if (frozen.length) results = [...results, credits]
  const statements: unknown[] = []
  const chain = (rows: unknown[]) => {
    const link: Record<string, unknown> = {}
    for (const key of ['from', 'innerJoin', 'where', 'orderBy', 'groupBy', 'limit'])
      link[key] = () => link
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    link.then = (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve)
    return link
  }
  const select = vi.fn(() => {
    const rows = results.shift()
    if (!rows) throw new Error('Unexpected extra query')
    return chain(rows)
  })
  const tx = {
    select,
    selectDistinct: vi.fn(() => chain(frozen)),
    execute: vi.fn((statement: unknown) => {
      statements.push(statement)
      return Promise.resolve()
    }),
  }
  return { tx: tx as unknown as Transaction, statements, execute: tx.execute }
}

const scope = [{ key: 'transfer-1', sourceAccountId: 'feed', payoutExternalId: 'po_1' }]
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry-1',
  organizationId: 'org',
  sourceAccountId: 'feed',
  payoutExternalId: 'po_1',
  type: 'charge',
  grossMinor: 10000n,
  feeMinor: 300n,
  netMinor: 9700n,
  currency: 'USD',
  currencyExponent: 2,
  sourceReference: {
    sourceAccount: { providerKey: 'shopify', externalAccountId: 'store', environment: 'live' },
    objectType: 'order_transaction',
    externalId: 'txn-1',
    componentKey: '',
  },
  sourceTransactionId: 'txn-1',
  sourceId: null,
  sourceOrderId: null,
  matchState: null,
  matchedMoneyTransactionId: null,
  matchReason: null,
  matchedBy: null,
  ...overrides,
})
const accounts = [{ id: 'feed', providerKey: 'shopify' }]
const gateways = [{ id: 'feed', paymentGatewayId: 'rail-sp' }]
const receipt = {
  object: { objectType: 'order_transaction', externalId: 'txn-1', componentKey: '' },
  account: {
    providerKey: 'shopify',
    externalAccountId: 'store',
    environment: 'live',
    paymentGatewayId: 'rail-sp',
  },
  money: {
    id: 'mt-1',
    amountMinor: 10000n,
    currency: 'USD',
    currencyExponent: 2,
    purpose: 'customer_receipt',
  },
}

describe('syncStoredMatches', () => {
  it('stores an exact match and reports nothing unmatched', async () => {
    const { tx, statements } = transaction([[row()], accounts, gateways, [receipt]], [])
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(mentions(statements[0], 'matched')).toBe(true)
    expect(mentions(statements[0], 'mt-1')).toBe(true)
    expect(summaries.get('transfer-1')).toMatchObject({
      unmatchedCount: 0,
      basis: [['entry-1', 'matched', 'mt-1', null]],
    })
  })

  it('stores a suggestion with its code when one candidate misses the amount', async () => {
    const near = { ...receipt, money: { ...receipt.money, amountMinor: 9500n } }
    const { tx, statements } = transaction([[row()], accounts, gateways, [near]], [])
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(mentions(statements[0], 'suggested')).toBe(true)
    expect(mentions(statements[0], 'amount_differs')).toBe(true)
    expect(summaries.get('transfer-1')!.unmatchedCount).toBe(1)
  })

  it('writes nothing when the stored answer already agrees', async () => {
    const stored = row({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-1',
      matchReason: null,
    })
    const { tx, execute } = transaction([[stored], accounts, gateways, [receipt]], [])
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(execute).not.toHaveBeenCalled()
    // The basis input is identical, so the transfer's hash cannot churn.
    expect(summaries.get('transfer-1')!.basis).toEqual([['entry-1', 'matched', 'mt-1', null]])
  })

  it('never rewrites a matched item a live posting names', async () => {
    const stored = row({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-old',
      matchReason: null,
    })
    const { tx, execute } = transaction(
      [[stored], accounts, gateways, [receipt]],
      [{ sourceId: 'entry-1', glPostingId: 'glp-1' }]
    )
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(execute).not.toHaveBeenCalled()
    expect(summaries.get('transfer-1')!.basis).toEqual([['entry-1', 'matched', 'mt-old', null]])
  })

  it('still moves a pending item a live posting names, so a re-post is reachable', async () => {
    const stored = row({ matchState: 'pending', matchReason: 'no_receipt' })
    const { tx, statements } = transaction(
      [[stored], accounts, gateways, [receipt]],
      [{ sourceId: 'entry-1', glPostingId: 'glp-1' }],
      [{ glPostingId: 'glp-1', amountMinor: 9700 }]
    )
    await syncStoredMatches(tx, 'org', scope)
    expect(mentions(statements[0], 'mt-1')).toBe(true)
  })

  // ── The T26 re-post trigger (§13 Q6) ───────────────────────────────────────

  it('names the posting stale when a match has outgrown the remainder it credited', async () => {
    // The entry was posted with this item unrecognised, so 9,700 went to
    // `unidentified_receipts`. The item is matched now, so the remainder is 0.
    const stored = row({ matchState: 'pending', matchReason: 'no_receipt' })
    const { tx } = transaction(
      [[stored], accounts, gateways, [receipt]],
      [{ sourceId: 'entry-1', glPostingId: 'glp-1' }],
      [{ glPostingId: 'glp-1', amountMinor: 9700 }]
    )

    const summaries = await syncStoredMatches(tx, 'org', scope)

    expect(summaries.get('transfer-1')).toMatchObject({
      entryCount: 1,
      stalePostingIds: ['glp-1'],
      split: { grossMinor: 10000, feesMinor: 300, netMinor: 9700, unrecognisedNetMinor: 0 },
    })
  })

  it('leaves a posting alone while its remainder still agrees, so nothing reverses on a loop', async () => {
    // One matched item and one still pending: the entry credited the pending
    // item's net and that is still exactly what is unrecognised.
    const matched = row({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-1',
      matchedBy: 'user-1',
    })
    const pendingRow = row({
      id: 'entry-2',
      matchState: 'pending',
      matchReason: 'no_receipt',
      matchedBy: 'user-1',
      sourceReference: null,
    })
    const { tx } = transaction(
      [[matched, pendingRow], accounts, gateways, [receipt]],
      [
        { sourceId: 'entry-1', glPostingId: 'glp-1' },
        { sourceId: 'entry-2', glPostingId: 'glp-1' },
      ],
      [{ glPostingId: 'glp-1', amountMinor: 9700 }]
    )

    const summaries = await syncStoredMatches(tx, 'org', scope)

    expect(summaries.get('transfer-1')!.stalePostingIds).toEqual([])
  })

  it('counts a fee row in the split without ever matching it', async () => {
    const fee = row({
      id: 'entry-fee',
      type: 'fee',
      grossMinor: -500n,
      feeMinor: 0n,
      netMinor: -500n,
    })
    const { tx } = transaction([[row(), fee], accounts, gateways, [receipt]], [])

    const summaries = await syncStoredMatches(tx, 'org', scope)

    expect(summaries.get('transfer-1')).toMatchObject({
      entryCount: 2,
      unmatchedCount: 0,
      split: { grossMinor: 10000, unrecognisedNetMinor: -500, unrecognisedCount: 1 },
    })
    expect(summaries.get('transfer-1')!.basis).toEqual([['entry-1', 'matched', 'mt-1', null]])
  })

  it("never rewrites a person's answer", async () => {
    const stored = row({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-picked',
      matchReason: 'manual',
      matchedBy: 'user-1',
    })
    const { tx, execute } = transaction([[stored], accounts, gateways, [receipt]], [])
    await syncStoredMatches(tx, 'org', scope)
    expect(execute).not.toHaveBeenCalled()
  })

  it('stores no_rail once for a feed with no payment gateway', async () => {
    const { tx, statements } = transaction([[row()], accounts, [], [receipt]], [])
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(mentions(statements[0], 'no_rail')).toBe(true)
    expect(summaries.get('transfer-1')!.unmatchedCount).toBe(1)
  })

  it('leaves an item with no reference unmatchable', async () => {
    const { tx, statements } = transaction([[row({ sourceReference: null })], accounts], [])
    const summaries = await syncStoredMatches(tx, 'org', scope)
    expect(mentions(statements[0], 'unmatchable')).toBe(true)
    expect(mentions(statements[0], 'no_reference')).toBe(true)
    expect(summaries.get('transfer-1')!.unmatchedCount).toBe(1)
  })
})
