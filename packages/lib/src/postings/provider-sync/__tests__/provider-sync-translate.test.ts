// packages/lib/src/postings/provider-sync/__tests__/provider-sync-translate.test.ts
//
// The second pass (TARGET §1, §2): the accountant's half of the mirror becomes
// `provider_sync` postings, and a mirror entry that has been withdrawn takes its
// posting out with a reversal.
//
// The mirror READ is the boundary mocked here - `readMirrorForTranslation` has
// already applied `author = 'provider'`, which is why nothing of ours reaches
// this file at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readMirror = vi.hoisted(() => vi.fn())
const postEntry = vi.hoisted(() => vi.fn())
const reverseEntry = vi.hoisted(() => vi.fn())

vi.mock('../reads', () => ({ readMirrorForTranslation: readMirror }))
vi.mock('../../post-entry', () => ({ postEntry }))
vi.mock('../../reverse-entry', () => ({ reverseEntry }))

import type { MirrorEntry } from '../reads'
import { translateMirrorRange } from '../translate'

const ORG = 'org_1'
const db = {} as never

const INPUT = {
  bookId: 'book_1',
  from: '2026-01-01',
  to: '2026-01-31',
  glAccountIdByProviderId: new Map([
    ['41', 'acct_mastercard'],
    ['35', 'acct_checking'],
  ]),
  providerId: 'quickbooks',
  lock: { lockedThroughMonth: null },
}

function mirrorEntry(overrides: Partial<MirrorEntry> = {}): MirrorEntry {
  return {
    id: 'ple_1',
    providerTxnType: 'Credit Card Expense',
    providerTxnId: '77',
    txnDate: '2026-01-15',
    docNumber: 'JE-9',
    withdrawn: false,
    lines: [
      {
        txnType: 'Credit Card Expense',
        txnId: '77',
        txnDate: '2026-01-15',
        providerAccountId: '41',
        providerAccountName: 'Mastercard',
        debitMinor: 4500,
        creditMinor: 0,
        docNumber: 'JE-9',
        memo: null,
      },
      {
        txnType: 'Credit Card Expense',
        txnId: '77',
        txnDate: '2026-01-15',
        providerAccountId: '35',
        providerAccountName: 'Checking',
        debitMinor: 0,
        creditMinor: 4500,
        docNumber: 'JE-9',
        memo: null,
      },
    ],
    livePostingId: null,
    liveDocNumber: null,
    ...overrides,
  }
}

function found(entries: MirrorEntry[]) {
  return { isErr: () => false, value: entries }
}

beforeEach(() => {
  readMirror.mockReset()
  postEntry.mockReset()
  reverseEntry.mockReset()
  postEntry.mockResolvedValue({ status: 'not_exported', glPostingId: 'glp_1', docNumber: 'PSY-1' })
  reverseEntry.mockResolvedValue({ status: 'not_exported', glPostingId: 'glp_2' })
})

describe('an entry the accountant authored', () => {
  it('posts as provider_sync with the MIRROR row as its subject', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry()]))

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap().written).toBe(1)
    const options = postEntry.mock.calls[0]![1]
    expect(options.mode).toBe('post')
    expect(options.entry.postingType).toBe('provider_sync')
    // 🛑 The mirror row's id, not their transaction id: our books point at the
    // mirror, so a re-read that re-keys the transaction moves one row rather
    // than orphaning a claim.
    expect(options.sources).toEqual([
      { sourceKind: 'provider_ledger_entry', sourceId: 'ple_1', linkRole: 'subject' },
    ])
    expect(options.entry.lines.map((line: { glAccountId: string }) => line.glAccountId)).toEqual([
      'acct_mastercard',
      'acct_checking',
    ])
  })

  it('is not posted twice - a live posting on the mirror row is already_posted', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry({ livePostingId: 'glp_1' })]))

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap().alreadyPosted).toBe(1)
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('refuses naming the account when a provider account is unmapped, and writes nothing', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry()]))

    const result = await translateMirrorRange(db, ORG, {
      ...INPUT,
      glAccountIdByProviderId: new Map([['41', 'acct_mastercard']]),
    })

    const outcome = result._unsafeUnwrap()
    expect(outcome.written).toBe(0)
    expect(outcome.refusals[0]).toContain("'35'")
    expect(outcome.refusals[0]).toContain('Checking')
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('is never translated when it does not balance', async () => {
    const unbalanced = mirrorEntry()
    unbalanced.lines[1]!.creditMinor = 4000
    readMirror.mockResolvedValue(found([unbalanced]))

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap().written).toBe(0)
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('is deferred, not written, into a month our own lock has closed', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry()]))

    const result = await translateMirrorRange(db, ORG, {
      ...INPUT,
      lock: { lockedThroughMonth: '2026-01' },
    })

    const outcome = result._unsafeUnwrap()
    expect(outcome.deferredToClosedMonths).toEqual([
      {
        month: '2026-01',
        txnType: 'Credit Card Expense',
        txnId: '77',
        txnDate: '2026-01-15',
        totalMinor: 4500,
        action: 'write',
      },
    ])
    expect(postEntry).not.toHaveBeenCalled()
  })
})

describe('an entry that has stopped appearing', () => {
  it('is REVERSED, never deleted, so the pair stays auditable', async () => {
    readMirror.mockResolvedValue(
      found([mirrorEntry({ withdrawn: true, livePostingId: 'glp_1', liveDocNumber: 'PSY-1' })])
    )

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap().reversed).toBe(1)
    expect(reverseEntry.mock.calls[0]![1]).toMatchObject({ glPostingId: 'glp_1' })
    expect(reverseEntry.mock.calls[0]![1].memo).toContain('no longer appears')
    expect(postEntry).not.toHaveBeenCalled()
  })

  it('is a no-op when our books never carried it', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry({ withdrawn: true })]))

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({ reversed: 0, written: 0, refusals: [] })
    expect(reverseEntry).not.toHaveBeenCalled()
  })

  it('names the entry when the reversal is refused', async () => {
    readMirror.mockResolvedValue(found([mirrorEntry({ withdrawn: true, livePostingId: 'glp_1' })]))
    reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'January is closed' })

    const result = await translateMirrorRange(db, ORG, INPUT)

    expect(result._unsafeUnwrap().refusals[0]).toContain('Credit Card Expense 77')
    expect(result._unsafeUnwrap().reversed).toBe(0)
  })
})
