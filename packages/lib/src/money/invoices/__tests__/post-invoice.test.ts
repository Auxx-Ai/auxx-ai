// packages/lib/src/money/invoices/__tests__/post-invoice.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: `postInvoiceIssuance`
// is a pure ledger writer with no other side effect, so the accounting-off case
// is checked before ANY read - including the one that loads the invoice's own
// totals, which exists only to build the entry.
//
// plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3 (D19): the issuance
// now posts through a captured `AccountingWork` and `acceptEntryInTx` rather
// than straight through `postEntry`, so these tests exercise that seam. The two
// properties the original file protected are unchanged and still asserted: the
// accounting-off short circuit, and the receivable's counterparty coming off the
// invoice's own contact.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  bySystemAttributes: vi.fn(),
  buildInvoiceEntry: vi.fn(),
  resolveAccountLines: vi.fn(),
  captureDocumentWorkInTx: vi.fn(),
  assertDocumentJournalIsOwnedInTx: vi.fn(),
  acceptEntryInTx: vi.fn(),
  resolveFulfillmentDeliveryIntentInTx: vi.fn(),
  planAccountingDeliveryInTx: vi.fn(),
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
vi.mock('../../../postings/resolve-roles', () => ({
  resolveAccountLines: h.resolveAccountLines,
}))
vi.mock('../../../postings/document-effect-work', () => ({
  captureDocumentWorkInTx: h.captureDocumentWorkInTx,
  assertDocumentJournalIsOwnedInTx: h.assertDocumentJournalIsOwnedInTx,
}))
vi.mock('../../../postings/accept-entry', () => ({ acceptEntryInTx: h.acceptEntryInTx }))
vi.mock('../../../postings/book-connections', () => ({
  resolveFulfillmentDeliveryIntentInTx: h.resolveFulfillmentDeliveryIntentInTx,
}))
vi.mock('../../../postings/delivery', () => ({
  planAccountingDeliveryInTx: h.planAccountingDeliveryInTx,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) =>
    key === 'organization.currency' ? 'USD' : 'UTC',
}))

import type { Database } from '@auxx/database'
import { postInvoiceIssuance } from '../post-invoice'

const ORG = 'org_1'
const INVOICE = 'inv_1'

function stubDb(rows: unknown[] = []): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve)
  const db = {
    select: () => chain,
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
  }
  return db as never
}

/** Two balancing lines, the shape `buildInvoiceEntry` emits for a tax-free invoice. */
function entryLines(contactInstanceId: string | null) {
  return [
    {
      sourceType: 'invoice',
      sourceId: INVOICE,
      accountRole: 'accounts_receivable',
      direction: 'debit' as const,
      amount: 1000,
      sortOrder: 0,
      ...(contactInstanceId
        ? { counterpartyType: 'customer' as const, counterpartyId: contactInstanceId }
        : {}),
    },
    {
      sourceType: 'invoice',
      sourceId: INVOICE,
      accountRole: 'revenue_service',
      direction: 'credit' as const,
      amount: 1000,
      sortOrder: 1,
    },
  ]
}

const account = (glAccountId: string) => ({
  glAccountId,
  code: null,
  name: glAccountId,
  accountType: 'asset',
  isActive: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.bySystemAttributes.mockResolvedValue({
    invoice_number: { id: 'f-number' },
    invoice_issued_at: { id: 'f-issued' },
    invoice_subtotal: { id: 'f-subtotal' },
    invoice_tax_total: { id: 'f-tax' },
    invoice_total: { id: 'f-total' },
    invoice_contact: { id: 'f-contact' },
  })
  h.buildInvoiceEntry.mockImplementation((input: { contactInstanceId?: string | null }) => ({
    entry: {
      postingType: 'invoice_issued',
      periodKey: 'INV-0001',
      txnDate: '2026-09-01',
      lines: entryLines(input.contactInstanceId ?? null),
      totalDebit: 1000,
      totalCredit: 1000,
    },
    periodKey: 'INV-0001',
    totalMinor: 1000,
    revenueMinor: 1000,
    taxTotalMinor: 0,
    subtotalMinor: 1000,
  }))
  h.resolveAccountLines.mockResolvedValue(ok([account('gl_ar'), account('gl_rev')]))
  h.captureDocumentWorkInTx.mockResolvedValue({
    work: { id: 'work_1', basisVersion: 1 },
    basis: {},
    existing: false,
  })
  h.acceptEntryInTx.mockResolvedValue({
    status: 'accepted',
    existing: false,
    glPostingId: 'gl_1',
    glPostingIds: ['gl_1'],
    effectIds: ['ef_1'],
    postings: [],
  })
  h.resolveFulfillmentDeliveryIntentInTx.mockResolvedValue({ kind: 'not_required' })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingEnabled.mockResolvedValue(false)
  })

  it('returns not_enabled without reading the invoice, building, capturing or accepting', async () => {
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
    expect(h.buildInvoiceEntry).not.toHaveBeenCalled()
    expect(h.captureDocumentWorkInTx).not.toHaveBeenCalled()
    expect(h.acceptEntryInTx).not.toHaveBeenCalled()
  })
})

describe('accounting enabled', () => {
  it('loads the invoice, builds, captures the obligation and accepts', async () => {
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    expect(h.buildInvoiceEntry).toHaveBeenCalled()
    expect(h.captureDocumentWorkInTx).toHaveBeenCalledTimes(1)
    expect(h.acceptEntryInTx).toHaveBeenCalledTimes(1)
    expect(h.planAccountingDeliveryInTx).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('posted')
    expect(result.glPostingId).toBe('gl_1')
  })

  // D19: the obligation is owned by the invoice, in the invoice_issued family.
  it('captures the work against the invoice in the invoice_issued family', async () => {
    await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    expect(h.captureDocumentWorkInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG,
        family: 'invoice_issued',
        documentInstanceId: INVOICE,
        eligibility: 'automatic',
      })
    )
  })

  // 53 §7.3.3: the claim stays keyed on the invoice number, not on a grouping
  // hash, so the document number stays AUXX-INI-INV-0001.
  it('keeps the invoice number as the journal period key and the document key', async () => {
    await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })

    const [, accepted] = h.acceptEntryInTx.mock.calls[0] as [unknown, Record<string, never>]
    const input = accepted as unknown as {
      entry: { periodKey: string }
      members: Array<{ acceptedBasis: { policyKey: string; calculation: { documentKey: string } } }>
    }
    expect(input.entry.periodKey).toBe('INV-0001')
    expect(input.members[0]!.acceptedBasis.policyKey).toBe('document_entry_v1')
    expect(input.members[0]!.acceptedBasis.calculation.documentKey).toBe('INV-0001')
  })

  // brief 13 §1.2: the receivable's counterparty is the invoice's own contact.
  it('reads the invoice contact and passes it to the builder', async () => {
    await postInvoiceIssuance(stubDb([{ fieldId: 'f-contact', relatedEntityId: 'ei_contact_1' }]), {
      organizationId: ORG,
      invoiceId: INVOICE,
    })
    expect(h.buildInvoiceEntry).toHaveBeenCalledWith(
      expect.objectContaining({ contactInstanceId: 'ei_contact_1' })
    )
  })

  it('passes null when the invoice has no contact', async () => {
    await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })
    expect(h.buildInvoiceEntry).toHaveBeenCalledWith(
      expect.objectContaining({ contactInstanceId: null })
    )
  })

  // `already_posted` is a SUCCESS - a converged re-run, never an error.
  it('reports an existing acceptance as already_posted', async () => {
    h.acceptEntryInTx.mockResolvedValue({
      status: 'accepted',
      existing: true,
      glPostingId: 'gl_1',
      glPostingIds: ['gl_1'],
      effectIds: ['ef_1'],
      postings: [],
    })
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })
    expect(result.status).toBe('already_posted')
  })

  // An invoice whose totals cannot be read is an empty document, not a failure.
  it('reports an unreadable invoice as nothing_to_close', async () => {
    // No invoice custom fields at all - the org cannot describe an invoice, so
    // there is nothing to recognise.
    h.bySystemAttributes.mockResolvedValue({
      invoice_number: null,
      invoice_issued_at: null,
      invoice_subtotal: null,
      invoice_tax_total: null,
      invoice_total: null,
      invoice_contact: null,
    })
    const result = await postInvoiceIssuance(stubDb(), { organizationId: ORG, invoiceId: INVOICE })
    expect(result.status).toBe('nothing_to_close')
  })
})
