// packages/lib/src/accounting/ledger/builders/__tests__/entry.test.ts
//
// All amounts are integer MINOR units (cents): 10_000 = $100.00.
//
// The balance assertion gets the heaviest coverage in this file deliberately. It
// is the one rule the provider cannot be trusted to enforce for us - an org with
// no accounting system connected has no second validator at all, and one with
// QuickBooks connected only learns after a `pending` row already exists.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import type { GlPostingLineInput } from '../../types'
import { ACCOUNT_ROLES, buildEntry, buildVendorBillEntry } from '../entry'

function line(
  accountRole: string,
  direction: 'debit' | 'credit',
  amount: number
): GlPostingLineInput {
  return { accountRole, direction, amount, sourceType: 'test', sourceId: 'src_1', sortOrder: 0 }
}

const BASE = {
  postingType: 'inventory_movement' as const,
  periodKey: '2026-08-18',
  txnDate: '2026-08-18',
}

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

describe('buildVendorBillEntry - the one bill entry (73 D2, D3, D5)', () => {
  const LINKED = {
    lineId: 'vbl_1',
    description: 'Motors',
    lineTotalMinor: 50_000,
    purchaseOrderLineId: 'pol_1',
    quantityBilled: 10,
    unitPriceExpectedMinor: 5_000,
  }
  const BILL = {
    vendorBillId: 'vb_1',
    internalNumber: 'BILL-0007',
    billedAt: '2026-09-02',
    totalMinor: 50_000,
    lines: [LINKED],
  }
  const role = (built: ReturnType<typeof buildVendorBillEntry>, name: string) =>
    built.entry.lines.find((line) => line.accountRole === name)
  const roles = (built: ReturnType<typeof buildVendorBillEntry>) =>
    built.entry.lines.map((line) => line.accountRole)

  it('a PO bill debits GRNI at billed x expected and credits A/P at the bill total', () => {
    const built = buildVendorBillEntry(BILL)
    expect(role(built, ACCOUNT_ROLES.GRNI)).toMatchObject({ direction: 'debit', amount: 50_000 })
    expect(role(built, ACCOUNT_ROLES.ACCOUNTS_PAYABLE)).toMatchObject({
      direction: 'credit',
      amount: 50_000,
    })
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.PPV)
    expect(built.periodKey).toBe('BILL-0007')
    expect(built.totalMinor).toBe(50_000)
  })

  it('an expense bill debits each coded line by ACCOUNT ID, never a role', () => {
    const built = buildVendorBillEntry({
      ...BILL,
      totalMinor: 90_000,
      lines: [
        { lineId: 'l1', description: 'Rent', lineTotalMinor: 60_000, glAccountId: 'ei_rent' },
        { lineId: 'l2', description: 'Insurance', lineTotalMinor: 30_000, glAccountId: 'ei_ins' },
      ],
    })
    expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
      { glAccountId: 'ei_rent', direction: 'debit', amount: 60_000 },
      { glAccountId: 'ei_ins', direction: 'debit', amount: 30_000 },
    ])
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.GRNI)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('a MIXED bill posts both kinds of line in one entry', () => {
    const built = buildVendorBillEntry({
      ...BILL,
      totalMinor: 56_000,
      lines: [
        LINKED,
        { lineId: 'l2', description: 'Pallets', lineTotalMinor: 6_000, glAccountId: 'ei_sup' },
      ],
    })
    expect(role(built, ACCOUNT_ROLES.GRNI)?.amount).toBe(50_000)
    expect(built.entry.lines.find((line) => line.glAccountId)).toMatchObject({
      glAccountId: 'ei_sup',
      amount: 6_000,
    })
    expect(role(built, ACCOUNT_ROLES.ACCOUNTS_PAYABLE)?.amount).toBe(56_000)
  })

  it('a service matched to an order line debits its coded account, never GRNI (107-D10)', () => {
    const built = buildVendorBillEntry({
      ...BILL,
      lines: [{ ...LINKED, service: true, glAccountId: 'ei_subcontract' }],
    })
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.GRNI)
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.PPV)
    expect(built.entry.lines.find((line) => line.glAccountId)).toMatchObject({
      glAccountId: 'ei_subcontract',
      direction: 'debit',
      amount: 50_000,
    })
  })

  it('an uncoded service, linked or not, debits the purchased_services role (107 §9)', () => {
    const built = buildVendorBillEntry({
      ...BILL,
      totalMinor: 56_000,
      lines: [
        { ...LINKED, service: true },
        { lineId: 'l2', description: 'Install', lineTotalMinor: 6_000, service: true },
      ],
    })
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.GRNI)
    expect(
      built.entry.lines.filter((line) => line.accountRole === ACCOUNT_ROLES.PURCHASED_SERVICES)
    ).toMatchObject([
      { direction: 'debit', amount: 50_000 },
      { direction: 'debit', amount: 6_000 },
    ])
    expect(built.entry.lines.some((line) => line.glAccountId)).toBe(false)
  })

  it('still refuses an uncoded line that is not a service', () => {
    expect(() =>
      buildVendorBillEntry({
        ...BILL,
        totalMinor: 6_000,
        lines: [{ lineId: 'l2', description: 'Pallets', lineTotalMinor: 6_000 }],
      })
    ).toThrow(/no GL account: Pallets/)
  })

  it('debits PPV when the vendor billed HIGH and credits it when LOW', () => {
    const high = buildVendorBillEntry({
      ...BILL,
      totalMinor: 52_500,
      lines: [{ ...LINKED, lineTotalMinor: 52_500 }],
    })
    expect(role(high, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'debit', amount: 2_500 })

    const low = buildVendorBillEntry({
      ...BILL,
      totalMinor: 47_500,
      lines: [{ ...LINKED, lineTotalMinor: 47_500 }],
    })
    expect(role(low, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'credit', amount: 2_500 })
  })

  // 73 D2. Billed-based: 10 invoiced, 8 received leaves GRNI holding a debit for
  // the two that have not landed. Nothing here reads a received quantity at all.
  it('leaves a SHORT RECEIPT in GRNI as a debit rather than calling it a variance', () => {
    const built = buildVendorBillEntry(BILL)
    expect(role(built, ACCOUNT_ROLES.GRNI)?.amount).toBe(50_000)
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.PPV)
  })

  it('posts identically whatever the match verdict is - the verdict is not an input', () => {
    // The builder takes no verdict at all, which is the guarantee: the same
    // values produce the same entry at awaiting_receipt, matched and exception.
    const built = [1, 2, 3].map(() => buildVendorBillEntry(BILL))
    expect(built[1]?.entry.lines).toEqual(built[0]?.entry.lines)
    expect(built[2]?.entry.lines).toEqual(built[0]?.entry.lines)
  })

  it('carries the vendor counterparty on the A/P line only, and posts fine with none', () => {
    const withVendor = buildVendorBillEntry({ ...BILL, vendorCompanyInstanceId: 'ei_company_1' })
    expect(role(withVendor, ACCOUNT_ROLES.ACCOUNTS_PAYABLE)).toMatchObject({
      counterpartyType: 'vendor',
      counterpartyId: 'ei_company_1',
    })
    expect(role(withVendor, ACCOUNT_ROLES.GRNI)?.counterpartyType).toBeUndefined()
    expect(
      role(buildVendorBillEntry(BILL), ACCOUNT_ROLES.ACCOUNTS_PAYABLE)?.counterpartyId
    ).toBeUndefined()
  })

  describe('the header amounts (73 D5)', () => {
    it('shipping debits the freight accrual and tax the purchase-tax role, one leg each', () => {
      const built = buildVendorBillEntry({
        ...BILL,
        shippingMinor: 6_000,
        taxMinor: 4_000,
        totalMinor: 60_000,
      })
      expect(role(built, ACCOUNT_ROLES.FREIGHT_ACCRUAL)).toMatchObject({
        direction: 'debit',
        amount: 6_000,
      })
      expect(role(built, ACCOUNT_ROLES.PURCHASE_TAX)).toMatchObject({
        direction: 'debit',
        amount: 4_000,
      })
      expect(
        built.entry.lines.filter((line) => line.accountRole === ACCOUNT_ROLES.FREIGHT_ACCRUAL)
      ).toHaveLength(1)
      expect(built.entry.totalDebit).toBe(60_000)
    })

    it('emits no leg for a zero header amount', () => {
      const built = buildVendorBillEntry(BILL)
      expect(roles(built)).not.toContain(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
      expect(roles(built)).not.toContain(ACCOUNT_ROLES.PURCHASE_TAX)
    })

    // The spread the ledger does not read but item 11 does: it must reconcile to
    // the header to the cent on an input that does not divide evenly.
    it('spreads shipping and tax across the lines, reconciling to the cent', () => {
      const built = buildVendorBillEntry({
        ...BILL,
        totalMinor: 30_020,
        shippingMinor: 1_000,
        taxMinor: 7,
        lines: [
          { lineId: 'a', lineTotalMinor: 10_001, glAccountId: 'ei_a', quantityBilled: 1 },
          { lineId: 'b', lineTotalMinor: 10_005, glAccountId: 'ei_b', quantityBilled: 1 },
          { lineId: 'c', lineTotalMinor: 9_007, glAccountId: 'ei_c', quantityBilled: 1 },
        ],
      })
      const sum = (key: 'shippingMinor' | 'taxMinor') =>
        built.allocations.reduce((total, row) => total + row[key], 0)
      expect(sum('shippingMinor')).toBe(1_000)
      expect(sum('taxMinor')).toBe(7)
      expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    })

    it('a discount lands as a favourable PPV credit on a PO bill', () => {
      const built = buildVendorBillEntry({ ...BILL, discountMinor: 5_000, totalMinor: 45_000 })
      expect(role(built, ACCOUNT_ROLES.GRNI)?.amount).toBe(50_000)
      expect(role(built, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'credit', amount: 5_000 })
      expect(role(built, ACCOUNT_ROLES.ACCOUNTS_PAYABLE)?.amount).toBe(45_000)
    })

    it('a discount reduces each coded line pro rata on an expense bill', () => {
      const built = buildVendorBillEntry({
        ...BILL,
        discountMinor: 1_000,
        totalMinor: 29_000,
        lines: [
          { lineId: 'a', lineTotalMinor: 20_000, glAccountId: 'ei_a' },
          { lineId: 'b', lineTotalMinor: 10_000, glAccountId: 'ei_b' },
        ],
      })
      expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
        { glAccountId: 'ei_a', direction: 'debit', amount: 19_333 },
        { glAccountId: 'ei_b', direction: 'debit', amount: 9_667 },
      ])
      expect(built.allocations.reduce((total, row) => total + row.discountMinor, 0)).toBe(1_000)
    })
  })

  describe('the refusals', () => {
    it('refuses a tie that fails, naming the difference', () => {
      expect(() => buildVendorBillEntry({ ...BILL, totalMinor: 56_000 })).toThrow(
        /a difference of 6000/
      )
    })

    it('refuses an unlinked line with no account, naming the line', () => {
      expect(() =>
        buildVendorBillEntry({
          ...BILL,
          totalMinor: 1_000,
          lines: [{ lineId: 'l1', description: 'Pallets', lineTotalMinor: 1_000 }],
        })
      ).toThrow(/no GL account: Pallets/)
    })

    it('refuses an UNTYPED linked line, naming the line', () => {
      expect(() =>
        buildVendorBillEntry({ ...BILL, lines: [{ ...LINKED, unitPriceExpectedMinor: null }] })
      ).toThrow(/Motors/)
    })

    it('refuses a non-positive total, a fractional amount and a foreign currency', () => {
      expect(() => buildVendorBillEntry({ ...BILL, totalMinor: 0 })).toThrow(/positive whole/)
      expect(() => buildVendorBillEntry({ ...BILL, totalMinor: 50_000.5 })).toThrow(
        /whole number of cents/
      )
      expect(() =>
        buildVendorBillEntry({ ...BILL, currency: 'EUR', ledgerCurrency: 'USD' })
      ).toThrow(/implied 1.0 rate/)
    })

    it('refuses a blank internal number - the claim keys on it', () => {
      expect(() => buildVendorBillEntry({ ...BILL, internalNumber: '  ' })).toThrow(
        /Bill reference/
      )
    })
  })

  it('stamps the vendor bill as the source on every line, and is a vendor_bill posting', () => {
    const built = buildVendorBillEntry({ ...BILL, shippingMinor: 1_000, totalMinor: 51_000 })
    for (const line of built.entry.lines) {
      expect(line.sourceType).toBe('vendor_bill')
      expect(line.sourceId).toBe('vb_1')
    }
    expect(built.entry.postingType).toBe('vendor_bill')
    expect(built.entry.txnDate).toBe('2026-09-02')
  })

  it('never touches the duties accrual - the broker bills that separately', () => {
    const built = buildVendorBillEntry({ ...BILL, shippingMinor: 1_000, totalMinor: 51_000 })
    expect(roles(built)).not.toContain(ACCOUNT_ROLES.DUTIES_ACCRUAL)
  })

  // 74 §3.2's worked sequence, against a shipment that accrued 10 freight and
  // 30 duty.
  describe('the landed-cost split (74 D4)', () => {
    const FREIGHT = 'ei_freight_accrual'
    const DUTIES = 'ei_duties_accrual'
    const landed = (lineTotalMinor: number, remainingAccrualMinor: number) => ({
      ...BILL,
      totalMinor: lineTotalMinor,
      lines: [
        {
          lineId: 'l1',
          description: 'Carrier',
          glAccountId: FREIGHT,
          landedPoolKey: `vb_goods:${FREIGHT}`,
          lineTotalMinor,
          remainingAccrualMinor,
        },
      ],
    })

    it('carrier bills 12 against 10 accrued: 10 to the accrual, 2 to PPV', () => {
      const built = buildVendorBillEntry(landed(1_200, 1_000))
      expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
        { glAccountId: FREIGHT, direction: 'debit', amount: 1_000 },
      ])
      expect(role(built, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'debit', amount: 200 })
      expect(role(built, ACCOUNT_ROLES.ACCOUNTS_PAYABLE)?.amount).toBe(1_200)
    })

    it("carrier bills 8 against 10: 8 to the accrual and no PPV - the 2 is the clear's", () => {
      const built = buildVendorBillEntry(landed(800, 1_000))
      expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
        { glAccountId: FREIGHT, direction: 'debit', amount: 800 },
      ])
      expect(roles(built)).not.toContain(ACCOUNT_ROLES.PPV)
    })

    it('the broker bills 30 duty and 5 service on one pool: 30 to duties, 5 to PPV', () => {
      const built = buildVendorBillEntry({
        ...BILL,
        totalMinor: 3_500,
        lines: [
          {
            lineId: 'l1',
            description: 'Duty',
            lineTotalMinor: 3_000,
            glAccountId: DUTIES,
            landedPoolKey: `vb_goods:${DUTIES}`,
            remainingAccrualMinor: 3_000,
          },
          {
            lineId: 'l2',
            description: 'Entry fee',
            lineTotalMinor: 500,
            glAccountId: DUTIES,
            landedPoolKey: `vb_goods:${DUTIES}`,
            remainingAccrualMinor: 3_000,
          },
        ],
      })
      expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
        { glAccountId: DUTIES, direction: 'debit', amount: 3_000 },
      ])
      expect(role(built, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'debit', amount: 500 })
    })

    it('a second bill against a CLEARED shipment posts to PPV alone', () => {
      const built = buildVendorBillEntry(landed(400, 0))
      expect(built.entry.lines.filter((line) => line.glAccountId)).toEqual([])
      expect(role(built, ACCOUNT_ROLES.PPV)).toMatchObject({ direction: 'debit', amount: 400 })
    })

    it('a landed line coded to a THIRD account carries no remaining and is untouched', () => {
      const built = buildVendorBillEntry({
        ...BILL,
        totalMinor: 400,
        lines: [
          { lineId: 'l1', description: 'Storage', lineTotalMinor: 400, glAccountId: 'ei_other' },
        ],
      })
      expect(built.entry.lines.filter((line) => line.glAccountId)).toMatchObject([
        { glAccountId: 'ei_other', direction: 'debit', amount: 400 },
      ])
      expect(roles(built)).not.toContain(ACCOUNT_ROLES.PPV)
    })
  })
})
