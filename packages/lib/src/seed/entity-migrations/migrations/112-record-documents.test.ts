// packages/lib/src/seed/entity-migrations/migrations/112-record-documents.test.ts

import { FieldType } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { PURCHASE_ORDER_FIELDS } from '../../../resources/registry/resources/purchase-order-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { VENDOR_BILL_FIELDS } from '../../../resources/registry/resources/vendor-bill-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration112RecordDocuments } from './112-record-documents'

describe('migration 112 registration', () => {
  it('is registered exactly once, with a unique id, after 108', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '112-record-documents')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    // 🛑 Ordering is not cosmetic: 112 converts four fields that 108 CREATES, and
    // `ensureCustomFields` is INSERT-only, so running it before 108 would find
    // nothing to convert and silently do half the job.
    expect(ids.indexOf('112-record-documents')).toBeGreaterThan(ids.indexOf('108-purchasing'))
    expect(migration112RecordDocuments.id).toBe('112-record-documents')
  })

  // The "is last" guard moved to `114-retire-gl-posting-defs.test.ts` when 114
  // was appended. It belongs to whatever migration is actually last — that is
  // the whole point of it.
})

describe('the four fields it converts are FILE in the registry', () => {
  // If any of these is still TEXT, the migration writes `type = 'TEXT'` over a
  // row that is already TEXT and the conversion silently never happens.
  const CONVERTED = [
    ['quote.pdfAsset', QUOTE_FIELDS.pdfAsset],
    ['invoice.pdfAsset', INVOICE_FIELDS.pdfAsset],
    ['purchase_order.pdfAsset', PURCHASE_ORDER_FIELDS.pdfAsset],
    ['vendor_bill.document', VENDOR_BILL_FIELDS.document],
  ] as const

  it.each(CONVERTED)('%s is a single FILE field', (_name, field) => {
    expect(field).toBeDefined()
    expect(field?.fieldType).toBe(FieldType.FILE)
    expect(field?.options?.file?.allowMultiple).toBe(false)
    expect(field?.options?.file?.maxFiles).toBe(1)
    // Out of the Details panel — the documents card is the only surface.
    expect(field?.showInPanel).toBe(false)
  })

  // 🛑 The whole safety argument of P20. `ensureDocumentPdf` appends a new
  // VERSION to whatever asset the pointer names when the content hash disagrees,
  // and a human upload has no hash at all — so a writable slot means the next
  // send republishes a person's file as our PDF. `updatable: false` is read by
  // the grid cell, the panel, the dialogs and connector writability, and NOT by
  // the field-value write path, so it locks the human doors and leaves the
  // renderer alone.
  it.each([
    ['quote', QUOTE_FIELDS.pdfAsset],
    ['invoice', INVOICE_FIELDS.pdfAsset],
    ['purchase_order', PURCHASE_ORDER_FIELDS.pdfAsset],
  ] as const)('%s.pdfAsset is machine-owned: not creatable, not updatable', (_name, field) => {
    expect(field?.capabilities?.creatable).toBe(false)
    expect(field?.capabilities?.updatable).toBe(false)
    expect(field?.capabilities?.hidden).toBe(true)
  })

  // The bill's own document is the opposite case: a person uploads it, and
  // nothing ever renders INTO it, so the trap above does not apply.
  it('vendor_bill.document stays user-writable', () => {
    expect(VENDOR_BILL_FIELDS.document?.capabilities?.creatable).toBe(true)
    expect(VENDOR_BILL_FIELDS.document?.capabilities?.updatable).toBe(true)
    // A phone photo of paper is the common case, not the exception.
    expect(VENDOR_BILL_FIELDS.document?.options?.file?.allowedFileTypes).toContain('image')
    expect(VENDOR_BILL_FIELDS.document?.options?.file?.allowedFileTypes).toContain('document')
  })
})

describe('the two fields it creates', () => {
  it.each([
    ['purchase_order', PURCHASE_ORDER_FIELDS.attachments, 'purchase_order_attachments'],
    ['vendor_bill', VENDOR_BILL_FIELDS.attachments, 'vendor_bill_attachments'],
  ] as const)('%s.attachments is a multi FILE field', (_name, field, attribute) => {
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe(attribute)
    expect(field?.fieldType).toBe(FieldType.FILE)
    expect(field?.options?.file?.allowMultiple).toBe(true)
    expect(field?.options?.file?.allowedFileTypes).toEqual(['document', 'image'])
    expect(field?.showInPanel).toBe(false)
    expect(field?.capabilities?.creatable).toBe(true)
    expect(field?.capabilities?.updatable).toBe(true)
  })

  // P18: the single slot and the multi list are different fields on purpose. A
  // phase-2 parser has to know which file is the bill, and "the first one in the
  // array" is a convention that survives exactly until somebody reorders.
  it('the bill keeps `document` and `attachments` as separate fields', () => {
    expect(VENDOR_BILL_FIELDS.document?.systemAttribute).toBe('vendor_bill_document')
    expect(VENDOR_BILL_FIELDS.attachments?.systemAttribute).toBe('vendor_bill_attachments')
    expect(VENDOR_BILL_FIELDS.document?.options?.file?.allowMultiple).toBe(false)
    expect(VENDOR_BILL_FIELDS.attachments?.options?.file?.allowMultiple).toBe(true)
  })
})
