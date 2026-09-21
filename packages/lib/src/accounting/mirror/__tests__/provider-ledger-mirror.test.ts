// packages/lib/src/accounting/mirror/__tests__/provider-ledger-mirror.test.ts
//
// The mirror (TARGET §2): who authored an entry, and that a re-read of the same
// month converges rather than accumulating.
//
// 🛑 The authorship stamp is the single most dangerous value in this directory.
// An entry of OURS stamped `'provider'` is translated back into our own books,
// doubling it - both copies balance, every statement still ties, and nothing
// downstream can detect it.

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { authorOf, type ProviderLedgerEntry, type ProviderLedgerLine } from '../client'
import { upsertMirrorChunk } from '../writes'

const ORG = 'org_1'
const BOOK = 'book_1'

function line(overrides: Partial<ProviderLedgerLine> = {}): ProviderLedgerLine {
  return {
    txnType: 'Journal Entry',
    txnId: '101',
    txnDate: '2026-01-15',
    providerAccountId: '41',
    providerAccountName: 'Mastercard',
    debitMinor: 90_000,
    creditMinor: 0,
    docNumber: null,
    memo: null,
    ...overrides,
  }
}

function entry(overrides: Partial<ProviderLedgerEntry> = {}): ProviderLedgerEntry {
  return {
    txnType: 'Journal Entry',
    txnId: '101',
    txnDate: '2026-01-15',
    docNumber: null,
    lines: [line(), line({ providerAccountId: '35', debitMinor: 0, creditMinor: 90_000 })],
    totalDebitMinor: 90_000,
    totalCreditMinor: 90_000,
    balanced: true,
    ...overrides,
  }
}

const NOBODY = { providerEntryIds: new Set<string>(), docNumbers: new Set<string>() }

describe('who authored an entry', () => {
  it('is theirs when the transaction type is not one we ever write', () => {
    expect(
      authorOf(entry({ txnType: 'Credit Card Expense', txnId: '7' }), {
        providerEntryIds: new Set(['7']),
        docNumbers: new Set<string>(),
      })
    ).toBe('provider')
  })

  it('is ours when the transaction id is one our books already hold', () => {
    expect(
      authorOf(entry(), { providerEntryIds: new Set(['101']), docNumbers: new Set<string>() })
    ).toBe('auxx')
  })

  it('is ours when the document number is one we minted, even with the id unknown', () => {
    // The re-keyed case: the id moved, the number did not. Calling it theirs
    // would translate our own entry back into our own books.
    expect(
      authorOf(entry({ docNumber: 'ORD-0012-F1' }), {
        providerEntryIds: new Set<string>(),
        docNumbers: new Set(['ORD-0012-F1']),
      })
    ).toBe('auxx')
  })

  it('is theirs when neither witness matches', () => {
    expect(authorOf(entry({ docNumber: 'JE-9' }), NOBODY)).toBe('provider')
  })
})

// ── The upsert ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

/** Just enough of Postgres to prove the unique key converges. */
function createFakeDb() {
  const entries: Row[] = []
  let lines: Row[] = []
  let seq = 0

  const key = (row: Row) =>
    `${row.organizationId}|${row.bookId}|${row.providerTxnType}|${row.providerTxnId}`

  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    insert: (table: unknown) => {
      let captured: unknown
      let conflictSet: Row | null = null
      const chain: Record<string, unknown> = {}
      chain.values = (value: unknown) => {
        captured = value
        return chain
      }
      chain.onConflictDoUpdate = (spec: { set: Row }) => {
        conflictSet = spec.set
        return chain
      }
      const run = async (): Promise<unknown[]> => {
        if (table === schema.ProviderLedgerEntry) {
          const value = captured as Row
          const existing = entries.find((row) => key(row) === key(value))
          if (existing) {
            Object.assign(existing, conflictSet ?? {})
            return [{ id: existing.id }]
          }
          seq += 1
          const row: Row = { ...value, id: `ple_${seq}`, withdrawnAt: null }
          entries.push(row)
          return [{ id: row.id }]
        }
        for (const row of captured as Row[]) lines.push(row)
        return []
      }
      chain.returning = () => ({
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          run().then(resolve, reject),
      })
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        run().then(resolve, reject)
      return chain
    },
    delete: () => ({
      where: (condition: unknown) => ({
        // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
        then: (resolve: (v: unknown) => unknown) => {
          const named = bound(condition)
          lines = lines.filter((row) => !named.includes(row.entryId as string))
          return Promise.resolve().then(resolve)
        },
      }),
    }),
    // The convergence statement: every live row in the range that was not seen.
    update: () => {
      let values: Row = {}
      const chain: Record<string, unknown> = {}
      chain.set = (next: Row) => {
        values = next
        return chain
      }
      chain.where = (condition: unknown) => {
        const named = bound(condition)
        chain.returning = () => ({
          // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
          then: (resolve: (v: unknown) => unknown) => {
            // `notInArray` binds the ids that WERE seen; everything else in the
            // range is what vanished.
            const vanished = entries.filter(
              (row) => row.withdrawnAt === null && !named.includes(row.id as string)
            )
            for (const row of vanished) Object.assign(row, values)
            return Promise.resolve().then(() => resolve(vanished.map((row) => ({ id: row.id }))))
          },
        })
        return chain
      }
      return chain
    },
  }

  function bound(condition: unknown): string[] {
    const out: string[] = []
    const visit = (node: unknown): void => {
      if (node == null) return
      if (Array.isArray(node)) {
        for (const child of node) visit(child)
        return
      }
      if (typeof node === 'string') {
        out.push(node)
        return
      }
      if (typeof node === 'object') {
        const record = node as Record<string, unknown>
        if ('queryChunks' in record) visit(record.queryChunks)
        else if ('value' in record) visit(record.value)
      }
    }
    visit(condition)
    return out
  }

  return {
    db: db as never,
    get entries() {
      return entries
    },
    get lines() {
      return lines
    },
  }
}

describe('the mirror converges by re-reading', () => {
  const range = { bookId: BOOK, from: '2026-01-01', to: '2026-01-31' }

  it('writes one row per transaction and one line per leg', async () => {
    const fake = createFakeDb()

    const result = await upsertMirrorChunk(fake.db, ORG, {
      ...range,
      entries: [entry()],
      ours: NOBODY,
    })

    expect(result._unsafeUnwrap().mirrored).toBe(1)
    expect(fake.entries).toHaveLength(1)
    expect(fake.entries[0]).toMatchObject({ providerTxnId: '101', author: 'provider' })
    expect(fake.lines).toHaveLength(2)
    expect(fake.lines[0]).toMatchObject({ direction: 'debit', amountMinor: 90_000 })
    expect(fake.lines[1]).toMatchObject({ direction: 'credit', amountMinor: 90_000 })
  })

  it('a second read of the same month writes no second row and no second set of lines', async () => {
    const fake = createFakeDb()
    await upsertMirrorChunk(fake.db, ORG, { ...range, entries: [entry()], ours: NOBODY })

    await upsertMirrorChunk(fake.db, ORG, { ...range, entries: [entry()], ours: NOBODY })

    expect(fake.entries).toHaveLength(1)
    // REPLACED, never merged: a provider line has no stable id to match on.
    expect(fake.lines).toHaveLength(2)
  })

  it('stamps ours as ours, so the translation never reads it back', async () => {
    const fake = createFakeDb()

    const result = await upsertMirrorChunk(fake.db, ORG, {
      ...range,
      entries: [entry()],
      ours: { providerEntryIds: new Set(['101']), docNumbers: new Set<string>() },
    })

    expect(result._unsafeUnwrap().ours).toBe(1)
    expect(fake.entries[0]?.author).toBe('auxx')
  })

  it('withdraws a transaction that stopped appearing, rather than deleting it', async () => {
    const fake = createFakeDb()
    await upsertMirrorChunk(fake.db, ORG, {
      ...range,
      entries: [entry(), entry({ txnId: '102' })],
      ours: NOBODY,
    })

    const second = await upsertMirrorChunk(fake.db, ORG, {
      ...range,
      entries: [entry()],
      ours: NOBODY,
    })

    expect(second._unsafeUnwrap().withdrawn).toBe(1)
    expect(fake.entries).toHaveLength(2)
    const gone = fake.entries.find((row) => row.providerTxnId === '102')
    expect(gone?.withdrawnAt).toBeInstanceOf(Date)
  })

  it('clears the withdrawal when the transaction comes back', async () => {
    const fake = createFakeDb()
    await upsertMirrorChunk(fake.db, ORG, { ...range, entries: [entry()], ours: NOBODY })
    await upsertMirrorChunk(fake.db, ORG, { ...range, entries: [], ours: NOBODY })
    expect(fake.entries[0]?.withdrawnAt).toBeInstanceOf(Date)

    await upsertMirrorChunk(fake.db, ORG, { ...range, entries: [entry()], ours: NOBODY })

    expect(fake.entries[0]?.withdrawnAt).toBeNull()
  })
})
