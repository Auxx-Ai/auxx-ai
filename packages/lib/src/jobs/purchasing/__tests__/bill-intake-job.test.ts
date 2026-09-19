// packages/lib/src/jobs/purchasing/__tests__/bill-intake-job.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  run: null as any,
  transcribe: vi.fn(),
  resolveVendor: vi.fn(),
  findExisting: vi.fn(),
  findOrder: vi.fn(),
  loadLines: vi.fn(),
  assign: vi.fn(),
  proposeLanded: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  phase: vi.fn(),
  park: vi.fn(),
  fail: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@auxx/database', () => ({
  database: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: vi.fn() }),
  },
  schema: new Proxy(
    {},
    {
      get: () => new Proxy({}, { get: () => ({}) }),
    }
  ),
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('../../../cache/index', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => ({}) }),
  }),
}))
vi.mock('../../../accounting/purchasing/bill-intake', () => ({
  assignBillLines: h.assign,
  checkIntakeModelCapability: vi.fn(async () => ({
    isErr: () => false,
    value: { ok: true, modelId: 'test-model', reason: null },
  })),
  findExistingBill: h.findExisting,
  findOrderByReference: h.findOrder,
  foldKey: (value: string | null) => value?.trim().toLowerCase() ?? null,
  loadOrderLineFacts: h.loadLines,
  proposeLandedBills: h.proposeLanded,
  resolveInvoiceVendor: h.resolveVendor,
  transcribeInvoice: h.transcribe,
}))
vi.mock('../../../accounting/purchasing/bill-intake/create', () => ({
  createBillFromIntake: h.create,
  loadPurchaseOrderCurrency: vi.fn(async () => null),
}))
vi.mock('../../../accounting/purchasing/intake/transcribe', () => ({
  checkIntakeModelCapability: vi.fn(async () => ({
    isErr: () => false,
    value: { ok: true, modelId: 'test-model', reason: null },
  })),
}))
vi.mock('../../../accounting/purchasing/bill-intake/run-store', () => ({
  failBillIntakeRun: h.fail,
  parkBillIntakeRunForVendor: h.park,
  readStoredBillIntakeRun: async () => h.run,
  setBillIntakeRunPhase: h.phase,
  updateBillIntakeRun: h.update,
}))
vi.mock('../../../field-values/org-currency', () => ({ getOrgCurrencyCode: vi.fn() }))
vi.mock('../../../accounting/purchasing/intake/client', () => ({
  resolveIntakeUnitPrice: () => 420,
}))
vi.mock('../../../utils/rate-limiter/fixed-window', () => ({ checkFixedWindowLimit: h.limit }))
vi.mock('../../queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queues')>()),
  getQueue: vi.fn(),
}))

import { ok } from 'neverthrow'
import type { TranscribedInvoice } from '../../../accounting/purchasing/bill-intake/client'
import type { StoredBillIntakeRun } from '../../../accounting/purchasing/bill-intake/run-store'
import { getQueue } from '../../queues'
import type { JobContext } from '../../types'
import { billIntakeJob, enqueueBillIntake } from '../bill-intake-job'

const invoice: TranscribedInvoice = {
  vendorName: 'Acme Ltd',
  vendorEmail: null,
  vendorAddress: null,
  invoiceNumber: 'INV-1',
  invoiceDate: null,
  dueDate: null,
  paymentTerms: null,
  purchaseOrderReference: null,
  referencedInvoiceNumber: null,
  currency: 'USD',
  subtotalText: '4.20',
  shippingText: null,
  taxText: null,
  discountText: null,
  totalText: '4.20',
  lines: [
    {
      lineNumber: 1,
      vendorCode: 'A-1',
      customerCode: null,
      description: 'Bolt',
      quantity: 1,
      unit: 'ea',
      unitPriceText: '4.20',
      lineTotalText: '4.20',
      referencedInvoiceNumber: null,
    },
  ],
}

function makeRun(overrides: Partial<StoredBillIntakeRun> = {}): StoredBillIntakeRun {
  return {
    id: 'run_1',
    organizationId: 'org_1',
    createdById: 'user_1',
    status: 'reading',
    phase: null,
    assetRef: 'asset:a1',
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    vendorRecordId: 'company:c1' as never,
    vendorCandidates: [],
    purchaseOrderRecordId: null,
    transcription: invoice,
    extractedText: null,
    proposals: null,
    warnings: [],
    vendorBillInstanceId: null,
    vendorBillRecordId: null,
    vendorBillLineRecordIds: [],
    existingBillRecordId: null,
    error: null,
    createdAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  }
}

function context(overrides: Record<string, unknown> = {}): JobContext<any> {
  return {
    job: {
      data: { organizationId: 'org_1', userId: 'user_1', runId: 'run_1' },
      attemptsMade: 0,
      opts: { attempts: 2 },
      ...overrides,
    },
  } as unknown as JobContext<any>
}

beforeEach(() => {
  h.run = makeRun()
  h.transcribe.mockReset()
  h.resolveVendor.mockReset()
  h.findExisting.mockReset().mockResolvedValue(ok(null))
  h.findOrder.mockReset().mockResolvedValue(ok(null))
  h.loadLines.mockReset().mockResolvedValue(ok([]))
  h.assign.mockReset().mockReturnValue([
    {
      lineId: '0',
      tier: 'none',
      candidates: [],
      linkedOrderLineRecordId: null,
      landedBillRecordId: null,
      hint: 'goods',
    },
  ])
  h.proposeLanded.mockReset().mockResolvedValue(ok([null]))
  h.create.mockReset().mockResolvedValue(
    ok({
      vendorBillRecordId: 'vendor_bill:b1',
      vendorBillInstanceId: 'b1',
      vendorBillLineRecordIds: ['vendor_bill_line:l1'],
      warnings: [],
    })
  )
  h.update.mockReset().mockResolvedValue(ok(undefined))
  h.phase.mockReset().mockResolvedValue(ok(undefined))
  h.park.mockReset().mockResolvedValue(ok(undefined))
  h.fail.mockReset().mockResolvedValue(ok(undefined))
  h.limit.mockReset().mockResolvedValue({ allowed: true, count: 1 })
})

describe('billIntakeJob', () => {
  it('enqueues with a stable run id and retry policy', async () => {
    const add = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ add } as never)

    await enqueueBillIntake({ organizationId: 'org_1', userId: 'user_1', runId: 'run_1' })

    expect(add).toHaveBeenCalledWith(
      'billIntakeJob',
      { organizationId: 'org_1', userId: 'user_1', runId: 'run_1' },
      {
        jobId: 'bill-intake:org_1:run_1',
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
      }
    )

    await enqueueBillIntake({
      organizationId: 'org_1',
      userId: 'user_1',
      runId: 'run_1',
      resume: true,
    })
    expect(add).toHaveBeenLastCalledWith(
      'billIntakeJob',
      { organizationId: 'org_1', userId: 'user_1', runId: 'run_1', resume: true },
      expect.objectContaining({ jobId: 'bill-intake:org_1:run_1-resume' })
    )
  })

  it('resumes a transcribed run without a second model call', async () => {
    const result = await billIntakeJob(context())

    expect(result).toMatchObject({ created: true, vendorBillInstanceId: 'b1' })
    expect(h.transcribe).not.toHaveBeenCalled()
    expect(h.limit).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledOnce()
    expect(h.assign).toHaveBeenCalledOnce()
  })

  it('parks an unresolved vendor while keeping the transcription', async () => {
    h.run = makeRun({ vendorRecordId: null, transcription: null })
    h.transcribe.mockResolvedValue(ok({ document: invoice, extractedText: null }))
    h.resolveVendor.mockResolvedValue(
      ok({
        vendorRecordId: null,
        candidates: [
          {
            recordId: 'company:candidate' as never,
            displayName: 'Acme Industrial',
            secondary: null,
          },
        ],
      })
    )

    const result = await billIntakeJob(context())

    expect(result).toMatchObject({ needsVendor: true })
    expect(h.transcribe).toHaveBeenCalledOnce()
    expect(h.park).toHaveBeenCalledOnce()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses a duplicate before matching or creating', async () => {
    h.findExisting.mockResolvedValue(
      ok({
        billRecordId: 'vendor_bill:existing' as never,
        internalNumber: 'BILL-42',
        number: 'INV-1',
      })
    )

    const result = await billIntakeJob(context())

    expect(result).toMatchObject({ skipped: 'duplicate_invoice' })
    expect(h.fail).toHaveBeenCalledWith(
      'org_1',
      'run_1',
      expect.stringContaining('already BILL-42'),
      'vendor_bill:existing'
    )
    expect(h.create).not.toHaveBeenCalled()
    expect(h.assign).not.toHaveBeenCalled()
  })

  it('leaves a transient failure reading for the BullMQ retry', async () => {
    h.findExisting.mockRejectedValue(new Error('database unavailable'))

    await expect(billIntakeJob(context())).rejects.toThrow('database unavailable')

    expect(h.fail).not.toHaveBeenCalled()
  })

  it('marks the run failed on the terminal attempt', async () => {
    h.findExisting.mockRejectedValue(new Error('database unavailable'))

    await expect(
      billIntakeJob(context({ attemptsMade: 1, opts: { attempts: 2 } }))
    ).rejects.toThrow('database unavailable')

    expect(h.fail).toHaveBeenCalledWith('org_1', 'run_1', 'database unavailable', undefined)
  })

  it('refuses a parser-valid document with no invoice content', async () => {
    h.run = makeRun({ transcription: null })
    h.transcribe.mockResolvedValue(
      ok({ document: { ...invoice, lines: [], totalText: null }, extractedText: null })
    )

    const result = await billIntakeJob(context())

    expect(result).toMatchObject({ skipped: 'invoice_not_readable' })
    expect(h.fail).toHaveBeenCalledWith(
      'org_1',
      'run_1',
      'We could not read an invoice total or any invoice lines from this document.',
      undefined
    )
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses an invoice created by another run while this run was matching', async () => {
    h.findExisting
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok({ billRecordId: 'vendor_bill:other', internalNumber: 'BILL-43' }))
    const result = await billIntakeJob(context())
    expect(result).toMatchObject({ skipped: 'duplicate_invoice' })
    expect(h.findExisting).toHaveBeenCalledTimes(2)
    expect(h.create).not.toHaveBeenCalled()
    expect(h.fail).toHaveBeenCalledWith(
      'org_1',
      'run_1',
      expect.stringContaining('BILL-43'),
      'vendor_bill:other'
    )
  })

  it('skips a run whose bill was already created', async () => {
    h.run = makeRun({ status: 'created', vendorBillRecordId: 'vendor_bill:b1' as never })

    await expect(billIntakeJob(context())).resolves.toMatchObject({ skipped: 'run_created' })

    expect(h.transcribe).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
})
