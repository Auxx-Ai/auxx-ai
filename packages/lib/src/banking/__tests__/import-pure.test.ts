// packages/lib/src/banking/__tests__/import-pure.test.ts

/**
 * The pure half of `banking/import/`: the header signature, the synthesised
 * external id, the two overlap doors, the gap arithmetic and the reverse
 * refusals.
 *
 * No database and no doubles. Every function under test was deliberately split
 * out of its write path so that the rules that decide whether money is
 * duplicated or lost can be pinned without one.
 */

import { describe, expect, it } from 'vitest'
import { computeOverlap, earliest, withinWindow } from '../import/coverage-effect'
import type { BankTransactionRow } from '../import/fields'
import { subtractCoveredRange } from '../import/gaps'
import { headerSignature, normaliseHeader } from '../import/header-signature'
import { assignImportedExternalIds, buildImportedExternalId } from '../import/match-key'
import { refusalReason } from '../import/reverse'
import type { BankImportRow } from '../import/types'
import { IMPORT_LINK_EXCLUSION_PREFIX } from '../import/types'

const BOA_HEADERS = ['Date', 'Description', 'Amount', 'Running Bal.']

function row(partial: Partial<BankImportRow> = {}): BankImportRow {
  return {
    externalId: null,
    postedAt: '2026-01-15',
    amountMinor: -12450,
    description: 'ACME SUPPLY CO',
    ...partial,
  }
}

function existing(partial: Partial<BankTransactionRow> = {}): BankTransactionRow {
  return {
    id: 'txn_1',
    createdAt: null,
    externalId: null,
    bankAccountId: 'acct_1',
    postedAt: '2026-01-15',
    description: 'ACME SUPPLY CO',
    amountMinor: -12450,
    matchKey: 'acme supply co',
    importBatchId: null,
    source: 'feed',
    reviewStatus: 'for_review',
    excludeReason: null,
    glPostingId: null,
    ...partial,
  }
}

describe('headerSignature', () => {
  it('is stable across two runs of the same header row', () => {
    expect(headerSignature(BOA_HEADERS)).toBe(headerSignature(BOA_HEADERS))
  })

  it('survives case, padding, punctuation and a BOM', () => {
    expect(headerSignature(['﻿Date', ' DESCRIPTION ', '"Amount"', 'Running  Bal.'])).toBe(
      headerSignature(BOA_HEADERS)
    )
  })

  it('changes when a column is added', () => {
    expect(headerSignature([...BOA_HEADERS, 'Check #'])).not.toBe(headerSignature(BOA_HEADERS))
  })

  it('changes when the columns are REORDERED', () => {
    // The mapping is stored per column INDEX, so a reordered file needs its own
    // mapping - prefilling the old one would map a running balance as an amount.
    expect(headerSignature(['Description', 'Date', 'Amount', 'Running Bal.'])).not.toBe(
      headerSignature(BOA_HEADERS)
    )
  })

  it('does not confuse a split header with a joined one', () => {
    expect(headerSignature(['ab', 'c'])).not.toBe(headerSignature(['a', 'bc']))
  })

  it('keeps an empty trailing header, which is a real column', () => {
    expect(headerSignature([...BOA_HEADERS, ''])).not.toBe(headerSignature(BOA_HEADERS))
  })

  it('is a 32-character hex digest', () => {
    expect(headerSignature(BOA_HEADERS)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('normalises one header cell to lower-case alphanumerics and single spaces', () => {
    expect(normaliseHeader('  Running  Bal. ')).toBe('running bal')
    expect(normaliseHeader(null)).toBe('')
  })
})

describe('buildImportedExternalId / assignImportedExternalIds', () => {
  it('is deterministic for the same row', () => {
    const args = {
      bankAccountId: 'acct_1',
      postedAt: '2026-01-15',
      amountMinor: -12450,
      matchKey: 'acme supply co',
      ordinal: 0,
    }
    expect(buildImportedExternalId(args)).toBe(buildImportedExternalId(args))
    expect(buildImportedExternalId(args)).toBe('imp:acct_1:20260115:-12450:acme-supply-co:0')
  })

  it('gives two identical same-day rows two different ids', () => {
    // 🛑 The failure this exists to prevent: two $50 fuel purchases collapsing
    // into one row and losing money from the ledger.
    const fuel = { postedAt: '2026-01-31', amountMinor: -5000, description: 'FUEL STOP 12' }
    const ids = assignImportedExternalIds('acct_1', [row(fuel), row(fuel)]).map((r) => r.externalId)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[1]?.endsWith(':1')).toBe(true)
  })

  it('reproduces the same ids when the same file is assigned again', () => {
    const fuel = { postedAt: '2026-01-31', amountMinor: -5000, description: 'FUEL STOP 12' }
    const first = assignImportedExternalIds('acct_1', [row(fuel), row(fuel), row()])
    const second = assignImportedExternalIds('acct_1', [row(fuel), row(fuel), row()])
    expect(first.map((r) => r.externalId)).toEqual(second.map((r) => r.externalId))
  })

  it('scopes the id to the account, because externalId is unique across the org', () => {
    const [a] = assignImportedExternalIds('acct_1', [row()])
    const [b] = assignImportedExternalIds('acct_2', [row()])
    expect(a?.externalId).not.toBe(b?.externalId)
  })

  it('keeps a FITID the file already gave', () => {
    const [assigned] = assignImportedExternalIds('acct_1', [row({ externalId: '202601150001' })])
    expect(assigned?.externalId).toBe('202601150001')
  })

  it('answers null rather than a partial id for a row with no date or amount', () => {
    const [noDate] = assignImportedExternalIds('acct_1', [row({ postedAt: null })])
    const [noAmount] = assignImportedExternalIds('acct_1', [row({ amountMinor: null })])
    expect(noDate?.externalId).toBeNull()
    expect(noAmount?.externalId).toBeNull()
  })

  it('survives a description that normalises to nothing', () => {
    const [assigned] = assignImportedExternalIds('acct_1', [row({ description: '00998877' })])
    expect(assigned?.matchKey).toBe('')
    expect(assigned?.externalId).toContain(':no-description:0')
  })
})

describe('computeOverlap', () => {
  it('counts an existing externalId as an update, not an addition', () => {
    const overlap = computeOverlap(
      'acct_1',
      [row({ externalId: 'fitid-1' })],
      [existing({ externalId: 'fitid-1' })]
    )
    expect(overlap).toEqual({ byExternalId: 1, byMatchKey: 0, added: 0 })
  })

  it('links a feed row by (date, amount, matchKey)', () => {
    const overlap = computeOverlap('acct_1', [row()], [existing({ source: 'feed' })])
    expect(overlap).toEqual({ byExternalId: 0, byMatchKey: 1, added: 0 })
  })

  it('links across a three-day posting difference but not a four-day one', () => {
    const near = computeOverlap('acct_1', [row()], [existing({ postedAt: '2026-01-18' })])
    const far = computeOverlap('acct_1', [row()], [existing({ postedAt: '2026-01-19' })])
    expect(near.byMatchKey).toBe(1)
    expect(far.byMatchKey).toBe(0)
    expect(far.added).toBe(1)
  })

  it('🛑 does NOT link two same-source rows that merely look alike', () => {
    // Two $50 fuel purchases on the same day from the same door are two real
    // transactions. Only a CROSS-source collision is a duplicate (05 §6).
    const overlap = computeOverlap(
      'acct_1',
      [row()],
      [existing({ source: 'import', externalId: null })]
    )
    expect(overlap).toEqual({ byExternalId: 0, byMatchKey: 0, added: 1 })
  })

  it('claims each feed row at most once, so a standing order cannot over-count', () => {
    const overlap = computeOverlap('acct_1', [row(), row(), row()], [existing()])
    expect(overlap).toEqual({ byExternalId: 0, byMatchKey: 1, added: 2 })
  })

  it('does not link on an empty matchKey', () => {
    const overlap = computeOverlap(
      'acct_1',
      [row({ description: '00998877' })],
      [existing({ matchKey: '', description: '00112233' })]
    )
    expect(overlap.byMatchKey).toBe(0)
  })

  it('does not link when only the amount differs', () => {
    const overlap = computeOverlap('acct_1', [row()], [existing({ amountMinor: -12451 })])
    expect(overlap).toEqual({ byExternalId: 0, byMatchKey: 0, added: 1 })
  })

  it('adds every row when the account is empty', () => {
    expect(computeOverlap('acct_1', [row(), row()], [])).toEqual({
      byExternalId: 0,
      byMatchKey: 0,
      added: 2,
    })
  })

  it('🛑 does not count an UNUSABLE row as one it would add', () => {
    // `previewCoverageEffect` reports these separately as `unusableRowCount`,
    // and the confirm step renders both figures - so counting them here made one
    // screen say "3 rows, 2 unusable, 3 added".
    const overlap = computeOverlap(
      'acct_1',
      [row(), row({ postedAt: null }), row({ amountMinor: null })],
      []
    )
    expect(overlap.added).toBe(1)
  })

  it('never reports a negative addition, however the doors claimed the rows', () => {
    // An unusable row can still carry an external id and be claimed by that door.
    const overlap = computeOverlap(
      'acct_1',
      [row({ externalId: 'fitid-1', postedAt: null })],
      [existing({ externalId: 'fitid-1' })]
    )
    expect(overlap.byExternalId).toBe(1)
    expect(overlap.added).toBe(0)
  })

  it('mixes the two doors in one file', () => {
    const overlap = computeOverlap(
      'acct_1',
      [row({ externalId: 'fitid-1' }), row({ description: 'CITY WATER DEPT' }), row()],
      [
        existing({ id: 'a', externalId: 'fitid-1' }),
        existing({ id: 'b', externalId: null, matchKey: 'city water dept' }),
      ]
    )
    expect(overlap).toEqual({ byExternalId: 1, byMatchKey: 1, added: 1 })
  })
})

describe('withinWindow / earliest', () => {
  it('is inclusive of the three-day bound in both directions', () => {
    expect(withinWindow('2026-01-15', '2026-01-18')).toBe(true)
    expect(withinWindow('2026-01-18', '2026-01-15')).toBe(true)
    expect(withinWindow('2026-01-15', '2026-01-19')).toBe(false)
  })

  it('is false when either side has no date', () => {
    expect(withinWindow(null, '2026-01-15')).toBe(false)
    expect(withinWindow('2026-01-15', null)).toBe(false)
  })

  it('picks the earlier of two dates, ignoring nulls', () => {
    expect(earliest('2026-03-07', '2026-01-01')).toBe('2026-01-01')
    expect(earliest(null, '2026-01-01')).toBe('2026-01-01')
    expect(earliest('2026-01-01', null)).toBe('2026-01-01')
    expect(earliest(null, null)).toBeNull()
  })
})

describe('subtractCoveredRange', () => {
  const gap = { from: '2026-01-01', to: '2026-03-07' }

  it('closes a gap the file covers end to end', () => {
    expect(subtractCoveredRange(gap, '2025-12-31', '2026-03-08')).toEqual([])
    expect(subtractCoveredRange(gap, '2026-01-01', '2026-03-07')).toEqual([])
  })

  it('shrinks a gap the file covers the front of', () => {
    expect(subtractCoveredRange(gap, '2026-01-01', '2026-02-14')).toEqual([
      { from: '2026-02-15', to: '2026-03-07' },
    ])
  })

  it('shrinks a gap the file covers the back of', () => {
    expect(subtractCoveredRange(gap, '2026-02-15', '2026-03-07')).toEqual([
      { from: '2026-01-01', to: '2026-02-14' },
    ])
  })

  it('splits a gap the file covers the middle of', () => {
    expect(subtractCoveredRange(gap, '2026-02-01', '2026-02-14')).toEqual([
      { from: '2026-01-01', to: '2026-01-31' },
      { from: '2026-02-15', to: '2026-03-07' },
    ])
  })

  it('leaves a gap the file does not touch', () => {
    expect(subtractCoveredRange(gap, '2026-04-01', '2026-04-30')).toEqual([gap])
    expect(subtractCoveredRange(gap, '2025-11-01', '2025-12-31')).toEqual([gap])
  })

  it('leaves the gap alone when the file has no usable range', () => {
    expect(subtractCoveredRange(gap, null, '2026-03-07')).toEqual([gap])
    expect(subtractCoveredRange(gap, '2026-01-01', null)).toEqual([gap])
    expect(subtractCoveredRange(gap, '2026-03-07', '2026-01-01')).toEqual([gap])
  })

  it('drops a malformed gap rather than propagating it', () => {
    expect(subtractCoveredRange({ from: '2026-03-07', to: '2026-01-01' }, null, null)).toEqual([])
  })
})

describe('refusalReason', () => {
  it('refuses a row that carries a posting, naming the posting', () => {
    const reason = refusalReason(existing({ glPostingId: 'gp_42' }))
    expect(reason).toContain('gp_42')
    expect(reason).toContain('reversed in the ledger')
  })

  it('refuses a matched row, saying what the match means', () => {
    expect(refusalReason(existing({ reviewStatus: 'matched' }))).toContain('cleared')
  })

  it('refuses a coded row', () => {
    expect(refusalReason(existing({ reviewStatus: 'coded' }))).toContain('un-code it first')
  })

  it('names the posting first when a row is both posted and matched', () => {
    expect(refusalReason(existing({ glPostingId: 'gp_42', reviewStatus: 'matched' }))).toContain(
      'gp_42'
    )
  })

  it('allows a row nobody has decided anything about', () => {
    expect(refusalReason(existing())).toBeNull()
    expect(refusalReason(existing({ reviewStatus: 'suggested' }))).toBeNull()
  })

  it("🛑 refuses a person's exclusion - `crud.delete` is a HARD delete", () => {
    // An exclusion carries a REQUIRED reason, which is the record of somebody
    // deciding this line is not ours. Reversing the import destroyed both.
    const reason = refusalReason(
      existing({ reviewStatus: 'excluded', excludeReason: 'Personal charge, my card' })
    )
    expect(reason).toContain('excluded by a person')
  })

  it("allows the IMPORT's own cross-source exclusion, which is its bookkeeping", () => {
    // The importer excludes a row it linked to the feed row that already held
    // the same transaction. That one belongs to the import and goes with it.
    expect(
      refusalReason(
        existing({
          reviewStatus: 'excluded',
          excludeReason: `${IMPORT_LINK_EXCLUSION_PREFIX} bt-77 on 2026-01-15. The feed row is the one to review.`,
        })
      )
    ).toBeNull()
  })
})
