// packages/lib/src/money/invoices/__tests__/post-invoice.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: `postInvoiceIssuance`
// is a pure ledger writer with no other side effect, so the accounting-off case
// is checked before ANY read - including the one that loads the invoice's own
// totals, which exists only to build the entry.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  bySystemAttributes: vi.fn(),
  buildInvoiceEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../postings/build-invoice-entry', () => ({
  INVOICE_ISSUED_POSTING_TYPE: 'invoice_issued',
  INVOICE_SOURCE_TYPE: 'invoice',
  buildInvoiceEntry: h.buildInvoiceEntry,
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../postings/post-entry', () => ({
  postEntry: h.postEntry,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))

import type { Database } from '@auxx/database'
import { postInvoiceIssuance } from '../post-invoice'

const ORG = 'org_1'
const INVOICE = 'inv_1'

function stubDb(): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return { select: () => chain } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.bySystemAttributes.mockResolvedValue({
    invoice_number: { id: 'f-number' },
    invoice_issued_at: { id: 'f-issued' },
    invoice_subtotal: { id: 'f-subtotal' },
    invoice_tax_total: { id: 'f-tax' },
    invoice_total: { id: 'f-total' },
  })
  h.buildInvoiceEntry.mockReturnValue({
    entry: {
      postingType: 'invoice_issued',
      periodKey: 'INV-0001',
      txnDate: '2026-09-01',
      lines: [],
    },
  })
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'AUXX-INI-0001',
  })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingEnabled.mockResolvedValue(false)
  })

  it('returns not_enabled without reading the invoice, building, locking, or posting', async () => {
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
    expect(h.buildInvoiceEntry).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('accounting enabled', () => {
  it('loads the invoice, builds, locks, and posts', async () => {
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    expect(h.buildInvoiceEntry).toHaveBeenCalledTimes(1)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
  })
})
