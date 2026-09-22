// packages/lib/src/accounting/export/__tests__/preflight.test.ts
//
// The Ready tab's own read (89 D7). Two things are on trial: that the walk over
// a frozen payload finds every `glAccountId` on all eight shapes - asserted
// against each shape's OWN zod schema, so a new field cannot drift the read-side
// set away from what the adapter resolves - and that the read stays inside our
// database.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAccountingProvider = vi.fn()
vi.mock('../../providers/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../providers/provider')>()),
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

const listChartAccounts = vi.fn()
vi.mock('../../ledger/roles/role-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ledger/roles/role-map')>()),
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

import { ok } from 'neverthrow'
import {
  exportBillSchema,
  exportCreditMemoSchema,
  exportDepositSchema,
  exportInvoiceSchema,
  exportJournalSchema,
  exportPaymentSchema,
  exportRefundReceiptSchema,
  exportVendorCreditSchema,
  payloadAccountIds,
} from '../payloads'
import { readExportBatchBlockers } from '../preflight'

const ORG = 'org_1'
const db = {} as Database

const base = {
  v: 1 as const,
  txnDate: '2026-09-14',
  docNumber: 'DOC-1',
  privateNote: 'auxx:gl:1',
  currency: 'USD' as const,
  totalMinor: 1000,
}
const glRef = (id: string) => ({ glAccountId: id, accountCode: null })
const itemLine = (id: string) => ({ ...glRef(id), amountMinor: 1000, sortOrder: 0 })
const customer = { type: 'customer' as const, id: 'cust_1' }
const vendor = { type: 'vendor' as const, id: 'vend_1' }

/** One parsed fixture per shape, with the account ids it is expected to name. */
const SHAPES: Array<{ objectType: string; payload: unknown; ids: string[] }> = [
  {
    objectType: 'journal',
    payload: exportJournalSchema.parse({
      ...base,
      lines: [
        { ...glRef('gl_a'), direction: 'debit', amountMinor: 1000, sortOrder: 0 },
        { ...glRef('gl_b'), direction: 'credit', amountMinor: 1000, sortOrder: 1 },
      ],
    }),
    ids: ['gl_a', 'gl_b'],
  },
  {
    objectType: 'invoice',
    payload: exportInvoiceSchema.parse({
      ...base,
      customer,
      storeId: null,
      lines: [itemLine('gl_a')],
    }),
    ids: ['gl_a'],
  },
  {
    objectType: 'payment',
    payload: exportPaymentSchema.parse({
      ...base,
      customer,
      appliesTo: { glPostingId: 'glp_1' },
      amountMinor: 1000,
      depositTo: glRef('gl_b'),
    }),
    ids: ['gl_b'],
  },
  {
    objectType: 'credit_memo',
    payload: exportCreditMemoSchema.parse({ ...base, customer, lines: [itemLine('gl_a')] }),
    ids: ['gl_a'],
  },
  {
    objectType: 'refund_receipt',
    payload: exportRefundReceiptSchema.parse({
      ...base,
      customer,
      lines: [itemLine('gl_a')],
      paidFrom: glRef('gl_b'),
    }),
    ids: ['gl_a', 'gl_b'],
  },
  {
    objectType: 'deposit',
    payload: exportDepositSchema.parse({
      ...base,
      depositTo: glRef('gl_b'),
      lines: [{ fromAccount: glRef('gl_a'), amountMinor: 1000 }],
    }),
    ids: ['gl_b', 'gl_a'],
  },
  {
    objectType: 'bill',
    payload: exportBillSchema.parse({
      ...base,
      vendor,
      lines: [{ ...glRef('gl_a'), amountMinor: 1000 }],
    }),
    ids: ['gl_a'],
  },
  {
    objectType: 'vendor_credit',
    payload: exportVendorCreditSchema.parse({
      ...base,
      vendor,
      lines: [{ ...glRef('gl_a'), amountMinor: 1000 }],
    }),
    ids: ['gl_a'],
  },
]

const listProviderAccounts = vi.fn(async () => ok([]))

function provider(mapped: Record<string, string>, id = 'quickbooks') {
  return {
    id,
    listAccountMappings: vi.fn(async () => ok(new Map(Object.entries(mapped)))),
    listProviderAccounts,
    listAccountIdentities: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listChartAccounts.mockResolvedValue(
    ok([
      { id: 'gl_a', code: '4000', name: 'Sales' },
      { id: 'gl_b', code: null, name: 'Shopify Payments Bank' },
    ])
  )
})

describe('payloadAccountIds', () => {
  it.each(SHAPES)('collects every glAccountId on a $objectType', ({ payload, ids }) => {
    expect(payloadAccountIds(payload).sort()).toEqual([...ids].sort())
  })

  it('de-duplicates an account a payload names twice', () => {
    expect(payloadAccountIds({ lines: [glRef('gl_a'), glRef('gl_a')] })).toEqual(['gl_a'])
  })

  it('finds nothing in a payload that names no account', () => {
    expect(payloadAccountIds({ docNumber: 'DOC-1', totalMinor: 10 })).toEqual([])
  })
})

describe('readExportBatchBlockers', () => {
  it('yields one unmapped_account item, with the label, for an id the map has no entry for', async () => {
    resolveAccountingProvider.mockResolvedValue(provider({ gl_a: 'qbo_1' }))

    const result = await readExportBatchBlockers(db, ORG, [
      { id: 'batch_1', payload: SHAPES[0]?.payload },
    ])

    const items = result._unsafeUnwrap().get('batch_1')
    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      key: 'unmapped_account',
      ref: 'gl_b',
      label: 'Shopify Payments Bank',
    })
    expect(items?.[0]?.remedy).toContain('Chart of accounts')
  })

  it('yields nothing when every account the payload names is mapped', async () => {
    resolveAccountingProvider.mockResolvedValue(provider({ gl_a: 'qbo_1', gl_b: 'qbo_2' }))

    const result = await readExportBatchBlockers(db, ORG, [
      { id: 'batch_1', payload: SHAPES[0]?.payload },
    ])

    expect(result._unsafeUnwrap().size).toBe(0)
  })

  // 🛑 The whole reason D7 splits this from `listAccountIdentities`: a tab read
  // must never reach the provider.
  it('never asks the provider for its chart', async () => {
    const mock = provider({})
    resolveAccountingProvider.mockResolvedValue(mock)

    await readExportBatchBlockers(db, ORG, [{ id: 'batch_1', payload: SHAPES[0]?.payload }])

    expect(mock.listProviderAccounts).not.toHaveBeenCalled()
    expect(mock.listAccountIdentities).not.toHaveBeenCalled()
    expect(mock.listAccountMappings).toHaveBeenCalledTimes(1)
  })

  it('reads the map and the chart once for the whole page', async () => {
    const mock = provider({})
    resolveAccountingProvider.mockResolvedValue(mock)

    await readExportBatchBlockers(
      db,
      ORG,
      SHAPES.map((shape, index) => ({ id: `batch_${index}`, payload: shape.payload }))
    )

    expect(mock.listAccountMappings).toHaveBeenCalledTimes(1)
    expect(listChartAccounts).toHaveBeenCalledTimes(1)
  })

  it('an id our own chart does not hold is not an item - there is nothing to pick', async () => {
    resolveAccountingProvider.mockResolvedValue(provider({}))

    const result = await readExportBatchBlockers(db, ORG, [
      { id: 'batch_1', payload: { lines: [glRef('gl_ghost')] } },
    ])

    expect(result._unsafeUnwrap().size).toBe(0)
  })

  it('answers empty with no book connected, rather than blocking every batch', async () => {
    const mock = provider({}, 'none')
    resolveAccountingProvider.mockResolvedValue(mock)

    const result = await readExportBatchBlockers(db, ORG, [
      { id: 'batch_1', payload: SHAPES[0]?.payload },
    ])

    expect(result._unsafeUnwrap().size).toBe(0)
    expect(mock.listAccountMappings).not.toHaveBeenCalled()
  })

  it('touches nothing when no batch in the page names an account', async () => {
    await readExportBatchBlockers(db, ORG, [{ id: 'batch_1', payload: { docNumber: 'DOC-1' } }])

    expect(resolveAccountingProvider).not.toHaveBeenCalled()
  })
})
