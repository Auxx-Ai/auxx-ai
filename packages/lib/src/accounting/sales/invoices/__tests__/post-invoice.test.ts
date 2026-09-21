// packages/lib/src/accounting/sales/invoices/__tests__/post-invoice.test.ts
//
// The invoice issuance writer on the one poster: post → one entry with the
// subject and counterparty links, reverse → the claim is freed, post again →
// a new entry (MIGRATION.md step 1b).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  bySystemAttributes: vi.fn(),
  buildInvoiceEntry: vi.fn(),
  postEntry: vi.fn(),
  reverseEntry: vi.fn(),
  listPostingsForSource: vi.fn(),
  resolvePeriodLock: vi.fn(),
  readAutoPostMode: vi.fn(async () => 'post'),
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../ledger/post/auto-post', () => ({
  readAutoPostMode: h.readAutoPostMode,
}))
vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../ledger/builders/invoice', () => ({
  INVOICE_SOURCE_TYPE: 'invoice',
  buildInvoiceEntry: h.buildInvoiceEntry,
}))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../../ledger/post/draft-lines', () => ({
  discardDraftsForSource: async () => ({ isErr: () => false, value: [] }),
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) =>
    key === 'organization.currency' ? 'USD' : 'UTC',
}))

import type { Database } from '@auxx/database'
import { listPostingsForSource } from '../../../ledger/reads/list-postings'
import { postInvoiceIssuance, reverseInvoiceIssuance } from '../post-invoice'

vi.mock('../../../ledger/reads/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
  findLiveSubjectPosting: async (
    _db: unknown,
    options: { sourceKind: string; sourceId: string; occurrence?: string }
  ) => {
    const found = await h.listPostingsForSource(_db, options)
    if (!found.isOk()) return found
    const live = found.value.find(
      (posting: { linkRole: string; status: string; occurrence: string }) =>
        posting.linkRole === 'subject' &&
        posting.status !== 'reversed' &&
        (options.occurrence === undefined || posting.occurrence === options.occurrence)
    )
    return { isErr: () => false, isOk: () => true, value: live ?? null }
  },
}))

const ORG = 'org-1'
const INVOICE = 'inv-1'
const CONTACT = 'contact-1'
const db = {} as Database

/** The claim: one live subject row per source, deleted by a reversal. */
let claims: Array<Record<string, unknown>> = []

function wireInvoice(contactInstanceId: string | null = CONTACT) {
  h.bySystemAttributes.mockResolvedValue({
    invoice_number: { id: 'f-number' },
    invoice_issued_at: { id: 'f-issued' },
    invoice_subtotal: { id: 'f-subtotal' },
    invoice_tax_total: { id: 'f-tax' },
    invoice_total: { id: 'f-total' },
    invoice_contact: contactInstanceId ? { id: 'f-contact' } : null,
  })
  return {
    select: () => ({
      from: () => ({
        where: async () => [
          { fieldId: 'f-number', valueText: 'INV-0042' },
          { fieldId: 'f-issued', valueDate: '2026-09-01T00:00:00.000Z' },
          { fieldId: 'f-subtotal', valueNumber: 1000 },
          { fieldId: 'f-tax', valueNumber: 100 },
          { fieldId: 'f-total', valueNumber: 1100 },
          ...(contactInstanceId
            ? [{ fieldId: 'f-contact', relatedEntityId: contactInstanceId }]
            : []),
        ],
      }),
    }),
  } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  claims = []
  h.isAccountingEnabled.mockResolvedValue(true)
  h.readAutoPostMode.mockResolvedValue('post')
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.buildInvoiceEntry.mockReturnValue({
    entry: {
      postingType: 'invoice_issued',
      periodKey: 'INV-0042',
      txnDate: '2026-09-01',
      lines: [],
    },
  })
  h.listPostingsForSource.mockImplementation(async () => ({
    isErr: () => false,
    isOk: () => true,
    value: claims,
  }))
  h.postEntry.mockImplementation(async (_db: unknown, options: { sources: unknown[] }) => {
    const id = `gl_${claims.length + 1}`
    for (const source of options.sources as Array<Record<string, unknown>>)
      claims.push({
        id,
        docNumber: `INV-${id}`,
        status: 'posted',
        postingType: 'invoice_issued',
        linkRole: source.linkRole,
        occurrence: source.occurrence ?? 'original',
      })
    return { status: 'posted', glPostingId: id, docNumber: `INV-${id}` }
  })
  h.reverseEntry.mockImplementation(async (_db: unknown, options: { glPostingId: string }) => {
    claims = claims.filter(
      (claim) => !(claim.id === options.glPostingId && claim.linkRole === 'subject')
    )
    return { status: 'posted', glPostingId: 'gl_rev' }
  })
})

describe('postInvoiceIssuance', () => {
  it('posts one entry whose subject is the invoice and whose counterparty is its contact', async () => {
    const result = await postInvoiceIssuance(wireInvoice(), {
      organizationId: ORG,
      invoiceId: INVOICE,
    })

    expect(result.status).toBe('posted')
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    const options = h.postEntry.mock.calls[0]![1]
    expect(options.sources).toEqual([
      { sourceKind: 'invoice', sourceId: INVOICE, linkRole: 'subject' },
      { sourceKind: 'contact', sourceId: CONTACT, linkRole: 'counterparty' },
    ])
    expect(options.mode).toBe('post')
  })

  it('posts without a counterparty row when the invoice has no contact', async () => {
    await postInvoiceIssuance(wireInvoice(null), { organizationId: ORG, invoiceId: INVOICE })

    expect(h.postEntry.mock.calls[0]![1].sources).toHaveLength(1)
  })

  it('drafts the entry when the invoice avenue does not auto-post', async () => {
    h.readAutoPostMode.mockResolvedValue('draft')

    h.postEntry.mockResolvedValue({ status: 'drafted', glPostingId: 'gp-draft' })

    await postInvoiceIssuance(wireInvoice(), { organizationId: ORG, invoiceId: INVOICE })

    expect(h.postEntry.mock.calls[0]![1].mode).toBe('draft')
  })

  it('never posts, and never reads, when accounting is off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await postInvoiceIssuance(wireInvoice(), {
      organizationId: ORG,
      invoiceId: INVOICE,
    })

    expect(result.status).toBe('not_enabled')
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('reverseInvoiceIssuance', () => {
  it('frees the claim so the invoice can post again - the Save-after-Edit round trip', async () => {
    const wired = wireInvoice()
    await postInvoiceIssuance(wired, { organizationId: ORG, invoiceId: INVOICE })
    expect(claims.filter((claim) => claim.linkRole === 'subject')).toHaveLength(1)

    expect(await reverseInvoiceIssuance(db, { organizationId: ORG, invoiceId: INVOICE })).toBeNull()
    expect(claims.filter((claim) => claim.linkRole === 'subject')).toHaveLength(0)

    await postInvoiceIssuance(wired, { organizationId: ORG, invoiceId: INVOICE })
    const live = claims.filter((claim) => claim.linkRole === 'subject')
    expect(live).toHaveLength(1)
    expect(live[0]!.id).not.toBe('gl_1')
  })

  it('is a no-op when nothing is standing', async () => {
    expect(await reverseInvoiceIssuance(db, { organizationId: ORG, invoiceId: INVOICE })).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('returns the refusal so the void can refuse too', async () => {
    await postInvoiceIssuance(wireInvoice(), { organizationId: ORG, invoiceId: INVOICE })
    h.reverseEntry.mockResolvedValue({ status: 'period_closed', error: 'August is closed.' })

    const result = await reverseInvoiceIssuance(db, { organizationId: ORG, invoiceId: INVOICE })

    expect(result?.status).toBe('period_closed')
  })
})

describe('listInvoicePostings', () => {
  it('reads through GlPostingSource, not a stamp field', async () => {
    await postInvoiceIssuance(wireInvoice(), { organizationId: ORG, invoiceId: INVOICE })
    const found = await listPostingsForSource(db, {
      organizationId: ORG,
      sourceKind: 'invoice',
      sourceId: INVOICE,
    })

    expect(found.isOk() && found.value.some((row) => row.linkRole === 'subject')).toBe(true)
  })
})
