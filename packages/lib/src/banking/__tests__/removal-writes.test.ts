// packages/lib/src/banking/__tests__/removal-writes.test.ts

/**
 * The three removal verbs
 * (plans/bank-connection/08-removing-a-bank-account.md §8).
 *
 * 🛑 The two assertions that matter most are about ORDER and about ABSENCE:
 *
 *  1. **A delete releases at Stripe BEFORE it drops the connector**, and drops
 *     nothing if the release threw. Deleting first and failing the release is
 *     unrecoverable - the `providerAccountId` we would need is on the row we just
 *     destroyed, and the nightly reaper only sweeps connectors that still EXIST -
 *     so the org keeps paying 30c a month forever with nothing left to find it by.
 *  2. **An archive touches no `GlPosting` and no `gl_account`.** §3 is the
 *     load-bearing claim of the whole brief: a `bank_account` holds a POINTER to
 *     a GL code, so archiving one cannot move the trial balance by a cent. If a
 *     later change breaks that, this is where it should fail.
 *
 * The collaborators are mocked rather than faked, the way
 * `review/__tests__/writes.test.ts` mocks `postEntry`: what is under test is the
 * ordering and the set of writes, not the behaviour of the things being called.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankAccountRemovalFacts, BankAccountRow } from '../client'

const h = vi.hoisted(() => ({
  /** Every collaborator call, in the order it happened. The ordering assertions read this. */
  trace: [] as string[],
  reapBankFeedAccount: vi.fn(),
  findBankFeedAccountForConnector: vi.fn(),
  disconnectBankAccountFeed: vi.fn(),
  deleteCredential: vi.fn(),
  crudUpdate: vi.fn(),
  crudDelete: vi.fn(),
  crudArchive: vi.fn(),
  crudRestore: vi.fn(),
  /** `bank_transaction` rows `listForReview` answers, keyed by the state asked for. */
  linesByState: new Map<string, { id: string; excludeReason?: string | null }[]>(),
  /**
   * Every line the DELETE cascade finds - archived ones included, which is why
   * it does not go through `listForReview`.
   */
  cascadeLineIds: [] as string[],
  /** Every `db.delete(...)` the verbs issued, as a table name. */
  deletes: [] as string[],
  /** What a `db.select(...).limit()` resolves to - the sibling-connector probe. */
  siblings: [] as { id: string }[],
  account: null as BankAccountRow | null,
  facts: null as BankAccountRemovalFacts | null,
}))

vi.mock('../feed/reaper', () => ({
  reapBankFeedAccount: h.reapBankFeedAccount,
  findBankFeedAccountForConnector: h.findBankFeedAccountForConnector,
}))
vi.mock('../feed/actions', () => ({ disconnectBankAccountFeed: h.disconnectBankAccountFeed }))
vi.mock('@auxx/credentials/store', () => ({ deleteCredential: h.deleteCredential }))
vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = h.crudUpdate
    delete = h.crudDelete
    archive = h.crudArchive
    restore = h.crudRestore
  },
}))
vi.mock('../review/reads', () => ({
  requireReviewFieldContext: async () => ({
    bankTransactionDefId: 'def_bt',
    fields: {},
    suggestionFields: {},
  }),
  listForReview: async (_db: unknown, filters: { state?: string }) => ({
    isErr: () => false,
    isOk: () => true,
    value: h.linesByState.get(filters.state ?? 'for_review') ?? [],
  }),
}))
vi.mock('../reads', () => ({
  requireBankAccountFieldContext: async () => ({ bankAccountDefId: 'def_ba', fields: {} }),
  getBankAccount: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: h.account,
  }),
  readRemovalFacts: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: h.facts,
  }),
  readBankTransactionIdsForAccount: async () => ({
    isErr: () => false,
    isOk: () => true,
    value: { bankTransactionDefId: 'def_bt', ids: h.cascadeLineIds },
  }),
}))

const { archiveBankAccount, deleteBankAccount, restoreBankAccount } = await import('../writes')

const ORG = 'org_1'
const USER = 'user_1'
const ACCOUNT = 'acct_1'

function account(partial: Partial<BankAccountRow> = {}): BankAccountRow {
  return {
    id: ACCOUNT,
    recordId: `def_ba:${ACCOUNT}`,
    name: 'Business Adv Relationship',
    institution: 'Bank of America',
    last4: '5381',
    type: 'depository',
    currency: 'USD',
    glAccountCode: '1010',
    feedStartDate: null,
    coverageFrom: '2026-01-01',
    coverageGaps: [],
    connectorId: null,
    status: 'manual',
    hasEverPosted: false,
    archivedAt: null,
    createdAt: null,
    connector: null,
    ...partial,
  }
}

function facts(partial: Partial<BankAccountRemovalFacts> = {}): BankAccountRemovalFacts {
  return {
    hasEverPosted: false,
    transactionCount: 0,
    matchedCount: 0,
    unreviewedCount: 0,
    connectorId: null,
    rules: [],
    ...partial,
  }
}

/** A db double whose only real jobs are the connector delete and the sibling probe. */
function fakeDb() {
  return {
    delete: () => ({
      where: () => ({
        returning: async () => {
          h.trace.push('delete-connector')
          h.deletes.push('DataConnector')
          return [{ id: 'conn_1' }]
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => h.siblings,
        }),
      }),
    }),
  } as never
}

beforeEach(() => {
  h.trace.length = 0
  h.deletes.length = 0
  h.siblings = []
  h.linesByState.clear()
  h.cascadeLineIds = []
  h.account = account()
  h.facts = facts()
  vi.clearAllMocks()
  h.reapBankFeedAccount.mockImplementation(async () => {
    h.trace.push('reap')
    return true
  })
  h.findBankFeedAccountForConnector.mockImplementation(async () => ({
    connectorId: 'conn_1',
    organizationId: ORG,
    credentialId: 'cred_1',
    providerAccountId: 'fca_123',
  }))
  h.disconnectBankAccountFeed.mockImplementation(async () => {
    h.trace.push('disconnect')
    return { isErr: () => false, isOk: () => true, value: {} }
  })
  h.deleteCredential.mockImplementation(async () => {
    h.trace.push('delete-credential')
    return { isOk: () => true, isErr: () => false }
  })
  h.crudDelete.mockImplementation(async (recordId: string) => {
    h.trace.push(`crud-delete ${recordId}`)
  })
  h.crudArchive.mockImplementation(async (recordId: string) => {
    h.trace.push(`crud-archive ${recordId}`)
  })
  h.crudRestore.mockImplementation(async (recordId: string) => {
    h.trace.push(`crud-restore ${recordId}`)
  })
  h.crudUpdate.mockImplementation(async (recordId: string) => {
    h.trace.push(`crud-update ${recordId}`)
  })
})

describe('deleteBankAccount', () => {
  it('releases at Stripe BEFORE dropping the connector', async () => {
    h.account = account({ connectorId: 'conn_1', status: 'connected' })
    h.facts = facts({ connectorId: 'conn_1', transactionCount: 2 })
    h.cascadeLineIds = ['txn_1', 'txn_2']

    const result = await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    expect(h.trace.indexOf('reap')).toBeGreaterThanOrEqual(0)
    expect(h.trace.indexOf('reap')).toBeLessThan(h.trace.indexOf('delete-connector'))
  })

  it('drops NOTHING when the release threw', async () => {
    h.account = account({ connectorId: 'conn_1', status: 'connected' })
    h.facts = facts({ connectorId: 'conn_1' })
    h.reapBankFeedAccount.mockRejectedValue(new Error('stripe is down'))

    const result = await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isErr()).toBe(true)
    // 🛑 The account is still whole, so pressing Remove again is a real retry.
    expect(h.deletes).toEqual([])
    expect(h.crudDelete).not.toHaveBeenCalled()
    expect(h.deleteCredential).not.toHaveBeenCalled()
  })

  it('deletes every line whatever its review status, then the account last', async () => {
    h.facts = facts({ transactionCount: 3, matchedCount: 1 })
    // The third is ARCHIVED, and it goes too: a line left pointing at a deleted
    // account is an orphan nothing would ever clean up.
    h.cascadeLineIds = ['txn_1', 'txn_2', 'txn_3']

    const result = await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.transactionsDeleted).toBe(3)
    expect(h.trace).toEqual([
      'crud-delete def_bt:txn_1',
      'crud-delete def_bt:txn_2',
      'crud-delete def_bt:txn_3',
      `crud-delete def_ba:${ACCOUNT}`,
    ])
  })

  it('refuses once anything has posted, and names the archive', async () => {
    h.facts = facts({ hasEverPosted: true })

    const result = await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/archived/)
    expect(h.trace).toEqual([])
  })

  it('keeps the credential when another connector still holds the same LOGIN', async () => {
    h.account = account({ connectorId: 'conn_1', status: 'connected' })
    h.facts = facts({ connectorId: 'conn_1' })
    h.siblings = [{ id: 'conn_2' }]

    await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    // 🛑 One credential is one bank LOGIN. Deleting it would take the sibling
    // account's feed down as a side effect of removing this one.
    expect(h.deleteCredential).not.toHaveBeenCalled()
  })

  it('deletes the credential when this was the last account on the login', async () => {
    h.account = account({ connectorId: 'conn_1', status: 'connected' })
    h.facts = facts({ connectorId: 'conn_1' })
    h.siblings = []

    const result = await deleteBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(h.deleteCredential).toHaveBeenCalledWith('cred_1', ORG)
    if (result.isOk()) expect(result.value.credentialDeleted).toBe(true)
  })
})

describe('archiveBankAccount', () => {
  it('disconnects AND reaps before setting archivedAt', async () => {
    h.account = account({ connectorId: 'conn_1', status: 'connected', hasEverPosted: true })

    const result = await archiveBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.disconnected).toBe(true)
    // `disconnectBankAccountFeed` is what calls `reapBankFeedAccount`, and it is
    // the only thing that stops the 30c a month. Archiving a still-billing
    // account out of the UI is the leak `feed/reaper.ts` was built to stop.
    expect(h.trace.indexOf('disconnect')).toBe(0)
    expect(h.trace.indexOf('disconnect')).toBeLessThan(
      h.trace.indexOf(`crud-archive def_ba:${ACCOUNT}`)
    )
  })

  it('sweeps for_review and suggested to excluded with the prefix, and nothing else', async () => {
    h.account = account({ hasEverPosted: true })
    h.linesByState.set('for_review', [{ id: 'txn_a' }, { id: 'txn_b' }])
    h.linesByState.set('suggested', [{ id: 'txn_c' }])
    // 🛑 Present in the store and NEVER asked for. `matched`, `coded` and
    // human-`excluded` rows are already in the books or carry somebody's
    // decision, so the narrowing is done in the query rather than afterwards.
    h.linesByState.set('matched', [{ id: 'txn_matched' }])
    h.linesByState.set('coded', [{ id: 'txn_coded' }])
    h.linesByState.set('excluded', [{ id: 'txn_excluded' }])

    const result = await archiveBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.excluded).toBe(3)

    const touched = h.crudUpdate.mock.calls.map((call) => call[0])
    expect(touched).toEqual(['def_bt:txn_a', 'def_bt:txn_b', 'def_bt:txn_c'])
    for (const call of h.crudUpdate.mock.calls) {
      expect(call[1]).toMatchObject({ bank_transaction_review_status: 'excluded' })
      expect(String((call[1] as Record<string, unknown>).bank_transaction_exclude_reason)).toMatch(
        /^Excluded when the bank account was archived/
      )
    }
  })

  it('leaves GlPosting and the mapped gl_account untouched', async () => {
    // 🛑 The regression test §3 asks for. A `bank_account` carries a POINTER to a
    // GL code and `GlPostingLine` snapshots the code with no foreign key back
    // here, so archiving cannot move the trial balance by a cent. The only way it
    // could is if this path started writing to the chart or the ledger.
    h.account = account({ hasEverPosted: true, glAccountCode: '1010' })
    h.linesByState.set('for_review', [{ id: 'txn_a' }])

    await archiveBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    // No raw db write of any kind, so no `GlPosting` and no `GlAccount` row moved.
    expect(h.deletes).toEqual([])
    // The only record writes are the three exclusions and the archive itself.
    for (const call of h.crudUpdate.mock.calls) {
      expect(String(call[0])).toMatch(/^def_bt:/)
      const patch = call[1] as Record<string, unknown>
      expect(patch).not.toHaveProperty('bank_account_gl_account')
      expect(patch).not.toHaveProperty('bank_account_coverage_from')
    }
    expect(h.crudArchive).toHaveBeenCalledTimes(1)
    expect(h.crudArchive).toHaveBeenCalledWith(`def_ba:${ACCOUNT}`)
    expect(h.crudDelete).not.toHaveBeenCalled()
  })

  it('never clears coverage_from', async () => {
    // A balance sheet spanning the archived account's period still has to know
    // what was covered (§5.3).
    h.account = account({ hasEverPosted: true, coverageFrom: '2026-01-01' })

    await archiveBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    const accountWrites = h.crudUpdate.mock.calls.filter((call) =>
      String(call[0]).startsWith('def_ba:')
    )
    expect(accountWrites).toEqual([])
  })
})

describe('restoreBankAccount', () => {
  it('round-trips an archived account', async () => {
    h.account = account({ hasEverPosted: true, archivedAt: new Date('2026-09-08T00:00:00.000Z') })

    const result = await restoreBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    expect(h.crudRestore).toHaveBeenCalledWith(`def_ba:${ACCOUNT}`)
  })

  it("re-opens the ARCHIVE's own exclusions and leaves a person's alone", async () => {
    h.account = account({ hasEverPosted: true, archivedAt: new Date('2026-09-08T00:00:00.000Z') })
    h.linesByState.set('excluded', [
      { id: 'txn_swept', excludeReason: 'Excluded when the bank account was archived: Checking' },
      { id: 'txn_human', excludeReason: 'Personal, not the business' },
      { id: 'txn_no_reason', excludeReason: null },
    ])

    const result = await restoreBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    // 🛑 Exactly one row moves. Reversibility is the whole argument for sweeping
    // the queue instead of refusing the archive (plan §6), and "undo it one row
    // at a time" is not a path for the 400-row account this feature exists to
    // clean up - so a restore that left them excluded would make archive one-way
    // in practice. But a row a PERSON excluded carries their decision and the
    // reason they had to give for it, and survives untouched.
    const touched = h.crudUpdate.mock.calls.map((call) => call[0])
    expect(touched).toEqual(['def_bt:txn_swept'])
    expect(h.crudUpdate.mock.calls[0]?.[1]).toMatchObject({
      bank_transaction_review_status: 'for_review',
      bank_transaction_exclude_reason: null,
    })
  })

  it('re-opens nothing when the archive swept nothing', async () => {
    h.account = account({ hasEverPosted: true, archivedAt: new Date('2026-09-08T00:00:00.000Z') })
    h.linesByState.set('excluded', [{ id: 'txn_human', excludeReason: 'Owner draw' }])

    const result = await restoreBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isOk()).toBe(true)
    expect(h.crudUpdate).not.toHaveBeenCalled()
  })

  it('refuses an account that is not archived', async () => {
    h.account = account({ archivedAt: null })

    const result = await restoreBankAccount(fakeDb(), {
      organizationId: ORG,
      actorUserId: USER,
      bankAccountId: ACCOUNT,
    })

    expect(result.isErr()).toBe(true)
    expect(h.crudRestore).not.toHaveBeenCalled()
  })
})
