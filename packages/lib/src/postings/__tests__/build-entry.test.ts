// packages/lib/src/postings/__tests__/build-entry.test.ts
//
// All amounts are integer MINOR units (cents): 10_000 = $100.00.
//
// The balance assertion gets the heaviest coverage in this file deliberately. It
// is the one rule the provider cannot be trusted to enforce for us - an org with
// no accounting system connected has no second validator at all, and one with
// QuickBooks connected only learns after a `pending` row already exists.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES, buildEntry, buildReceiptEntry, buildVendorBillEntry } from '../build-entry'
import type { GlPostingLineInput } from '../types'

function line(
  accountRole: string,
  direction: 'debit' | 'credit',
  amount: number
): GlPostingLineInput {
  return { accountRole, direction, amount, sourceType: 'test', sourceId: 'src_1', sortOrder: 0 }
}

const BASE = { postingType: 'receipt' as const, periodKey: '2026-08-18', txnDate: '2026-08-18' }

describe('buildEntry - the balance assertion', () => {
  it('accepts an entry whose debits equal its credits', () => {
    const entry = buildEntry({
      ...BASE,
      lines: [line('inventory_raw_materials', 'debit', 10_000), line('grni', 'credit', 10_000)],
    })
    expect(entry.totalDebit).toBe(10_000)
    expect(entry.totalCredit).toBe(10_000)
    expect(entry.lines).toHaveLength(2)
  })

  it('accepts a many-legged entry that balances in aggregate', () => {
    const entry = buildEntry({
      ...BASE,
      lines: [
        line('inventory_raw_materials', 'debit', 7_500),
        line('inventory_wip', 'debit', 2_500),
        line('grni', 'credit', 9_000),
        line('freight_accrual', 'credit', 1_000),
      ],
    })
    expect(entry.totalDebit).toBe(10_000)
    expect(entry.totalCredit).toBe(10_000)
  })

  it('throws UnprocessableEntityError when debits exceed credits', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 10_001), line('grni', 'credit', 10_000)],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('throws when credits exceed debits', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 10_000), line('grni', 'credit', 10_001)],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('is off-by-one sensitive - one cent is an imbalance', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 1), line('grni', 'credit', 2)],
      })
    ).toThrow(/does not balance/)
  })

  it('reports both totals in the message so the caller can see the gap', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 12_345), line('grni', 'credit', 12_000)],
      })
    ).toThrow(/debits 12345 != credits 12000/)
  })

  it('carries the totals in error details for structured logging', () => {
    try {
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 500), line('grni', 'credit', 400)],
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityError)
      const details = (error as UnprocessableEntityError).details
      expect(details.totalDebit).toBe('500')
      expect(details.totalCredit).toBe('400')
    }
  })

  it('maps to HTTP 422', () => {
    try {
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 500), line('grni', 'credit', 400)],
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as UnprocessableEntityError).statusCode).toBe(422)
    }
  })

  it('rejects an entry with debits only', () => {
    expect(() =>
      buildEntry({ ...BASE, lines: [line('inventory_raw_materials', 'debit', 10_000)] })
    ).toThrow(UnprocessableEntityError)
  })

  it('rejects an entry with credits only', () => {
    expect(() => buildEntry({ ...BASE, lines: [line('grni', 'credit', 10_000)] })).toThrow(
      UnprocessableEntityError
    )
  })

  it('rejects an entry with no lines', () => {
    expect(() => buildEntry({ ...BASE, lines: [] })).toThrow(/at least one line/)
  })
})

describe('buildEntry - line validation', () => {
  it('rejects a negative amount - direction carries the sign, not the amount', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', -10_000), line('grni', 'credit', -10_000)],
      })
    ).toThrow(/direction carries the sign/)
  })

  it('rejects a zero amount', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [line('inventory_raw_materials', 'debit', 0), line('grni', 'credit', 0)],
      })
    ).toThrow(/non-zero/)
  })

  it('rejects a fractional amount - minor units are integers', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [
          line('inventory_raw_materials', 'debit', 10_000.5),
          line('grni', 'credit', 10_000.5),
        ],
      })
    ).toThrow(/integer number of minor units/)
  })

  it('rejects NaN rather than letting it balance against itself', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [
          line('inventory_raw_materials', 'debit', Number.NaN),
          line('grni', 'credit', Number.NaN),
        ],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('rejects Infinity', () => {
    expect(() =>
      buildEntry({
        ...BASE,
        lines: [
          line('inventory_raw_materials', 'debit', Number.POSITIVE_INFINITY),
          line('grni', 'credit', Number.POSITIVE_INFINITY),
        ],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('rejects a blank account role', () => {
    expect(() =>
      buildEntry({ ...BASE, lines: [line('  ', 'debit', 100), line('grni', 'credit', 100)] })
    ).toThrow(/must carry an account role/)
  })
})

describe('buildReceiptEntry', () => {
  const RECEIPT = {
    stockMovementId: 'sm_1',
    periodKey: '2026-08-18',
    txnDate: '2026-08-18',
    vendorUnitPriceMinor: 12_500,
    quantity: 4,
    freightMinor: 3_000,
    dutyMinor: 1_200,
    inventoryAccountRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
  }

  // The debit account comes from the MOVEMENT's frozen `glAccount`, which
  // `receiveStock` resolved from the part's `partKind`. Receiving a finished
  // good relieves finished goods, not raw materials, and the posting has to
  // agree with the ledger row it accounts for - two accounts for one receipt is
  // two answers to one question. Pinned because an earlier version of this
  // builder hardcoded Raw Materials and would have silently disagreed on every
  // finished-good receipt.
  it('debits the role the CALLER names, not a hardcoded raw materials', () => {
    const entry = buildReceiptEntry({
      ...RECEIPT,
      inventoryAccountRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
    })
    const fg = entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS)
    expect(fg?.direction).toBe('debit')
    expect(fg?.amount).toBe(54_200)
    expect(entry.lines.some((l) => l.accountRole === ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS)).toBe(
      false
    )
    // and it still balances against the same three credits
    expect(entry.totalDebit).toBe(entry.totalCredit)
  })

  it('debits the inventory role at LANDED cost', () => {
    const entry = buildReceiptEntry(RECEIPT)
    const raw = entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS)
    expect(raw?.direction).toBe('debit')
    // 12_500 * 4 + 3_000 + 1_200
    expect(raw?.amount).toBe(54_200)
  })

  it('credits GRNI at the VENDOR unit price, never at landed cost', () => {
    const entry = buildReceiptEntry(RECEIPT)
    const grni = entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.GRNI)
    expect(grni?.direction).toBe('credit')
    expect(grni?.amount).toBe(50_000)
    // The whole rule in one assertion: GRNI must NOT carry freight or duty,
    // because the vendor's invoice never will and the account could never clear.
    expect(grni?.amount).not.toBe(54_200)
  })

  it('credits freight and duty to their own accruals', () => {
    const entry = buildReceiptEntry(RECEIPT)
    const freight = entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.FREIGHT_ACCRUAL)
    const duty = entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.DUTIES_ACCRUAL)
    expect(freight).toMatchObject({ direction: 'credit', amount: 3_000 })
    expect(duty).toMatchObject({ direction: 'credit', amount: 1_200 })
  })

  it('balances', () => {
    const entry = buildReceiptEntry(RECEIPT)
    expect(entry.totalDebit).toBe(entry.totalCredit)
    expect(entry.totalDebit).toBe(54_200)
  })

  it('omits the 2170 duties leg entirely when the tariff portion is zero', () => {
    const entry = buildReceiptEntry({ ...RECEIPT, dutyMinor: 0 })
    expect(entry.lines.map((l) => l.accountRole)).not.toContain(ACCOUNT_ROLES.DUTIES_ACCRUAL)
    expect(entry.lines).toHaveLength(3)
    expect(entry.totalDebit).toBe(53_000)
    expect(entry.totalCredit).toBe(53_000)
  })

  it('omits the freight accrual leg when there is no freight', () => {
    const entry = buildReceiptEntry({ ...RECEIPT, freightMinor: 0 })
    expect(entry.lines.map((l) => l.accountRole)).not.toContain(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
  })

  it('reduces to two legs when there is neither freight nor duty', () => {
    const entry = buildReceiptEntry({ ...RECEIPT, freightMinor: 0, dutyMinor: 0 })
    expect(entry.lines).toHaveLength(2)
    expect(entry.lines.map((l) => l.accountRole)).toEqual([
      ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      ACCOUNT_ROLES.GRNI,
    ])
  })

  it('stamps the stock movement as the source on every line', () => {
    const entry = buildReceiptEntry(RECEIPT)
    for (const l of entry.lines) {
      expect(l.sourceType).toBe('stock_movement')
      expect(l.sourceId).toBe('sm_1')
    }
  })

  it('numbers the lines in presentation order after zero legs are dropped', () => {
    const entry = buildReceiptEntry({ ...RECEIPT, freightMinor: 0 })
    expect(entry.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2])
  })

  it('is typed as a receipt posting', () => {
    expect(buildReceiptEntry(RECEIPT).postingType).toBe('receipt')
  })

  it('rejects a zero or negative quantity', () => {
    expect(() => buildReceiptEntry({ ...RECEIPT, quantity: 0 })).toThrow(/must be positive/)
    expect(() => buildReceiptEntry({ ...RECEIPT, quantity: -1 })).toThrow(/must be positive/)
  })

  it('rejects a fractional quantity', () => {
    expect(() => buildReceiptEntry({ ...RECEIPT, quantity: 1.5 })).toThrow(/must be an integer/)
  })

  it('rejects a negative freight or duty portion', () => {
    expect(() => buildReceiptEntry({ ...RECEIPT, freightMinor: -1 })).toThrow(
      /must be non-negative/
    )
    expect(() => buildReceiptEntry({ ...RECEIPT, dutyMinor: -1 })).toThrow(/must be non-negative/)
  })

  it('rejects a fractional unit price', () => {
    expect(() => buildReceiptEntry({ ...RECEIPT, vendorUnitPriceMinor: 12_500.5 })).toThrow(
      /integer number of minor units/
    )
  })
})

describe('buildVendorBillEntry', () => {
  const BILL = {
    vendorBillId: 'vb_1',
    periodKey: '2026-09-02',
    txnDate: '2026-09-02',
    matchedMinor: 50_000,
    billTotalMinor: 50_000,
  }

  it('debits GRNI for the matched portion and credits A/P for the bill total', () => {
    const entry = buildVendorBillEntry(BILL)
    expect(entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.GRNI)).toMatchObject({
      direction: 'debit',
      amount: 50_000,
    })
    expect(entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.ACCOUNTS_PAYABLE)).toMatchObject(
      { direction: 'credit', amount: 50_000 }
    )
  })

  it('emits no PPV line when the bill matches exactly', () => {
    const entry = buildVendorBillEntry(BILL)
    expect(entry.lines.map((l) => l.accountRole)).not.toContain(ACCOUNT_ROLES.PPV)
    expect(entry.lines).toHaveLength(2)
  })

  it('debits PPV when the vendor billed HIGH', () => {
    const entry = buildVendorBillEntry({ ...BILL, billTotalMinor: 52_500 })
    expect(entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.PPV)).toMatchObject({
      direction: 'debit',
      amount: 2_500,
    })
    expect(entry.totalDebit).toBe(52_500)
    expect(entry.totalCredit).toBe(52_500)
  })

  it('credits PPV when the vendor billed LOW', () => {
    const entry = buildVendorBillEntry({ ...BILL, billTotalMinor: 47_500 })
    expect(entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.PPV)).toMatchObject({
      direction: 'credit',
      amount: 2_500,
    })
    expect(entry.totalDebit).toBe(50_000)
    expect(entry.totalCredit).toBe(50_000)
  })

  it('balances for every residual sign', () => {
    for (const billTotalMinor of [1, 49_999, 50_000, 50_001, 999_999]) {
      const entry = buildVendorBillEntry({ ...BILL, billTotalMinor })
      expect(entry.totalDebit).toBe(entry.totalCredit)
    }
  })

  it('sends the whole bill to PPV when nothing matched', () => {
    const entry = buildVendorBillEntry({ ...BILL, matchedMinor: 0 })
    expect(entry.lines.map((l) => l.accountRole)).not.toContain(ACCOUNT_ROLES.GRNI)
    expect(entry.lines.find((l) => l.accountRole === ACCOUNT_ROLES.PPV)?.amount).toBe(50_000)
    expect(entry.totalDebit).toBe(entry.totalCredit)
  })

  it('never touches the freight or duty accruals', () => {
    const codes = buildVendorBillEntry({ ...BILL, billTotalMinor: 52_500 }).lines.map(
      (l) => l.accountRole
    )
    expect(codes).not.toContain(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
    expect(codes).not.toContain(ACCOUNT_ROLES.DUTIES_ACCRUAL)
  })

  it('stamps the vendor bill as the source on every line', () => {
    const entry = buildVendorBillEntry({ ...BILL, billTotalMinor: 52_500 })
    for (const l of entry.lines) {
      expect(l.sourceType).toBe('vendor_bill')
      expect(l.sourceId).toBe('vb_1')
    }
  })

  it('is typed as a vendor_bill posting', () => {
    expect(buildVendorBillEntry(BILL).postingType).toBe('vendor_bill')
  })

  it('rejects a non-positive bill total', () => {
    expect(() => buildVendorBillEntry({ ...BILL, billTotalMinor: 0 })).toThrow(/must be positive/)
    expect(() => buildVendorBillEntry({ ...BILL, billTotalMinor: -1 })).toThrow(/must be positive/)
  })

  it('rejects a negative matched portion', () => {
    expect(() => buildVendorBillEntry({ ...BILL, matchedMinor: -1 })).toThrow(
      /must be non-negative/
    )
  })

  it('rejects fractional minor units', () => {
    expect(() => buildVendorBillEntry({ ...BILL, billTotalMinor: 50_000.5 })).toThrow(
      /integer number of minor units/
    )
  })
})

describe('the receipt / bill round trip', () => {
  it('clears GRNI to exactly zero when the vendor bills what was agreed', () => {
    const receipt = buildReceiptEntry({
      stockMovementId: 'sm_2',
      periodKey: '2026-08-18',
      txnDate: '2026-08-18',
      vendorUnitPriceMinor: 12_500,
      quantity: 4,
      freightMinor: 3_000,
      dutyMinor: 1_200,
      inventoryAccountRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
    })
    const credited = receipt.lines
      .filter((l) => l.accountRole === ACCOUNT_ROLES.GRNI && l.direction === 'credit')
      .reduce((sum, l) => sum + l.amount, 0)

    const bill = buildVendorBillEntry({
      vendorBillId: 'vb_2',
      periodKey: '2026-09-02',
      txnDate: '2026-09-02',
      matchedMinor: credited,
      billTotalMinor: credited,
    })
    const debited = bill.lines
      .filter((l) => l.accountRole === ACCOUNT_ROLES.GRNI && l.direction === 'debit')
      .reduce((sum, l) => sum + l.amount, 0)

    // This is decision P7 stated as a test: the two sides of GRNI meet only
    // because the receipt credited the vendor price rather than landed cost.
    expect(debited).toBe(credited)
    expect(credited - debited).toBe(0)
  })
})
