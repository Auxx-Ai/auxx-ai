// packages/lib/src/postings/__tests__/retry-export.test.ts
//
// `retryExport` re-pushes an entry that is ALREADY in the books.
//
// The load-bearing assertion in this file is the negative one: no branch may
// write `GlPosting.status`. That column is what the ledger did, `retryExport`
// talks to a provider, and the whole of
// plans/accounting/export-state-split.md exists because those two were once the
// same field. `updatedColumns` collects every `set()` this module issues so the
// invariant is checked on success, on refusal, and on the no-op paths.
//
// The fake is hand-written for the reason `post-entry.test.ts` gives: this
// module issues distinct reads against two tables and an update, and each has
// to answer differently.

import { schema } from '@auxx/database'
import type { Result } from 'neverthrow'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAccountingProvidersForTests,
  registerAccountingProvider,
  setConnectedProviderResolver,
} from '../provider'
import { retryExport } from '../retry-export'
import type { PostEntryInput, PostEntryResult } from '../types'
import { ProviderPostError } from '../types'

const ORG = 'org_1'
const POSTING = 'post_1'

interface FakeRow {
  id: string
  postingType: string
  periodKey: string
  revision: number
  txnDate: string
  docNumber: string
  requestId: string
  exportStatus: string
  draft: unknown
}

function createFakeDb(row: FakeRow | null, lines: Record<string, unknown>[]) {
  const updatedColumns: string[] = []
  const updates: Record<string, unknown>[] = []

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const isPosting = table === schema.GlPosting
        const rows = isPosting ? (row ? [row] : []) : lines
        // Both reads in `retry-export.ts` terminate in `limit` or `orderBy`, so
        // the chain never has to be thenable itself.
        const chain = {
          where: () => chain,
          orderBy: () => rows,
          limit: () => rows,
        }
        return chain
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updatedColumns.push(...Object.keys(values))
        updates.push(values)
        return { where: async () => undefined }
      },
    }),
  }

  return { db: db as never, updatedColumns, updates }
}

function line(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    glAccountId: 'acct_ar',
    accountCode: '1100',
    accountName: 'Accounts Receivable',
    direction: 'debit',
    amountMinor: 45_000,
    memo: null,
    sourceType: 'invoice',
    sourceId: 'inv_1',
    lineNumber: 1,
    counterpartyType: null,
    counterpartyId: null,
    ...overrides,
  }
}

function postingRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: POSTING,
    postingType: 'invoice_issued',
    periodKey: 'INV-0012',
    revision: 0,
    txnDate: '2026-09-01',
    docNumber: 'AUXX-INI-INV0012',
    requestId: 'req_deterministic',
    exportStatus: 'failed',
    draft: { memo: 'Invoice INV-0012' },
    ...overrides,
  }
}

/** A provider that records what it was handed and answers however the test says. */
function stubProvider(answer: (input: PostEntryInput) => Result<PostEntryResult, Error>) {
  const seen: PostEntryInput[] = []
  registerAccountingProvider('stub', async () => ({
    id: 'stub',
    listProviderAccounts: async () => ok([]),
    readProviderOpeningBalances: async () => ok(null),
    listAccountMappings: async () => ok(new Map<string, string>()),
    setAccountMapping: async () => ok(undefined),
    clearAccountMapping: async () => ok(undefined),
    resolveAccount: async (_org: string, code: string) => ok(code),
    postEntry: async (input: PostEntryInput) => {
      seen.push(input)
      return answer(input)
    },
  }))
  setConnectedProviderResolver(async () => 'stub')
  return seen
}

beforeEach(() => {
  __resetAccountingProvidersForTests()
  vi.restoreAllMocks()
})

describe('retryExport', () => {
  it('NEVER writes status, on the success path', async () => {
    const fake = createFakeDb(postingRow(), [line()])
    stubProvider(() => ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' }))

    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(result._unsafeUnwrap().exportStatus).toBe('exported')
    expect(fake.updatedColumns).not.toContain('status')
    expect(fake.updates[0]).toMatchObject({ exportStatus: 'exported', providerEntryId: 'qb_9' })
  })

  it('NEVER writes status, on the refusal path', async () => {
    const fake = createFakeDb(postingRow(), [line()])
    stubProvider(
      () =>
        // The exact shape that started all of this.
        ({
          isErr: () => true,
          isOk: () => false,
          error: new ProviderPostError('1100 is not mapped to a QuickBooks account.', {
            failureClass: 'configuration',
            providerId: 'stub',
          }),
        }) as never
    )

    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    // 🛑 The ledger's answer is unchanged and the entry is still in the books.
    expect(result._unsafeUnwrap().status).toBe('posted')
    expect(result._unsafeUnwrap().exportStatus).toBe('failed')
    expect(fake.updatedColumns).not.toContain('status')
    expect(fake.updates[0]).toMatchObject({ exportStatus: 'failed' })
  })

  it('replays the row own requestId and docNumber rather than minting new ones', async () => {
    // The provider's idempotency contract only fires on the key the first
    // attempt used. A fresh key guarantees nothing, because the retry carries a
    // different one - which is the double-post this seam exists to prevent.
    const fake = createFakeDb(postingRow(), [line()])
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' })
    )

    await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(seen[0]?.idempotencyKey).toBe('req_deterministic')
    expect(seen[0]?.docNumber).toBe('AUXX-INI-INV0012')
  })

  it('replays the lines as BOOKED, not as the role map resolves them today', async () => {
    // Re-resolving would export whatever the chart says now, so an entry booked
    // under one mapping could be exported under another and the two registers
    // would disagree with nothing able to detect it.
    const fake = createFakeDb(postingRow(), [
      line({ glAccountId: 'acct_ar', accountCode: '1100', lineNumber: 1 }),
      line({
        glAccountId: 'acct_revenue',
        accountCode: '4030',
        direction: 'credit',
        lineNumber: 2,
        accountName: 'Service Revenue',
      }),
    ])
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' })
    )

    await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(seen[0]?.lines.map((l) => l.accountCode)).toEqual(['1100', '4030'])
    expect(seen[0]?.lines[1]?.direction).toBe('credit')
  })

  it('replays the counterparty FROZEN on the line at post time (brief 13 §1.1)', async () => {
    // Re-resolving would export whoever the record names TODAY, so a retry
    // after a merge or a rename would export under an attribution the ledger
    // never asserted.
    const fake = createFakeDb(postingRow(), [
      line({ counterpartyType: 'customer', counterpartyId: 'contact_1' }),
    ])
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' })
    )

    await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(seen[0]?.lines[0]).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'contact_1',
    })
  })

  it('replays the dimensions frozen on the line (brief 13 §5)', async () => {
    const fake = createFakeDb(postingRow(), [line({ dimensions: { channel: 'dealer' } })])
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' })
    )

    await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(seen[0]?.lines[0]?.dimensions).toEqual({ channel: 'dealer' })
  })

  it('replays the stored glAccountId - the identity, alongside the code snapshot', async () => {
    // Task 15 §2: `glAccountId` is what a `gl_posting_line` row stores as its
    // identity now. The replay must carry it through unchanged, the same way it
    // already carries the code and name snapshots.
    const fake = createFakeDb(postingRow(), [line({ glAccountId: 'acct_ar' })])
    const seen = stubProvider(() =>
      ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' })
    )

    await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(seen[0]?.lines[0]?.glAccountId).toBe('acct_ar')
  })

  it('treats an already exported row as a no-op success, not an error', async () => {
    // Two people pressing Retry should both be told it is exported, rather than
    // one of them handed an error for having been second.
    const fake = createFakeDb(postingRow({ exportStatus: 'exported' }), [line()])
    stubProvider(() => ok({ status: 'posted', externalId: 'qb_9', providerId: 'stub' }))

    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().exportStatus).toBe('exported')
    expect(fake.updates).toHaveLength(0)
  })

  it('refuses a row with nothing to export rather than reporting a success', async () => {
    // `not_required` means nothing is connected. Retrying would stamp
    // `not_required` again, which reads as "I tried and it worked".
    const fake = createFakeDb(postingRow({ exportStatus: 'not_required' }), [line()])

    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(result.isErr()).toBe(true)
    expect(fake.updates).toHaveLength(0)
  })

  it('refuses a posted header with no lines rather than pushing an empty entry', async () => {
    // 0 = 0 balances. `verifyBooksBalance` is what reports this.
    const fake = createFakeDb(postingRow(), [])

    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: POSTING })

    expect(result.isErr()).toBe(true)
    expect(fake.updates).toHaveLength(0)
  })

  it('returns err for a posting that does not exist', async () => {
    const fake = createFakeDb(null, [])
    const result = await retryExport(fake.db, { organizationId: ORG, glPostingId: 'nope' })
    expect(result.isErr()).toBe(true)
  })
})
