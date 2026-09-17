// packages/lib/src/data-migrations/migrations/167-document-attachments.test.ts

import { SYSTEM_ATTRIBUTES } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { BANK_DEPOSIT_FIELDS } from '../../resources/registry/resources/bank-deposit-fields'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { INVOICE_FIELDS } from '../../resources/registry/resources/invoice-fields'
import { PURCHASE_ORDER_FIELDS } from '../../resources/registry/resources/purchase-order-fields'
import { QUOTE_FIELDS } from '../../resources/registry/resources/quote-fields'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'

/** The four defs migration 167 widens, plus the two that already carried the field. */
const ALL = {
  quote: [QUOTE_FIELDS, 'quote_attachments'],
  invoice: [INVOICE_FIELDS, 'invoice_attachments'],
  credit_memo: [CREDIT_MEMO_FIELDS, 'credit_memo_attachments'],
  bank_deposit: [BANK_DEPOSIT_FIELDS, 'bank_deposit_attachments'],
  purchase_order: [PURCHASE_ORDER_FIELDS, 'purchase_order_attachments'],
  vendor_bill: [VENDOR_BILL_FIELDS, 'vendor_bill_attachments'],
} as const

describe('migration 167 — the attachments field on every document def', () => {
  it('declares the field on all six defs, on the attribute the migration provisions', () => {
    for (const [entityType, [fields, attr]] of Object.entries(ALL)) {
      expect(fields.attachments, entityType).toBeDefined()
      expect(fields.attachments?.systemAttribute, entityType).toBe(attr)
      expect(SYSTEM_ATTRIBUTES, entityType).toContain(attr)
    }
  })

  it('keeps every one of them a multi-file FILE taking documents and images', () => {
    for (const [entityType, [fields]] of Object.entries(ALL)) {
      const file = fields.attachments?.options?.file
      expect(fields.attachments?.fieldType, entityType).toBe('FILE')
      expect(file?.allowMultiple, entityType).toBe(true)
      expect(file?.allowedFileTypes, entityType).toEqual(['document', 'image'])
      expect(fields.attachments?.nullable, entityType).toBe(true)
    }
  })

  it('hides them from the panel, the table, the dialogs and the field list', () => {
    // The documents card is the only door — it reads the field by systemAttribute,
    // which `hidden` does not gate (the `*_pdf_asset` pointers are hidden too).
    for (const [entityType, [fields]] of Object.entries(ALL)) {
      expect(fields.attachments?.showInPanel, entityType).toBe(false)
      expect(fields.attachments?.showInTable, entityType).toBe(false)
      expect(fields.attachments?.showInDialogs, entityType).toBe(false)
      expect(fields.attachments?.capabilities?.hidden, entityType).toBe(true)
    }
  })

  it('keeps them user-writable — unlike the generated PDF pointer beside them', () => {
    // The uploads slot is the half a person adds to; `configurable: false` only
    // keeps an admin from reshaping a system field.
    for (const [entityType, [fields]] of Object.entries(ALL)) {
      expect(fields.attachments?.capabilities?.creatable, entityType).toBe(true)
      expect(fields.attachments?.capabilities?.updatable, entityType).toBe(true)
      expect(fields.attachments?.capabilities?.configurable, entityType).toBe(false)
    }
  })

  it('gives each one a sortOrder that collides with nothing else on its def', () => {
    // Scoped to the attachments field rather than asserting the whole def is
    // collision-free: `invoice` carries a PRE-EXISTING duplicate 'aK' on
    // `pdfAsset` and `payments` that predates this migration and is not its to fix.
    for (const [entityType, [fields]] of Object.entries(ALL)) {
      const mine = fields.attachments?.systemSortOrder
      expect(mine, entityType).toBeTypeOf('string')
      const others = Object.entries(fields)
        .filter(([key]) => key !== 'attachments')
        .map(([, f]) => f.systemSortOrder)
      expect(others, entityType).not.toContain(mine)
    }
  })
})
