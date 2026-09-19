// packages/lib/src/field-hooks/pre/__tests__/invoice-lock.test.ts
//
// 74 §1.3's lock, the bill's one family over. Three rules:
//
//  1. An issued invoice with no edit-snapshot row refuses a header write, a line
//     write, a line create and a line delete.
//  2. The row LIFTS it — every one of those goes through untouched.
//  3. It never fires on a draft, and never on a `line_item` whose parent is a
//     quote, an order or a work order rather than an invoice.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreCreateEvent, EntityPreDeleteEvent, FieldPreHookEvent } from '../../types'

const h = vi.hoisted(() => ({
  fields: {} as Record<string, { id: string } | undefined>,
  invoiceRows: [] as Array<{ fieldId: string; optionId: string | null; valueText: string | null }>,
  lineParentRows: [] as Array<{ relatedEntityId: string | null }>,
  editStamp: null as { openedAt: string; byUserId: string } | null,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => h.fields }),
  }),
}))
vi.mock('../../../entity-instances/edit-snapshot', () => ({
  readEditStamp: async () => h.editStamp,
}))

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () =>
    Object.assign(Promise.resolve(h.invoiceRows), { limit: async () => h.lineParentRows })
  return { ...actual, database: { select: () => chain } }
})

import { ConflictError } from '../../../errors'
import {
  guardIssuedInvoiceFields,
  guardIssuedInvoiceLineCreate,
  guardIssuedInvoiceLineDelete,
  guardIssuedInvoiceLineFields,
} from '../invoice-lock'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const INVOICE_DEF = 'v5hzr4xbn1fhznih3u74gtza'
const INVOICE_ID = '1nv0000000000000000000001'
const LINE_DEF = 'l1nedef00000000000000001'
const LINE_ID = 'l1ne00000000000000000001'

const STATUS_FIELD = 'f_status'
const NUMBER_FIELD = 'f_number'
const PARENT_FIELD = 'f_parent'

function fieldEvent(recordId: string, systemAttribute: string, value: unknown): FieldPreHookEvent {
  return {
    recordId: recordId as FieldPreHookEvent['recordId'],
    entityDefinitionId: recordId.split(':')[0]!,
    entityType: null,
    entitySlug: 'invoices',
    fieldId: 'f_whatever',
    systemAttribute: systemAttribute as FieldPreHookEvent['systemAttribute'],
    field: {} as FieldPreHookEvent['field'],
    newValue: value as FieldPreHookEvent['newValue'],
    existingValue: undefined,
    allValues: new Map(),
    organizationId: ORG,
    bypass: new Set(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fields = {
    invoice_status: { id: STATUS_FIELD },
    invoice_number: { id: NUMBER_FIELD },
    line_item_invoice: { id: PARENT_FIELD },
  }
  h.invoiceRows = [
    { fieldId: STATUS_FIELD, optionId: 'sent', valueText: null },
    { fieldId: NUMBER_FIELD, optionId: null, valueText: 'INV-0007' },
  ]
  h.lineParentRows = [{ relatedEntityId: INVOICE_ID }]
  h.editStamp = null
})

describe('the header lock', () => {
  it('refuses a discount write on an issued invoice, naming it', async () => {
    await expect(
      guardIssuedInvoiceFields(
        fieldEvent(`${INVOICE_DEF}:${INVOICE_ID}`, 'invoice_discount_value', {
          type: 'number',
          value: 10,
        })
      )
    ).rejects.toThrow(/INV-0007/)
  })

  it('lifts once the invoice is open for editing', async () => {
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    const value = { type: 'number', value: 10 }
    await expect(
      guardIssuedInvoiceFields(
        fieldEvent(`${INVOICE_DEF}:${INVOICE_ID}`, 'invoice_discount_value', value)
      )
    ).resolves.toEqual(value)
  })

  it('stays shut on a written-off invoice even with a row, because none can exist', async () => {
    h.invoiceRows = [{ fieldId: STATUS_FIELD, optionId: 'written_off', valueText: null }]
    await expect(
      guardIssuedInvoiceFields(
        fieldEvent(`${INVOICE_DEF}:${INVOICE_ID}`, 'invoice_tax_rate', { type: 'number', value: 5 })
      )
    ).rejects.toThrow(ConflictError)
  })

  it('does nothing on a draft invoice', async () => {
    h.invoiceRows = [{ fieldId: STATUS_FIELD, optionId: 'draft', valueText: null }]
    const value = { type: 'number', value: 5 }
    await expect(
      guardIssuedInvoiceFields(
        fieldEvent(`${INVOICE_DEF}:${INVOICE_ID}`, 'invoice_tax_rate', value)
      )
    ).resolves.toEqual(value)
  })
})

describe('the line lock', () => {
  it('refuses a quantity write on an issued invoice’s line', async () => {
    await expect(
      guardIssuedInvoiceLineFields(
        fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'line_item_qty', { type: 'number', value: 4 })
      )
    ).rejects.toThrow(ConflictError)
  })

  it('lifts with the row', async () => {
    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    const value = { type: 'number', value: 4 }
    await expect(
      guardIssuedInvoiceLineFields(fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'line_item_qty', value))
    ).resolves.toEqual(value)
  })

  it('lets a quote or order line through — it belongs to no invoice', async () => {
    h.lineParentRows = []
    const value = { type: 'number', value: 4 }
    await expect(
      guardIssuedInvoiceLineFields(fieldEvent(`${LINE_DEF}:${LINE_ID}`, 'line_item_qty', value))
    ).resolves.toEqual(value)
  })

  it('refuses a new line on an issued invoice', async () => {
    const event: EntityPreCreateEvent = {
      entityDefinitionId: LINE_DEF,
      entityType: 'line_item',
      entitySlug: 'line-items',
      values: { line_item_invoice: `${INVOICE_DEF}:${INVOICE_ID}` },
      organizationId: ORG,
      userId: 'u1',
    }
    await expect(guardIssuedInvoiceLineCreate(event)).rejects.toThrow(/add a line/)
  })

  it('refuses a line delete on an issued invoice, and allows it once open', async () => {
    const event: EntityPreDeleteEvent = {
      recordId: `${LINE_DEF}:${LINE_ID}` as EntityPreDeleteEvent['recordId'],
      entityDefinitionId: LINE_DEF,
      entityType: 'line_item',
      entitySlug: 'line-items',
      // The capture chain arrays every relationship, even a to-one.
      values: { line_item_invoice: [`${INVOICE_DEF}:${INVOICE_ID}`] },
      organizationId: ORG,
      userId: 'u1',
      bypass: new Set(),
    }
    await expect(guardIssuedInvoiceLineDelete(event)).rejects.toThrow(/remove a line/)

    h.editStamp = { openedAt: '2026-09-18T00:00:00.000Z', byUserId: 'u1' }
    await expect(guardIssuedInvoiceLineDelete(event)).resolves.toBeUndefined()
  })
})
