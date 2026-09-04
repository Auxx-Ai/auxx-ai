// packages/lib/src/postings/reports/__tests__/vendor-1099.test.ts
//
// `readVendor1099Summary` joins four `FieldValue` aliases and a company lookup,
// which is the shape `journal-entries/reads.ts` also has and also does not unit
// test past its pure `parseLines` - the fixture cost of faking a multi-alias
// join with the right per-call result set buys little over driving it against
// a real org (this slot's `scripts/drive-write-off.ts` does). So this file
// covers what IS cheaply and honestly testable without a database:
//
//  - the two "org predates the migration" early returns, which run BEFORE the
//    query is ever built;
//  - the threshold constant, unchanged and named;
//  - `toVendor1099Rows`/`toCsvRows`, pure presentation shaping over a typed
//    `Vendor1099Summary` - the seam a router or a test can hand a fixture to
//    without a database at all.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(),
  getOrgCache: vi.fn(),
}))

import { getCachedEntityDefId, getOrgCache } from '../../../cache'
import {
  readVendor1099Summary,
  toVendor1099CsvRows as toCsvRows,
  toVendor1099Rows,
  VENDOR_1099_THRESHOLD_MINOR,
  type Vendor1099Summary,
} from '../vendor-1099'

const ORG = 'org_1'

describe('readVendor1099Summary - early returns before any query runs', () => {
  it('is empty, not an error, when the org has no vendor_payment def', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)

    const result = await readVendor1099Summary({} as never, { organizationId: ORG, year: 2026 })

    const summary = result._unsafeUnwrap()
    expect(summary.rows).toEqual([])
    expect(summary.totalMinor).toBe(0)
    expect(summary.thresholdMinor).toBe(VENDOR_1099_THRESHOLD_MINOR)
  })

  it('is empty when vendor_payment exists but its fields do not', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue('def_vendor_payment')
    vi.mocked(getOrgCache).mockReturnValue({
      from: () => ({ bySystemAttributes: async () => ({}) }),
    } as never)

    const result = await readVendor1099Summary({} as never, { organizationId: ORG, year: 2026 })

    expect(result._unsafeUnwrap().rows).toEqual([])
  })

  it('refuses a year that is not four digits', async () => {
    const result = await readVendor1099Summary({} as never, { organizationId: ORG, year: 99 })
    expect(result.isErr()).toBe(true)
  })
})

describe('VENDOR_1099_THRESHOLD_MINOR', () => {
  it('is exactly $600, the IRS 1099-NEC/MISC filing threshold', () => {
    expect(VENDOR_1099_THRESHOLD_MINOR).toBe(60_000)
  })
})

function summary(rows: Vendor1099Summary['rows']): Vendor1099Summary {
  return {
    organizationId: ORG,
    year: 2026,
    thresholdMinor: VENDOR_1099_THRESHOLD_MINOR,
    rows,
    totalMinor: rows.reduce((sum, row) => sum + row.totalMinor, 0),
  }
}

describe('toVendor1099Rows', () => {
  it('sections by box, in nec/misc-rents/misc-other/none order, omitting empty boxes', () => {
    const rows = toVendor1099Rows(
      summary([
        {
          companyId: 'c_none',
          companyName: 'Unmapped Co',
          box: 'none',
          totalMinor: 70_000,
          taxClassification: null,
          tin: null,
          w9OnFile: false,
        },
        {
          companyId: 'c_nec',
          companyName: 'Contractor LLC',
          box: 'nec_1',
          totalMinor: 120_000,
          taxClassification: 'llc',
          tin: '12-3456789',
          w9OnFile: true,
        },
      ])
    )

    expect(rows.map((r) => r.id)).toEqual(['nec_1', 'none', 'grand-total'])
  })

  it('each box section subtotals its vendors and the summary ends in one grand total', () => {
    const rows = toVendor1099Rows(
      summary([
        {
          companyId: 'c1',
          companyName: 'A Co',
          box: 'nec_1',
          totalMinor: 60_000,
          taxClassification: null,
          tin: null,
          w9OnFile: false,
        },
        {
          companyId: 'c2',
          companyName: 'B Co',
          box: 'nec_1',
          totalMinor: 90_000,
          taxClassification: null,
          tin: null,
          w9OnFile: false,
        },
      ])
    )

    const necSection = rows.find((r) => r.id === 'nec_1')!
    expect(necSection.values).toEqual([150_000])
    const subtotalRow = necSection.children?.find((c) => c.kind === 'subtotal')
    expect(subtotalRow?.values).toEqual([150_000])

    const grandTotal = rows.find((r) => r.id === 'grand-total')
    expect(grandTotal?.kind).toBe('total')
    expect(grandTotal?.values).toEqual([150_000])
  })

  it('is empty (no sections, no total) when there are no rows', () => {
    // A total row over nothing would read as "$0 owed to a filed 1099", which
    // is a different claim than "nothing met the threshold this year".
    expect(toVendor1099Rows(summary([]))).toEqual([])
  })
})

describe('toCsvRows', () => {
  it('renders a box section and its vendor as indented CSV lines with major-unit amounts', () => {
    const csv = toCsvRows(
      summary([
        {
          companyId: 'c1',
          companyName: 'Contractor LLC',
          box: 'nec_1',
          totalMinor: 123_45,
          taxClassification: 'llc',
          tin: '12-3456789',
          w9OnFile: true,
        },
      ])
    )
    expect(csv).toContain('Contractor LLC')
    expect(csv).toContain('123.45')
  })
})
