// packages/lib/src/purchasing/bill-intake/__tests__/propose-landed-bills.test.ts

/**
 * `proposeLandedBills` — 73 §7.2's "intake proposes the goods bill from the
 * invoice numbers it reads".
 */

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../resources/system-records', () => ({
  systemFields: vi.fn(),
  readSystemRecords: vi.fn(),
}))
vi.mock('../../../cache', () => ({ getCachedEntityDefId: vi.fn() }))

import { getCachedEntityDefId } from '../../../cache'
import { readSystemRecords, systemFields } from '../../../resources/system-records'
import { proposeLandedBills } from '../propose'

const db = {} as Database

function bill(id: string, number: string | null) {
  return { id, text: () => number }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCachedEntityDefId).mockResolvedValue('def_vendor_bill')
  vi.mocked(systemFields).mockResolvedValue({
    defId: 'def_vendor_bill',
    fields: { vendor_bill_number: { id: 'f_number' } },
  } as any)
})

describe('proposeLandedBills', () => {
  it('proposes the goods bill a printed commercial invoice number names', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([
      bill('vb_goods', 'INV-88213'),
      bill('vb_other', 'INV-90001'),
    ] as any)

    const result = await proposeLandedBills(db, 'org_1', [' inv-88213 ', 'INV-90001'])
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual(['def_vendor_bill:vb_goods', 'def_vendor_bill:vb_other'])
  })

  it('leaves the line empty when nothing matches, and when the reference is blank', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([bill('vb_goods', 'INV-88213')] as any)

    const result = await proposeLandedBills(db, 'org_1', ['INV-NOPE', null, undefined])
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([null, null, null])
  })

  it('refuses to guess when two bills print the same invoice number', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([
      bill('vb_a', 'INV-88213'),
      bill('vb_b', 'inv-88213'),
    ] as any)

    const result = await proposeLandedBills(db, 'org_1', ['INV-88213'])
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([null])
  })

  it('reads nothing at all when no line prints a reference', async () => {
    const result = await proposeLandedBills(db, 'org_1', [null, null])
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([null, null])
    expect(readSystemRecords).not.toHaveBeenCalled()
  })
})
