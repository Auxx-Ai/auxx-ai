// packages/lib/src/accounting/purchasing/vendor-credit/__tests__/create.test.ts
//
// The line account prefill on createVendorCredit: GRNI on a PO-backed goods line,
// `purchased_services` on a service line (107 §9), blank when the role is unmapped.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  lines: [] as Record<string, unknown>[],
  partKinds: new Map<string, string>(),
  grniAccountId: 'gl_grni' as string | null,
  servicesAccountId: 'gl_services' as string | null,
}))

vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    async create() {
      return { instance: { id: 'vc_1' } }
    }
    async bulkCreate(_def: string, items: Record<string, unknown>[]) {
      h.lines.push(...items)
      return { errors: [] }
    }
  },
}))

vi.mock('../../../../inventory/builds/build-queries', () => ({
  readPartKinds: vi.fn(async () => h.partKinds),
}))

vi.mock('../../bill-intake/link', () => ({
  resolveGrniAccountId: vi.fn(async () => h.grniAccountId),
  resolvePurchasedServicesAccountId: vi.fn(async () => h.servicesAccountId),
}))

vi.mock('../../../sales/totals/totals-hooks', () => ({
  recomputeTotals: vi.fn(async () => undefined),
}))

import type { Database } from '@auxx/database'
import { createVendorCredit } from '../writes'

const db = {} as Database

const create = (purchaseOrderInstanceId?: string) =>
  createVendorCredit(db, {
    organizationId: 'org_1',
    userId: 'user_1',
    vendorCompanyInstanceId: 'co_1',
    purchaseOrderInstanceId,
    lines: [
      { quantity: 1, unitPrice: 1_000, partInstanceId: 'part_goods' },
      { quantity: 1, unitPrice: 500, partInstanceId: 'part_svc' },
      { quantity: 1, unitPrice: 200, partInstanceId: 'part_svc', glAccountInstanceId: 'gl_own' },
    ],
  })

beforeEach(() => {
  h.lines = []
  h.partKinds = new Map([
    ['part_goods', 'raw_material'],
    ['part_svc', 'service'],
  ])
  h.grniAccountId = 'gl_grni'
  h.servicesAccountId = 'gl_services'
})

describe('createVendorCredit - the line account prefill', () => {
  it('prefills GRNI on a goods line and purchased_services on a service line', async () => {
    await create('po_1')
    expect(h.lines.map((line) => line.vendor_credit_line_gl_account)).toEqual([
      'gl_grni',
      'gl_services',
      'gl_own',
    ])
  })

  it('prefills a service line without a purchase order; a goods line stays blank', async () => {
    await create()
    expect(h.lines.map((line) => line.vendor_credit_line_gl_account)).toEqual([
      undefined,
      'gl_services',
      'gl_own',
    ])
  })

  it('leaves a service line blank when purchased_services is unmapped', async () => {
    h.servicesAccountId = null
    await create('po_1')
    expect(h.lines.map((line) => line.vendor_credit_line_gl_account)).toEqual([
      'gl_grni',
      undefined,
      'gl_own',
    ])
  })
})
