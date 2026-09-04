// packages/lib/src/money/__tests__/send-email-document-profiles.test.ts
//
// `prepareDocumentEmail` used to decide four separate things with a `documentType ===
// 'invoice' ? … : <quote>` ternary — the error copy, the contact field, the system snippet
// and the placeholder root — so every non-invoice document took the QUOTE arm. That is the
// same "everything else is a quote" shape as the `documentTypeOf` default fixed in
// `send-email-document-type.test.ts` (purchasing plan 07 §2.1); it merely failed loudly
// instead of silently, telling a user sending a purchase order that "this quote has no
// contact". These tests pin the per-document-type table that replaced it, and — the part
// that must never regress — that ONLY a quote is ever minted a public approve/decline token
// (§2.3).

import type { RecordId } from '@auxx/types'
import { toResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_TYPE_DESCRIPTORS } from '../../documents/client'
import { BadRequestError } from '../../errors'
import { DOCUMENT_EMAIL_PROFILES, prepareDocumentEmail } from '../send-email'

const {
  mockCacheGet,
  mockBySystemAttributes,
  mockGetFieldValues,
  mockBatchGetValues,
  mockGetSystemSnippet,
  mockResolvePlaceholders,
  mockEnsurePdfViaQueue,
  mockEnsureQuotePublicToken,
  mockBuildQuoteViewUrl,
  mockEnsureInvoicePublicToken,
  mockIsPaymentsConnected,
  mockGetOrganizationSetting,
  mockFormatToDisplayValue,
} = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockBySystemAttributes: vi.fn(),
  mockGetFieldValues: vi.fn(),
  mockBatchGetValues: vi.fn(),
  mockGetSystemSnippet: vi.fn(),
  mockResolvePlaceholders: vi.fn(),
  mockEnsurePdfViaQueue: vi.fn(),
  mockEnsureQuotePublicToken: vi.fn(),
  mockBuildQuoteViewUrl: vi.fn(),
  mockEnsureInvoicePublicToken: vi.fn(),
  mockIsPaymentsConnected: vi.fn(),
  mockGetOrganizationSetting: vi.fn(),
  mockFormatToDisplayValue: vi.fn(),
}))

// `documents/client.ts` is NOT mocked — `documentTypeOf` resolves against the real
// `DOCUMENT_TYPE_DESCRIPTORS`, so these tests only pass while `purchase_order` is genuinely
// registered for printing. That coupling is the point (purchasing plan 07 §1.2/§2.1).

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    get: mockCacheGet,
    from: () => ({ bySystemAttributes: mockBySystemAttributes }),
  }),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = mockGetFieldValues
    fieldValueService = { batchGetValues: mockBatchGetValues }
  },
}))

vi.mock('../../documents', () => ({
  ensureDocumentPdf: vi.fn(),
  ensureDocumentPdfViaQueue: mockEnsurePdfViaQueue,
}))

vi.mock('../../snippets', () => ({ getSystemSnippet: mockGetSystemSnippet }))
vi.mock('../../placeholders', () => ({ resolvePlaceholdersInHtml: mockResolvePlaceholders }))
vi.mock('../../field-values/formatter', () => ({
  formatToDisplayValue: mockFormatToDisplayValue,
}))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: mockGetOrganizationSetting,
}))
vi.mock('../quote-public-token', () => ({
  ensureQuotePublicToken: mockEnsureQuotePublicToken,
  buildQuoteViewUrl: mockBuildQuoteViewUrl,
}))
vi.mock('../public-token', () => ({
  ensureInvoicePublicToken: mockEnsureInvoicePublicToken,
  isPaymentsConnected: mockIsPaymentsConnected,
  buildPayUrl: (t: string) => `https://pay.test/${t}`,
}))
vi.mock('../payments/account-state', () => ({ getPaymentAccount: vi.fn(async () => null) }))

const ORG_ID = 'org_test'
const USER_ID = 'user_test'
const CONTACT_DEF_ID = 'def_contact'
const CONTACT_INSTANCE_ID = 'inst_contact'
const CONTACT_RECORD_ID = toRecordId(CONTACT_DEF_ID, CONTACT_INSTANCE_ID)

const ENTITY_DEFS: Record<string, string> = {
  quote: 'def_quote',
  invoice: 'def_invoice',
  purchase_order: 'def_purchase_order',
  contact: CONTACT_DEF_ID,
}

/** `CustomField.id` per systemAttribute — the ids `bySystemAttributes` hands back. */
const FIELD_IDS: Record<string, string> = {
  quote_contact: 'fld_quote_contact',
  invoice_contact: 'fld_invoice_contact',
  purchase_order_contact: 'fld_po_contact',
  full_name: 'fld_full_name',
  primary_email: 'fld_primary_email',
}

/** Which systemAttributes `bySystemAttributes` resolves to a real field. Mutated per test. */
let presentFields = new Set(Object.keys(FIELD_IDS))
/** Contact link present on the document under test. */
let documentHasContact = true
/** The contact's `primary_email` value, or `undefined` for "no email on file". */
let contactEmail: string | undefined = 'buyer@vendor.test'

beforeEach(() => {
  vi.clearAllMocks()
  presentFields = new Set(Object.keys(FIELD_IDS))
  documentHasContact = true
  contactEmail = 'buyer@vendor.test'

  mockCacheGet.mockImplementation(async (_orgId: string, key: string) =>
    key === 'entityDefs' ? ENTITY_DEFS : {}
  )

  mockBySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(
      attrs.map((attr) => [
        attr,
        presentFields.has(attr) && FIELD_IDS[attr] ? { id: FIELD_IDS[attr] } : null,
      ])
    )
  )

  mockGetFieldValues.mockImplementation(async (_recordId: RecordId, fieldIds: string[]) => {
    const map = new Map()
    for (const fieldId of fieldIds) {
      if (documentHasContact) {
        map.set(fieldId, { type: 'relationship', recordId: CONTACT_RECORD_ID })
      }
    }
    return map
  })

  mockBatchGetValues.mockImplementation(async () => ({
    values: [
      {
        fieldRef: toResourceFieldId(CONTACT_DEF_ID, FIELD_IDS.full_name as string),
        value: { type: 'text', value: 'Dana Buyer' },
        fieldType: 'NAME',
        fieldOptions: undefined,
      },
      ...(contactEmail
        ? [
            {
              fieldRef: toResourceFieldId(CONTACT_DEF_ID, FIELD_IDS.primary_email as string),
              value: { type: 'text', value: contactEmail },
              fieldType: 'EMAIL',
              fieldOptions: undefined,
            },
          ]
        : []),
    ],
  }))

  mockFormatToDisplayValue.mockReturnValue('Dana Buyer')
  mockGetSystemSnippet.mockImplementation(
    async (_db: unknown, _org: string, systemType: string) => ({
      title: `subject for ${systemType}`,
      contentHtml: `<p>body for ${systemType}</p>`,
    })
  )
  mockResolvePlaceholders.mockImplementation(async (html: string) => html)
  mockEnsurePdfViaQueue.mockResolvedValue({ assetId: 'asset_1', fileName: 'doc.pdf' })
  mockGetOrganizationSetting.mockResolvedValue(true)
  mockEnsureQuotePublicToken.mockResolvedValue('qtok')
  mockBuildQuoteViewUrl.mockReturnValue('https://view.test/qtok')
  mockIsPaymentsConnected.mockReturnValue(false)
})

/** The `recordIdsByRoot` map `resolvePlaceholdersInHtml` was called with. */
function placeholderRoots(): Map<string, RecordId> {
  const ctx = mockResolvePlaceholders.mock.calls[0]?.[1] as {
    recordIdsByRoot: Map<string, RecordId>
  }
  return ctx.recordIdsByRoot
}

function send(entityType: string) {
  return prepareDocumentEmail({
    organizationId: ORG_ID,
    userId: USER_ID,
    quoteRecordId: toRecordId(entityType, `inst_${entityType}`),
  })
}

describe('prepareDocumentEmail — per-document-type profile table (purchasing plan 07)', () => {
  describe('purchase order', () => {
    it('resolves purchase_order_contact, NOT quote_contact', async () => {
      await send('purchase_order')
      expect(mockGetFieldValues).toHaveBeenCalledWith(expect.anything(), [
        FIELD_IDS.purchase_order_contact,
      ])
      expect(mockGetFieldValues).not.toHaveBeenCalledWith(expect.anything(), [
        FIELD_IDS.quote_contact,
      ])
    })

    it('never reads the vendor company — a company has no email field to send to', async () => {
      await send('purchase_order')
      const requested = mockBySystemAttributes.mock.calls.flatMap((call) => call[0] as string[])
      expect(requested).not.toContain('purchase_order_vendor')
    })

    it('selects the purchase_order_email system snippet', async () => {
      const result = await send('purchase_order')
      expect(mockGetSystemSnippet).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        'purchase_order_email'
      )
      expect(result.subject).toBe('subject for purchase_order_email')
      expect(result.contentHtml).toContain('body for purchase_order_email')
    })

    it('roots placeholders at the purchase_order def, not the quote def', async () => {
      await send('purchase_order')
      const roots = placeholderRoots()
      expect(roots.get(ENTITY_DEFS.purchase_order as string)).toBe(
        toRecordId('purchase_order', 'inst_purchase_order')
      )
      expect(roots.has(ENTITY_DEFS.quote as string)).toBe(false)
      expect(roots.get(CONTACT_DEF_ID)).toBe(CONTACT_RECORD_ID)
    })

    // ⚠️ `purchase_order_contact` is nullable and nothing prefills it, so this is the COMMON
    // path today, not an edge case — the message has to be actionable.
    it('reports a purchase-order-specific no-contact error naming the Contact field', async () => {
      documentHasContact = false
      const error = await send('purchase_order').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BadRequestError)
      const message = (error as Error).message
      expect(message).toContain('This purchase order has no contact')
      expect(message).toContain('Contact field')
      expect(message).toContain('vendor')
      expect(message).not.toContain('quote')
    })

    it('reports a purchase-order-specific no-email error', async () => {
      contactEmail = undefined
      await expect(send('purchase_order')).rejects.toThrow(
        'This purchase order contact has no email address — add one before sending'
      )
    })

    // 🛑 purchasing plan 07 §2.3 — the whole reason `documentTypeOf` was fixed. A vendor must
    // never receive a customer-facing approve/decline link.
    it('is NEVER minted a public token and gets no view URL', async () => {
      const result = await send('purchase_order')
      expect(mockEnsureQuotePublicToken).not.toHaveBeenCalled()
      expect(mockBuildQuoteViewUrl).not.toHaveBeenCalled()
      expect(result.contentHtml).not.toContain('View & accept')
      expect(result.contentHtml).not.toContain('view.test')
    })

    it('does not check the quote acceptance-page setting at all', async () => {
      await send('purchase_order')
      expect(mockGetOrganizationSetting).not.toHaveBeenCalled()
    })

    it('gets no pay-online link either — a PO has no balance to collect', async () => {
      mockIsPaymentsConnected.mockReturnValue(true)
      const result = await send('purchase_order')
      expect(mockEnsureInvoicePublicToken).not.toHaveBeenCalled()
      expect(result.contentHtml).not.toContain('Pay online')
    })
  })

  // ─── Regression pins: quote and invoice behaviour is byte-identical to the ternaries ───
  describe('quote (unchanged)', () => {
    it('resolves quote_contact and the quote_email snippet', async () => {
      const result = await send('quote')
      expect(mockGetFieldValues).toHaveBeenCalledWith(expect.anything(), [FIELD_IDS.quote_contact])
      expect(mockGetSystemSnippet).toHaveBeenCalledWith(expect.anything(), ORG_ID, 'quote_email')
      expect(result.subject).toBe('subject for quote_email')
    })

    it('roots placeholders at the quote def', async () => {
      await send('quote')
      expect(placeholderRoots().get(ENTITY_DEFS.quote as string)).toBe(
        toRecordId('quote', 'inst_quote')
      )
    })

    it('still appends the view & accept link when the acceptance page is enabled', async () => {
      const result = await send('quote')
      expect(mockEnsureQuotePublicToken).toHaveBeenCalledWith(ORG_ID, 'inst_quote')
      expect(result.contentHtml).toContain('https://view.test/qtok')
      expect(result.contentHtml).toContain('View & accept this quote online')
    })

    it('omits the link when the acceptance page is disabled', async () => {
      mockGetOrganizationSetting.mockResolvedValue(false)
      const result = await send('quote')
      expect(mockEnsureQuotePublicToken).not.toHaveBeenCalled()
      expect(result.contentHtml).not.toContain('view.test')
    })

    it('keeps the exact pre-existing no-contact / no-email copy', async () => {
      documentHasContact = false
      await expect(send('quote')).rejects.toThrow(
        'This quote has no contact — add one before sending'
      )
      documentHasContact = true
      contactEmail = undefined
      await expect(send('quote')).rejects.toThrow(
        'This quote contact has no email address — add one before sending'
      )
    })
  })

  describe('invoice (unchanged)', () => {
    it('resolves invoice_contact and the invoice_email snippet', async () => {
      const result = await send('invoice')
      expect(mockGetFieldValues).toHaveBeenCalledWith(expect.anything(), [
        FIELD_IDS.invoice_contact,
      ])
      expect(mockGetSystemSnippet).toHaveBeenCalledWith(expect.anything(), ORG_ID, 'invoice_email')
      expect(result.subject).toBe('subject for invoice_email')
    })

    it('roots placeholders at the invoice def', async () => {
      await send('invoice')
      expect(placeholderRoots().get(ENTITY_DEFS.invoice as string)).toBe(
        toRecordId('invoice', 'inst_invoice')
      )
    })

    it('still appends the pay-online link when Stripe is connected', async () => {
      mockIsPaymentsConnected.mockReturnValue(true)
      mockEnsureInvoicePublicToken.mockResolvedValue('itok')
      const result = await send('invoice')
      expect(result.contentHtml).toContain('https://pay.test/itok')
      expect(result.contentHtml).toContain('Pay online')
    })

    it('is never minted a QUOTE public token', async () => {
      await send('invoice')
      expect(mockEnsureQuotePublicToken).not.toHaveBeenCalled()
    })

    it('keeps the exact pre-existing no-contact / no-email copy', async () => {
      documentHasContact = false
      await expect(send('invoice')).rejects.toThrow(
        'This invoice has no contact — add one before sending'
      )
      documentHasContact = true
      contactEmail = undefined
      await expect(send('invoice')).rejects.toThrow(
        'This invoice contact has no email address — add one before sending'
      )
    })
  })

  describe('the table itself', () => {
    it('gives every registered document type a profile', () => {
      // A document type registered for printing but never given a send profile fails here
      // rather than at the user.
      for (const descriptor of DOCUMENT_TYPE_DESCRIPTORS) {
        expect(DOCUMENT_EMAIL_PROFILES[descriptor.id]).toBeDefined()
      }
      expect(DOCUMENT_TYPE_DESCRIPTORS.map((d) => d.id)).toContain('purchase_order')
    })

    it('gives every profile its OWN contact field, snippet and placeholder root', async () => {
      const profiles = Object.values(DOCUMENT_EMAIL_PROFILES)
      expect(new Set(profiles.map((p) => p.contactSystemAttribute)).size).toBe(profiles.length)
      // The deposit slip is an internal document whose profile refuses before
      // a snippet is ever read, so it borrows a snippet type rather than
      // seeding one nobody renders (HANDOFF slot 1D).
      const mailable = profiles.filter((p) => p.contactSystemAttribute !== 'bank_deposit_contact')
      expect(new Set(mailable.map((p) => p.snippetSystemType)).size).toBe(mailable.length)
      expect(new Set(profiles.map((p) => p.entityDefsKey)).size).toBe(profiles.length)
      expect(new Set(profiles.map((p) => p.noun)).size).toBe(profiles.length)
    })
  })
})
