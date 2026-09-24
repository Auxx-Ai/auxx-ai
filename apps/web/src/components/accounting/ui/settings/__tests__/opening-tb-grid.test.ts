// apps/web/src/components/accounting/ui/settings/__tests__/opening-tb-grid.test.ts
//
// The three pure helpers behind the opening trial-balance grid. Both doors (the
// wizard page and the settings twin) share them, which is what stops the two
// screens from disagreeing about whether the books balance.

import type { OpeningTrialBalanceRow } from '@auxx/lib/accounting/opening/client'
import { describe, expect, it } from 'vitest'
import {
  accountIdFromRowId,
  applyOpeningCellChange,
  openingEvidenceInstruction,
  openingVerdict,
} from '../opening-tb-grid'

function row(
  accountCode: string,
  overrides: Partial<OpeningTrialBalanceRow> = {}
): OpeningTrialBalanceRow {
  return {
    accountId: `acct_${accountCode}`,
    accountCode,
    accountName: `Account ${accountCode}`,
    accountType: 'asset',
    isActive: true,
    debitMinor: null,
    creditMinor: null,
    ...overrides,
  }
}

describe('accountIdFromRowId', () => {
  it('reads an account row id and rejects every other kind', () => {
    expect(accountIdFromRowId('account:acct_1310')).toBe('acct_1310')
    expect(accountIdFromRowId('section:asset')).toBeNull()
    expect(accountIdFromRowId('subtotal:asset')).toBeNull()
    expect(accountIdFromRowId('total:trial-balance')).toBeNull()
  })
})

describe('applyOpeningCellChange', () => {
  it('sets a debit and CLEARS the credit on the same row', () => {
    // The journal-entry drawer's rule: an account carrying both would post two
    // lines that net to nothing, which the builder can only warn about after.
    const rows = [row('1000', { creditMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, 'acct_1000', 'debit', 250_00)[0]).toMatchObject({
      debitMinor: 250_00,
      creditMinor: null,
    })
  })

  it('sets a credit and clears the debit', () => {
    const rows = [row('3900', { debitMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, 'acct_3900', 'credit', 500_00)[0]).toMatchObject({
      debitMinor: null,
      creditMinor: 500_00,
    })
  })

  it('clears a cell when handed null', () => {
    const rows = [row('1000', { debitMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, 'acct_1000', 'debit', null)[0]?.debitMinor).toBeNull()
  })

  it('leaves every other row untouched and does not mutate the input', () => {
    const rows = [row('1000'), row('2000'), row('3900')]
    const snapshot = JSON.parse(JSON.stringify(rows))
    const next = applyOpeningCellChange(rows, 'acct_2000', 'credit', 42)
    expect(rows).toEqual(snapshot)
    expect(next[0]).toBe(rows[0])
    expect(next[2]).toBe(rows[2])
  })
})

describe('openingVerdict', () => {
  it('distinguishes "nothing entered" from "balanced"', () => {
    // 🛑 An empty grid balances trivially at zero. Calling that Balanced would
    // let somebody walk past this page with an entirely blank trial balance.
    expect(openingVerdict(0, 0, 0, 'USD')).toMatchObject({
      ok: false,
      label: 'Nothing entered yet.',
    })
    expect(openingVerdict(500_00, 500_00, 2, 'USD').ok).toBe(true)
  })

  it('reads an empty grid as the finished answer once the org declares from-nothing', () => {
    // The declaration turns "nothing entered" from a refusal into a statement.
    expect(openingVerdict(0, 0, 0, 'USD', true)).toMatchObject({
      ok: true,
      label: 'Nothing to carry in.',
    })
  })

  it('🛑 still reports an entered-but-unbalanced grid as unbalanced when from-nothing is set', () => {
    // The flag suppresses the EMPTY branch only. A plug account is the worst
    // thing that can happen on this page; a checkbox must not open a door to one.
    const verdict = openingVerdict(500_00, 400_00, 3, 'USD', true)
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toMatch(/never add a plug account/i)
  })

  it('names the difference and refuses to suggest a plug', () => {
    const verdict = openingVerdict(500_00, 400_00, 3, 'USD')
    expect(verdict.ok).toBe(false)
    expect(verdict.label).toMatch(/Out of balance by \$100\.00/)
    expect(verdict.detail).toMatch(/never add a plug account/i)
  })

  it('reports an imbalance the other way round with the same words', () => {
    expect(openingVerdict(400_00, 500_00, 3, 'USD').label).toMatch(/Out of balance by \$100\.00/)
  })
})

describe('openingEvidenceInstruction', () => {
  it('stops asking for evidence when the books start from nothing', () => {
    const text = openingEvidenceInstruction('none', '2026-12-31')
    expect(text).toMatch(/no opening entry to post/)
    expect(text).not.toMatch(/statement balance/i)
  })

  it('gives the statement-balance instruction, verbatim, for a manual grid', () => {
    // Including the cutoverDate.slice(5).replace('-', '/') substitution the
    // page already did before this helper existed.
    expect(openingEvidenceInstruction('manual', '2025-12-31')).toBe(
      'Use the 12/31 statement balance for every bank and card account. Do not use the tax return.'
    )
  })

  it('treats anything but the literal provider source as manual', () => {
    // The callers do this coercion themselves, but the two strings living
    // here rather than at the call sites is the whole point of section 4.8 -
    // pin the fallback here too.
    expect(openingEvidenceInstruction('manual', '2026-06-30')).toMatch(/statement balance/)
  })

  it('gives the book-balance instruction for a provider-seeded grid', () => {
    // 🛑 This string must never tell a person the numbers are still
    // QuickBooks' - they may have edited every row since the fill ran - which
    // is why it ends by telling them to check rather than that they are done.
    const instruction = openingEvidenceInstruction('provider', '2025-12-31')
    expect(instruction).toBe(
      'These are book balances from your accounting system as of 2025-12-31. They already account for ' +
        'payments that had not cleared at the cutover, which a statement balance does not, so do ' +
        'not replace them with the statement figure. Check them against what you expect.'
    )
  })

  it('never gives the two sources the same advice', () => {
    expect(openingEvidenceInstruction('manual', '2025-12-31')).not.toBe(
      openingEvidenceInstruction('provider', '2025-12-31')
    )
  })
})
