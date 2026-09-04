// packages/lib/src/postings/reports/__tests__/aging.test.ts
//
// `agingBucket` (pure, exhaustive) and `toAgingRows` (pure adapter) get full
// coverage. `readAging` gets the doubles `trial-balance.test.ts` uses for its
// own query, plus mocks for its extra collaborators (`loadRoleAccountCodes`,
// `readTrialBalance`, `getOrgCache`, `getCachedEntityDefId`,
// `readFieldScalars`/`readFieldRelations`) - the same "cover the shape, drive
// the join" split `vendor-1099.test.ts` documents its own header with.

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../resolve-roles', () => ({ loadRoleAccountCodes: vi.fn() }))
vi.mock('../trial-balance', () => ({ readTrialBalance: vi.fn() }))
vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))
vi.mock('../../../field-values/read-field-scalars', () => ({
  readFieldScalars: vi.fn(),
  readFieldRelations: vi.fn(),
}))

import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import { readFieldRelations, readFieldScalars } from '../../../field-values/read-field-scalars'
import { loadRoleAccountCodes } from '../../resolve-roles'
import {
  AGING_UNAPPLIED_GROUP_ID,
  type Aging,
  type AgingDocument,
  type AgingGroup,
  agingBucket,
  readAging,
  toAgingRows,
} from '../aging'
import { readTrialBalance } from '../trial-balance'

const ORG = 'org_1'

// ─────────────────────────────────────────────────────────────────────────────
// agingBucket - pure, exhaustive
// ─────────────────────────────────────────────────────────────────────────────

describe('agingBucket', () => {
  it('has no due date to age against, so it is always current', () => {
    expect(agingBucket('2026-06-30', null)).toBe('current')
  })

  it('is current when the due date has not yet arrived', () => {
    expect(agingBucket('2026-06-01', '2026-06-30')).toBe('current')
  })

  it('is current on the due date itself', () => {
    expect(agingBucket('2026-06-30', '2026-06-30')).toBe('current')
  })

  it('a net-60 invoice issued 45 days ago is current, not 31-60', () => {
    // Issued 2026-01-01, net 60 -> due 2026-03-02. As of 2026-02-15 (45 days
    // after issue), it is 15 days from being due - current.
    expect(agingBucket('2026-02-15', '2026-03-02')).toBe('current')
  })

  it('buckets 1 day past due into 1-30', () => {
    expect(agingBucket('2026-07-01', '2026-06-30')).toBe('1_30')
  })

  it('buckets exactly 30 days past due into 1-30', () => {
    expect(agingBucket('2026-07-30', '2026-06-30')).toBe('1_30')
  })

  it('buckets 31 days past due into 31-60', () => {
    expect(agingBucket('2026-07-31', '2026-06-30')).toBe('31_60')
  })

  it('buckets exactly 60 days past due into 31-60', () => {
    expect(agingBucket('2026-08-29', '2026-06-30')).toBe('31_60')
  })

  it('buckets 61 days past due into 61-90', () => {
    expect(agingBucket('2026-08-30', '2026-06-30')).toBe('61_90')
  })

  it('buckets exactly 90 days past due into 61-90', () => {
    expect(agingBucket('2026-09-28', '2026-06-30')).toBe('61_90')
  })

  it('buckets 91 days past due into 90+', () => {
    expect(agingBucket('2026-09-29', '2026-06-30')).toBe('90_plus')
  })

  it('refuses a malformed asOf', () => {
    expect(() => agingBucket('not-a-date', '2026-06-30')).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toAgingRows - pure adapter
// ─────────────────────────────────────────────────────────────────────────────

function doc(overrides: Partial<AgingDocument> & { sourceId: string }): AgingDocument {
  return {
    sourceType: 'invoice',
    label: overrides.sourceId,
    issuedAt: null,
    dueDate: null,
    openMinor: 0,
    bucket: 'current',
    ...overrides,
  }
}

function group(overrides: Partial<AgingGroup> & { groupId: string }): AgingGroup {
  return {
    groupName: overrides.groupId,
    documents: [],
    bucketTotals: { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 },
    totalMinor: 0,
    ...overrides,
  }
}

function aging(overrides: Partial<Aging> & { groups: AgingGroup[] }): Aging {
  const bucketTotals = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 }
  let totalMinor = 0
  for (const g of overrides.groups) {
    for (const key of Object.keys(bucketTotals) as (keyof typeof bucketTotals)[]) {
      bucketTotals[key] += g.bucketTotals[key]
    }
    totalMinor += g.totalMinor
  }
  return {
    organizationId: ORG,
    side: 'receivable',
    asOf: '2026-08-31',
    accountCode: '1100',
    bucketTotals,
    totalMinor,
    balanceSheetMinor: totalMinor,
    verdict: true,
    differenceMinor: 0,
    ...overrides,
  }
}

describe('toAgingRows', () => {
  it('renders one row per group with a value in every bucket column plus a total column', () => {
    const g = group({
      groupId: 'contact_1',
      groupName: 'Acme Co',
      totalMinor: 15_000,
      bucketTotals: { current: 5_000, '1_30': 10_000, '31_60': 0, '61_90': 0, '90_plus': 0 },
      documents: [
        doc({ sourceId: 'inv_1', label: 'INV-0001', bucket: 'current', openMinor: 5_000 }),
        doc({ sourceId: 'inv_2', label: 'INV-0002', bucket: '1_30', openMinor: 10_000 }),
      ],
    })

    const rows = toAgingRows(aging({ groups: [g] }))
    const groupRow = rows.find((r) => r.id === 'contact_1')!
    expect(groupRow.kind).toBe('line')
    expect(groupRow.values).toEqual([5_000, 10_000, 0, 0, 0, 15_000])
    expect(groupRow.children).toHaveLength(2)
  })

  it("a document's amount lands only in its own bucket column, and in the total column", () => {
    const g = group({
      groupId: 'contact_1',
      totalMinor: 10_000,
      bucketTotals: { current: 0, '1_30': 0, '31_60': 10_000, '61_90': 0, '90_plus': 0 },
      documents: [
        doc({ sourceId: 'inv_1', label: 'INV-0003', bucket: '31_60', openMinor: 10_000 }),
      ],
    })

    const rows = toAgingRows(aging({ groups: [g] }))
    const child = rows[0]!.children![0]!
    // current, 1-30, 31-60, 61-90, 90+, total
    expect(child.values).toEqual([null, null, 10_000, null, null, 10_000])
  })

  it('labels a dated document in plain ASCII - no em dash reaches a statement', () => {
    const g = group({
      groupId: 'contact_1',
      totalMinor: 10_000,
      bucketTotals: { current: 10_000, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 },
      documents: [
        doc({
          sourceId: 'inv_1',
          label: 'INV-0004',
          bucket: 'current',
          openMinor: 10_000,
          dueDate: '2026-07-31',
        }),
      ],
    })

    const child = toAgingRows(aging({ groups: [g] }))[0]!.children![0]!
    expect(child.label).toBe('INV-0004 due 2026-07-31')
    expect(child.label).not.toMatch(/[\u2013\u2014]/)
  })

  it('carries the recordId and badge through for the page to wire the drawer and the A/P flag', () => {
    const g = group({
      groupId: 'company_1',
      totalMinor: 5_000,
      bucketTotals: { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 5_000 },
      documents: [
        doc({
          sourceType: 'vendor_bill',
          sourceId: 'bill_1',
          label: 'BILL-0009',
          bucket: '90_plus',
          openMinor: 5_000,
          badge: 'exception',
          recordId: 'def_vendor_bill:bill_1',
        }),
      ],
    })

    const rows = toAgingRows(aging({ side: 'payable', groups: [g] }))
    const child = rows[0]!.children![0]!
    expect(child.meta?.badge).toBe('exception')
    expect(child.meta?.recordId).toBe('def_vendor_bill:bill_1')
  })

  it('ends in a total row summing every group', () => {
    const g1 = group({
      groupId: 'c1',
      totalMinor: 1_000,
      bucketTotals: { current: 1_000, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 },
    })
    const g2 = group({
      groupId: 'c2',
      totalMinor: 2_000,
      bucketTotals: { current: 0, '1_30': 2_000, '31_60': 0, '61_90': 0, '90_plus': 0 },
    })

    const rows = toAgingRows(aging({ groups: [g1, g2] }))
    const total = rows[rows.length - 1]!
    expect(total.kind).toBe('total')
    expect(total.values).toEqual([1_000, 2_000, 0, 0, 0, 3_000])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// readAging - the doubles trial-balance.test.ts uses, plus this read's own
// ─────────────────────────────────────────────────────────────────────────────

function stubDb(queue: unknown[][]): Database {
  let index = 0
  function chain() {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy'])
      c[method] = passthrough
    const rows = queue[index] ?? []
    index += 1
    // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return c
  }
  return { select: () => chain() } as unknown as Database
}

function glLine(overrides: {
  sourceType: string
  sourceId: string
  direction: 'debit' | 'credit'
  amountMinor: number
  docNumber?: string
}) {
  return { docNumber: 'JNL-0001', ...overrides }
}

function noOrgCache() {
  vi.mocked(getOrgCache).mockReturnValue({
    from: () => ({ bySystemAttributes: async () => ({}) }),
  } as never)
  vi.mocked(readFieldScalars).mockResolvedValue(new Map())
  vi.mocked(readFieldRelations).mockResolvedValue(new Map())
  vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
}

describe('readAging', () => {
  it('is empty and trivially tied when the role has no mapped account', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    noOrgCache()

    const result = await readAging(stubDb([]), {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })

    const value = result._unsafeUnwrap()
    expect(value.accountCode).toBeNull()
    expect(value.groups).toEqual([])
    expect(value.verdict).toBe(true)
    expect(readTrialBalance).not.toHaveBeenCalled()
  })

  it('groups an invoice-sourced line by its resolved contact and ties to the trial balance', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_receivable',
          { glAccountId: 'a1', code: '1100', name: 'A/R', accountType: 'asset', isActive: true },
        ],
      ])
    )
    vi.mocked(getOrgCache).mockReturnValue({
      from: () => ({
        bySystemAttributes: async () => ({
          invoice_due_date: { id: 'f_due' },
          invoice_issued_at: { id: 'f_issued' },
          invoice_number: { id: 'f_number' },
          invoice_contact: { id: 'f_contact' },
        }),
      }),
    } as never)
    vi.mocked(readFieldScalars).mockResolvedValue(
      new Map([
        [
          'inv_1',
          new Map<string, unknown>([
            ['f_due', '2026-06-30T00:00:00.000Z'],
            ['f_issued', '2026-05-01T00:00:00.000Z'],
            ['f_number', 'INV-0001'],
          ]),
        ],
      ])
    )
    vi.mocked(readFieldRelations).mockResolvedValue(
      new Map([['inv_1', new Map([['f_contact', 'contact_1']])]])
    )
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_invoice')
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok({
        organizationId: ORG,
        from: null,
        to: '2026-08-31',
        rows: [
          {
            accountCode: '1100',
            accountName: 'A/R',
            accountType: 'asset',
            debitMinor: 10_000,
            creditMinor: 0,
            balanceMinor: 10_000,
            inChart: true,
          },
        ],
        totalDebitMinor: 10_000,
        totalCreditMinor: 10_000,
        balanced: true,
      })
    )

    const db = stubDb([
      [
        glLine({
          sourceType: 'invoice',
          sourceId: 'inv_1',
          direction: 'debit',
          amountMinor: 10_000,
        }),
      ],
      [{ id: 'contact_1', displayName: 'Acme Co' }],
    ])

    const result = await readAging(db, {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })
    const value = result._unsafeUnwrap()

    expect(value.groups).toHaveLength(1)
    expect(value.groups[0]?.groupName).toBe('Acme Co')
    expect(value.groups[0]?.documents[0]).toMatchObject({
      label: 'INV-0001',
      dueDate: '2026-06-30',
      bucket: '61_90', // 2026-08-31 is 62 days after the 2026-06-30 due date
      openMinor: 10_000,
      recordId: 'def_invoice:inv_1',
    })
    expect(value.totalMinor).toBe(10_000)
    expect(value.balanceSheetMinor).toBe(10_000)
    expect(value.verdict).toBe(true)
    expect(value.differenceMinor).toBe(0)
  })

  it('an overpaid customer nets negative and stays in current, never hidden', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_receivable',
          { glAccountId: 'a1', code: '1100', name: 'A/R', accountType: 'asset', isActive: true },
        ],
      ])
    )
    noOrgCache()
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok({
        organizationId: ORG,
        from: null,
        to: '2026-08-31',
        rows: [
          {
            accountCode: '1100',
            accountName: 'A/R',
            accountType: 'asset',
            debitMinor: 5_000,
            creditMinor: 8_000,
            balanceMinor: -3_000,
            inChart: true,
          },
        ],
        totalDebitMinor: 5_000,
        totalCreditMinor: 8_000,
        balanced: true,
      })
    )

    // A payment (credit) larger than the invoice (debit) it applied to, on
    // the SAME source document - nets to a credit balance.
    const db = stubDb([
      [
        glLine({
          sourceType: 'invoice',
          sourceId: 'inv_1',
          direction: 'debit',
          amountMinor: 5_000,
        }),
        glLine({
          sourceType: 'invoice',
          sourceId: 'inv_1',
          direction: 'credit',
          amountMinor: 8_000,
        }),
      ],
      [],
    ])

    const result = await readAging(db, {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })
    const value = result._unsafeUnwrap()

    expect(value.groups).toHaveLength(1)
    const document = value.groups[0]?.documents[0]
    expect(document?.openMinor).toBe(-3_000)
    expect(document?.bucket).toBe('current')
    expect(value.groups[0]?.groupId).toBe(AGING_UNAPPLIED_GROUP_ID)
    expect(value.totalMinor).toBe(-3_000)
    expect(value.verdict).toBe(true)
  })

  it('an awaiting_receipt vendor bill is included on the A/P side and badged', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_payable',
          {
            glAccountId: 'a2',
            code: '2000',
            name: 'A/P',
            accountType: 'liability',
            isActive: true,
          },
        ],
      ])
    )
    vi.mocked(getOrgCache).mockReturnValue({
      from: () => ({
        bySystemAttributes: async () => ({
          vendor_bill_due_at: { id: 'f_due' },
          vendor_bill_number: { id: 'f_number' },
          vendor_bill_status: { id: 'f_status' },
          vendor_bill_vendor: { id: 'f_vendor' },
        }),
      }),
    } as never)
    vi.mocked(readFieldScalars).mockResolvedValue(
      new Map([
        [
          'bill_1',
          new Map<string, unknown>([
            ['f_due', '2026-08-01T00:00:00.000Z'],
            ['f_number', 'BILL-0009'],
            ['f_status', 'awaiting_receipt'],
          ]),
        ],
      ])
    )
    vi.mocked(readFieldRelations).mockResolvedValue(
      new Map([['bill_1', new Map([['f_vendor', 'company_1']])]])
    )
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_vendor_bill')
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok({
        organizationId: ORG,
        from: null,
        to: '2026-08-31',
        rows: [
          {
            accountCode: '2000',
            accountName: 'A/P',
            accountType: 'liability',
            debitMinor: 0,
            creditMinor: 4_000,
            balanceMinor: 4_000,
            inChart: true,
          },
        ],
        totalDebitMinor: 4_000,
        totalCreditMinor: 4_000,
        balanced: true,
      })
    )

    const db = stubDb([
      [
        glLine({
          sourceType: 'vendor_bill',
          sourceId: 'bill_1',
          direction: 'credit',
          amountMinor: 4_000,
        }),
      ],
      [{ id: 'company_1', displayName: 'Acme Supply' }],
    ])

    const result = await readAging(db, { organizationId: ORG, side: 'payable', asOf: '2026-08-31' })
    const value = result._unsafeUnwrap()

    const document = value.groups[0]?.documents[0]
    expect(document?.badge).toBe('awaiting_receipt')
    expect(document?.label).toBe('BILL-0009')
    expect(value.totalMinor).toBe(4_000)
    expect(value.verdict).toBe(true)
  })

  it('an unapplied payment with no resolvable contact falls into the catch-all, current, never dropped', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_receivable',
          { glAccountId: 'a1', code: '1100', name: 'A/R', accountType: 'asset', isActive: true },
        ],
      ])
    )
    noOrgCache()
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok({
        organizationId: ORG,
        from: null,
        to: '2026-08-31',
        rows: [
          {
            accountCode: '1100',
            accountName: 'A/R',
            accountType: 'asset',
            debitMinor: 0,
            creditMinor: 2_000,
            balanceMinor: -2_000,
            inChart: true,
          },
        ],
        totalDebitMinor: 0,
        totalCreditMinor: 2_000,
        balanced: true,
      })
    )

    const db = stubDb([
      [
        glLine({
          sourceType: 'payment_transaction',
          sourceId: 'txn_1',
          direction: 'credit',
          amountMinor: 2_000,
        }),
      ],
      // The PaymentTransaction lookup, with no contactInstanceId - unresolvable.
      [{ id: 'txn_1', contactInstanceId: null, reference: null, kind: 'charge' }],
    ])

    const result = await readAging(db, {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })
    const value = result._unsafeUnwrap()

    expect(value.groups).toHaveLength(1)
    expect(value.groups[0]?.groupId).toBe(AGING_UNAPPLIED_GROUP_ID)
    expect(value.groups[0]?.groupName).toBe('Unapplied and adjustments')
    expect(value.groups[0]?.documents[0]?.bucket).toBe('current')
    expect(value.groups[0]?.documents[0]?.openMinor).toBe(-2_000)
  })

  it('surfaces a non-zero difference rather than hiding it when aging does not tie to the balance sheet', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_receivable',
          { glAccountId: 'a1', code: '1100', name: 'A/R', accountType: 'asset', isActive: true },
        ],
      ])
    )
    noOrgCache()
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok({
        organizationId: ORG,
        from: null,
        to: '2026-08-31',
        rows: [
          {
            accountCode: '1100',
            accountName: 'A/R',
            accountType: 'asset',
            debitMinor: 999_000,
            creditMinor: 0,
            balanceMinor: 999_000,
            inChart: true,
          },
        ],
        totalDebitMinor: 999_000,
        totalCreditMinor: 0,
        balanced: false,
      })
    )

    const db = stubDb([
      [
        glLine({
          sourceType: 'invoice',
          sourceId: 'inv_1',
          direction: 'debit',
          amountMinor: 1_000,
        }),
      ],
      [],
    ])

    const result = await readAging(db, {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })
    const value = result._unsafeUnwrap()

    expect(value.totalMinor).toBe(1_000)
    expect(value.balanceSheetMinor).toBe(999_000)
    expect(value.verdict).toBe(false)
    expect(value.differenceMinor).toBe(1_000 - 999_000)
  })

  it('returns err rather than throwing when the trial-balance tie-out fails', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(
      new Map([
        [
          'accounts_receivable',
          { glAccountId: 'a1', code: '1100', name: 'A/R', accountType: 'asset', isActive: true },
        ],
      ])
    )
    noOrgCache()
    vi.mocked(readTrialBalance).mockResolvedValue(err(new Error('boom')))

    const db = stubDb([[], []])
    const result = await readAging(db, {
      organizationId: ORG,
      side: 'receivable',
      asOf: '2026-08-31',
    })
    expect(result.isErr()).toBe(true)
  })
})
