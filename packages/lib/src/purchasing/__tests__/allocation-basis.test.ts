// packages/lib/src/purchasing/__tests__/allocation-basis.test.ts

/**
 * `readAllocationBasis` — 73 D5's header legs spread by the ORDER's own basis,
 * not the builder's default.
 */

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../resources/system-records', () => ({
  systemFields: vi.fn(),
  readSystemRecords: vi.fn(),
}))

import { readSystemRecords, systemFields } from '../../resources/system-records'
import { readAllocationBasis } from '../post-vendor-bill'

const db = {} as Database

function order(basis: string | null) {
  return { id: 'po_1', option: () => basis }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(systemFields).mockResolvedValue({
    defId: 'def_purchase_order',
    fields: { purchase_order_allocation_basis: { id: 'f_basis' } },
  } as any)
})

describe('readAllocationBasis', () => {
  it("reads the order's own basis", async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([order('weight')] as any)
    await expect(readAllocationBasis(db, 'org_1', 'po_1')).resolves.toBe('weight')
  })

  it('falls back to value for an expense bill, which names no order', async () => {
    await expect(readAllocationBasis(db, 'org_1', null)).resolves.toBe('value')
    expect(systemFields).not.toHaveBeenCalled()
  })

  it('falls back to value for an order that names none, and for a stored junk value', async () => {
    vi.mocked(readSystemRecords).mockResolvedValue([order(null)] as any)
    await expect(readAllocationBasis(db, 'org_1', 'po_1')).resolves.toBe('value')

    vi.mocked(readSystemRecords).mockResolvedValue([order('volume')] as any)
    await expect(readAllocationBasis(db, 'org_1', 'po_1')).resolves.toBe('value')
  })
})
