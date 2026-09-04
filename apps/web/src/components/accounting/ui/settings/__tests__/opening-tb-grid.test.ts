// apps/web/src/components/accounting/ui/settings/__tests__/opening-tb-grid.test.ts
//
// The three pure helpers behind the opening trial-balance grid. Both doors (the
// wizard page and the settings twin) share them, which is what stops the two
// screens from disagreeing about whether the books balance.
//
// `overlayInventorySettings` is here because it is a DRIVEN bug fix: the locked
// inventory rows arrived empty in the browser, because every page of the wizard
// mounts at once and `ledgerOpening.get` therefore fires before the previous
// page's settings write lands.

import type { OpeningTrialBalanceRow } from '@auxx/lib/postings/client'
import { describe, expect, it } from 'vitest'
import {
  accountCodeFromRowId,
  applyOpeningCellChange,
  openingVerdict,
  overlayInventorySettings,
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

describe('accountCodeFromRowId', () => {
  it('reads an account row id and rejects every other kind', () => {
    expect(accountCodeFromRowId('account:1310')).toBe('1310')
    expect(accountCodeFromRowId('section:asset')).toBeNull()
    expect(accountCodeFromRowId('subtotal:asset')).toBeNull()
    expect(accountCodeFromRowId('total:trial-balance')).toBeNull()
  })
})

describe('applyOpeningCellChange', () => {
  it('sets a debit and CLEARS the credit on the same row', () => {
    // The journal-entry drawer's rule: an account carrying both would post two
    // lines that net to nothing, which the builder can only warn about after.
    const rows = [row('1000', { creditMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, '1000', 'debit', 250_00)[0]).toMatchObject({
      debitMinor: 250_00,
      creditMinor: null,
    })
  })

  it('sets a credit and clears the debit', () => {
    const rows = [row('3900', { debitMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, '3900', 'credit', 500_00)[0]).toMatchObject({
      debitMinor: null,
      creditMinor: 500_00,
    })
  })

  it('clears a cell when handed null', () => {
    const rows = [row('1000', { debitMinor: 500_00 })]
    expect(applyOpeningCellChange(rows, '1000', 'debit', null)[0]?.debitMinor).toBeNull()
  })

  it('never changes a LOCKED row, whatever it is handed', () => {
    // The lock is the whole reason the inventory numbers cannot drift from the
    // settings the first close reads.
    const rows = [row('1310', { lockedByRole: 'inventory_wip', debitMinor: 100_00 })]
    expect(applyOpeningCellChange(rows, '1310', 'credit', 999)[0]).toEqual(rows[0])
  })

  it('leaves every other row untouched and does not mutate the input', () => {
    const rows = [row('1000'), row('2000'), row('3900')]
    const snapshot = JSON.parse(JSON.stringify(rows))
    const next = applyOpeningCellChange(rows, '2000', 'credit', 42)
    expect(rows).toEqual(snapshot)
    expect(next[0]).toBe(rows[0])
    expect(next[2]).toBe(rows[2])
  })
})

describe('overlayInventorySettings', () => {
  const byRole = {
    inventory_raw_materials: 100_00,
    inventory_wip: 0,
    inventory_finished_goods: null,
  }

  it('fills a locked row from the settings, as a DEBIT', () => {
    const rows = [row('1310', { lockedByRole: 'inventory_raw_materials' })]
    expect(overlayInventorySettings(rows, byRole)[0]).toMatchObject({
      debitMinor: 100_00,
      creditMinor: null,
    })
  })

  it('overrides whatever the stored draft said, because the settings win', () => {
    const rows = [row('1310', { lockedByRole: 'inventory_raw_materials', debitMinor: 999_99 })]
    expect(overlayInventorySettings(rows, byRole)[0]?.debitMinor).toBe(100_00)
  })

  it('applies a zero, which is a real balance', () => {
    const rows = [row('1320', { lockedByRole: 'inventory_wip', debitMinor: 999 })]
    expect(overlayInventorySettings(rows, byRole)[0]?.debitMinor).toBe(0)
  })

  it('never blanks a server value with a browser null', () => {
    // 🛑 The second half of the driving session. `getSetting` answers null both
    // for "unset" and for "this store has not loaded that key", and letting the
    // null win wiped the figures the server had already resolved.
    const rows = [row('1330', { lockedByRole: 'inventory_finished_goods', debitMinor: 250_000 })]
    expect(overlayInventorySettings(rows, byRole)[0]).toBe(rows[0])
  })

  it('leaves an unset row unset when nobody has a number for it', () => {
    const rows = [row('1330', { lockedByRole: 'inventory_finished_goods' })]
    expect(overlayInventorySettings(rows, byRole)[0]?.debitMinor).toBeNull()
  })

  it('touches no unlocked row', () => {
    const rows = [row('1000', { debitMinor: 500_00 })]
    expect(overlayInventorySettings(rows, byRole)[0]).toBe(rows[0])
  })

  it('leaves a locked row alone when the role has no entry at all', () => {
    // A chart with a fourth inventory role, or a settings read that failed:
    // better an untouched row than one blanked by an absent key.
    const rows = [row('1340', { lockedByRole: 'inventory_something_else', debitMinor: 7 })]
    expect(overlayInventorySettings(rows, byRole)[0]).toBe(rows[0])
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
