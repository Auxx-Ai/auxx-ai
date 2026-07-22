// packages/lib/src/money/quickbooks/__tests__/sync-invoice.test.ts
//
// Unit tests for the invoice-sync orchestrator. Every collaborator (settings, the
// QuickBooks tool-call context, the customer/item upserts, the id-map field reads/writes,
// and the org cache / UnifiedCrudHandler) is mocked at its module boundary — no real Drizzle
// schema/columns are touched (repo memory: drizzle columns are undefined under vitest).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationSetting = vi.fn()
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: (...a: unknown[]) => getOrganizationSetting(...a),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

const upsertQuickbooksCustomer = vi.fn()
vi.mock('../upsert-customer', () => ({
  upsertQuickbooksCustomer: (...a: unknown[]) => upsertQuickbooksCustomer(...a),
}))

const upsertQuickbooksItem = vi.fn()
vi.mock('../upsert-item', () => ({
  upsertQuickbooksItem: (...a: unknown[]) => upsertQuickbooksItem(...a),
}))

const readQuickbooksIdField = vi.fn()
const writeQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: (...a: unknown[]) => writeQuickbooksIdField(...a),
}))

const bySystemAttributes = vi.fn()
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes }) }),
}))

const getFieldValues = vi.fn()
const listFiltered = vi.fn()
vi.mock('../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    constructor(
      public organizationId: string,
      public userId: string
    ) {}
    getFieldValues(...a: unknown[]) {
      return getFieldValues(...a)
    }
    listFiltered(...a: unknown[]) {
      return listFiltered(...a)
    }
  },
}))

import { syncInvoiceToQuickbooks } from '../sync-invoice'

const ORG_ID = 'org1'
const INVOICE_ID = 'inv1'
const CONTACT_ID = 'contact1'
const LINE_ID_1 = 'line1'
const LINE_ID_2 = 'line2'

/** systemAttribute → CustomField.id, mirroring the real registry keys the orchestrator reads. */
const FIELD_IDS: Record<string, string> = {
  invoice_number: 'f-invoice-number',
  invoice_due_date: 'f-invoice-due-date',
  invoice_contact: 'f-invoice-contact',
  first_name: 'f-first-name',
  last_name: 'f-last-name',
  primary_email: 'f-primary-email',
  line_item_line_total: 'f-line-total',
  line_item_qty: 'f-line-qty',
  line_item_name: 'f-line-name',
  line_item_catalog_item: 'f-line-catalog-item',
}

const CTX = {
  organizationId: ORG_ID,
  installationId: 'install1',
  connectionId: 'conn1',
  userId: 'user1',
  callTool: vi.fn(),
}

function textValue(value: string) {
  return { type: 'text', value }
}
function dateValue(value: string) {
  return { type: 'date', value }
}
function numberValue(value: number) {
  return { type: 'number', value }
}
function relationshipValue(recordId: string) {
  return { type: 'relationship', recordId }
}

/** Default single-line invoice fixture: one $120 line, no catalog item. */
function setupSingleLineFixture() {
  listFiltered.mockResolvedValue({ ids: [LINE_ID_1], total: 1, hasMore: false, snapshotId: '' })

  getFieldValues.mockImplementation(async (recordId: string) => {
    if (recordId === `invoice:${INVOICE_ID}`) {
      return new Map<string, unknown>([
        [FIELD_IDS.invoice_number!, textValue('INV-001')],
        [FIELD_IDS.invoice_due_date!, dateValue('2026-08-01')],
        [FIELD_IDS.invoice_contact!, relationshipValue(`contact:${CONTACT_ID}`)],
      ])
    }
    if (recordId === `contact:${CONTACT_ID}`) {
      return new Map([
        [FIELD_IDS.first_name!, textValue('Jane')],
        [FIELD_IDS.last_name!, textValue('Doe')],
        [FIELD_IDS.primary_email!, textValue('jane@example.com')],
      ])
    }
    if (recordId === `line_item:${LINE_ID_1}`) {
      return new Map<string, unknown>([
        [FIELD_IDS.line_item_line_total!, numberValue(12000)],
        [FIELD_IDS.line_item_qty!, numberValue(2)],
        [FIELD_IDS.line_item_name!, textValue('Service Call')],
      ])
    }
    return new Map()
  })
}

beforeEach(() => {
  getOrganizationSetting.mockReset()
  getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) => {
    if (key === 'quickbooks.syncInvoices') return true
    if (key === 'quickbooks.defaultIncomeAccountId') return 'acct-1'
    return null
  })

  resolveQuickbooksContext.mockReset()
  resolveQuickbooksContext.mockResolvedValue({ connected: true, context: CTX })

  upsertQuickbooksCustomer.mockReset()
  upsertQuickbooksCustomer.mockResolvedValue('qbo-cust-1')

  upsertQuickbooksItem.mockReset()
  upsertQuickbooksItem.mockResolvedValue('qbo-item-1')

  readQuickbooksIdField.mockReset()
  readQuickbooksIdField.mockResolvedValue(undefined)

  writeQuickbooksIdField.mockReset()
  writeQuickbooksIdField.mockResolvedValue(undefined)

  bySystemAttributes.mockReset()
  bySystemAttributes.mockImplementation(async (attrs: string[]) => {
    const map: Record<string, { id: string } | null> = {}
    for (const attr of attrs) map[attr] = FIELD_IDS[attr] ? { id: FIELD_IDS[attr] } : null
    return map
  })

  getFieldValues.mockReset()
  listFiltered.mockReset()
  CTX.callTool.mockReset()
})

describe('syncInvoiceToQuickbooks', () => {
  it('returns disabled when the org setting is off', async () => {
    getOrganizationSetting.mockImplementation(async ({ key }: { key: string }) =>
      key === 'quickbooks.syncInvoices' ? false : null
    )

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result).toEqual({ status: 'disabled' })
    expect(resolveQuickbooksContext).not.toHaveBeenCalled()
  })

  it('returns not_connected when the app has no usable connection', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result).toEqual({ status: 'not_connected' })
  })

  it('creates a fresh invoice — upserts the customer + item, creates, writes ids back', async () => {
    setupSingleLineFixture()
    CTX.callTool.mockImplementation(async (toolId: string) => {
      if (toolId === 'create_quickbooks_invoice') {
        return { invoiceId: 'qbo-inv-1', docNumber: 'INV-001', totalAmt: 120, balance: 120 }
      }
      throw new Error(`unexpected tool call: ${toolId}`)
    })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
      actorUserId: 'actor1',
    })

    expect(result).toEqual({ status: 'synced', qboInvoiceId: 'qbo-inv-1' })

    expect(upsertQuickbooksCustomer).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({
        contactInstanceId: CONTACT_ID,
        contactFields: { firstName: 'Jane', lastName: 'Doe', primaryEmail: 'jane@example.com' },
      })
    )
    expect(upsertQuickbooksItem).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ itemName: 'Service Call', defaultIncomeAccountId: 'acct-1' })
    )

    expect(CTX.callTool).toHaveBeenCalledWith(
      'create_quickbooks_invoice',
      expect.objectContaining({
        customerId: 'qbo-cust-1',
        lines: [{ itemId: 'qbo-item-1', amount: 120, quantity: 2, description: 'Service Call' }],
        docNumber: 'INV-001',
        dueDate: '2026-08-01',
        billEmail: 'jane@example.com',
      })
    )
    expect(CTX.callTool).not.toHaveBeenCalledWith('update_quickbooks_invoice', expect.anything())

    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({
        appFieldKey: 'qboInvoiceId',
        entityType: 'invoice',
        entityInstanceId: INVOICE_ID,
        externalId: 'qbo-inv-1',
      })
    )
  })

  it('normalises a timestamptz due date to a bare YYYY-MM-DD for QBO', async () => {
    // Auxx DATE fields extract as a full timestamp; QBO rejects anything but YYYY-MM-DD.
    setupSingleLineFixture()
    getFieldValues.mockImplementation(async (recordId: string) => {
      if (recordId === `invoice:${INVOICE_ID}`) {
        return new Map<string, unknown>([
          [FIELD_IDS.invoice_number!, textValue('INV-003')],
          [FIELD_IDS.invoice_due_date!, dateValue('2026-08-10 00:00:00+00')],
          [FIELD_IDS.invoice_contact!, relationshipValue(`contact:${CONTACT_ID}`)],
        ])
      }
      if (recordId === `contact:${CONTACT_ID}`) {
        return new Map([[FIELD_IDS.primary_email!, textValue('jane@example.com')]])
      }
      if (recordId === `line_item:${LINE_ID_1}`) {
        return new Map<string, unknown>([
          [FIELD_IDS.line_item_line_total!, numberValue(12000)],
          [FIELD_IDS.line_item_qty!, numberValue(1)],
          [FIELD_IDS.line_item_name!, textValue('Service Call')],
        ])
      }
      return new Map()
    })
    CTX.callTool.mockResolvedValue({ invoiceId: 'qbo-inv-3' })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result.status).toBe('synced')
    expect(CTX.callTool).toHaveBeenCalledWith(
      'create_quickbooks_invoice',
      expect.objectContaining({ dueDate: '2026-08-10' })
    )
  })

  it('re-syncs an already-synced invoice via update, never calling create (no duplicate)', async () => {
    setupSingleLineFixture()
    readQuickbooksIdField.mockResolvedValue('qbo-inv-existing')
    CTX.callTool.mockImplementation(async (toolId: string) => {
      if (toolId === 'update_quickbooks_invoice') {
        return { invoiceId: 'qbo-inv-existing', docNumber: 'INV-001', totalAmt: 120, balance: 120 }
      }
      throw new Error(`unexpected tool call: ${toolId}`)
    })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result).toEqual({ status: 'synced', qboInvoiceId: 'qbo-inv-existing' })
    expect(CTX.callTool).toHaveBeenCalledWith(
      'update_quickbooks_invoice',
      expect.objectContaining({ invoiceId: 'qbo-inv-existing' })
    )
    expect(CTX.callTool).not.toHaveBeenCalledWith('create_quickbooks_invoice', expect.anything())
  })

  it('skips $0 lines entirely — they never reach the item upsert or the QBO payload', async () => {
    listFiltered.mockResolvedValue({
      ids: [LINE_ID_1, LINE_ID_2],
      total: 2,
      hasMore: false,
      snapshotId: '',
    })
    getFieldValues.mockImplementation(async (recordId: string) => {
      if (recordId === `invoice:${INVOICE_ID}`) {
        return new Map<string, unknown>([
          [FIELD_IDS.invoice_number!, textValue('INV-002')],
          [FIELD_IDS.invoice_contact!, relationshipValue(`contact:${CONTACT_ID}`)],
        ])
      }
      if (recordId === `contact:${CONTACT_ID}`) {
        return new Map([[FIELD_IDS.primary_email!, textValue('jane@example.com')]])
      }
      if (recordId === `line_item:${LINE_ID_1}`) {
        // Zero-dollar line (e.g. a chemical-usage record) — must be skipped.
        return new Map([[FIELD_IDS.line_item_line_total!, numberValue(0)]])
      }
      if (recordId === `line_item:${LINE_ID_2}`) {
        return new Map<string, unknown>([
          [FIELD_IDS.line_item_line_total!, numberValue(5000)],
          [FIELD_IDS.line_item_qty!, numberValue(1)],
          [FIELD_IDS.line_item_name!, textValue('Billable Line')],
        ])
      }
      return new Map()
    })
    CTX.callTool.mockResolvedValue({ invoiceId: 'qbo-inv-2' })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result.status).toBe('synced')
    expect(upsertQuickbooksItem).toHaveBeenCalledTimes(1)
    expect(upsertQuickbooksItem).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ itemName: 'Billable Line' })
    )
    expect(CTX.callTool).toHaveBeenCalledWith(
      'create_quickbooks_invoice',
      expect.objectContaining({
        lines: [{ itemId: 'qbo-item-1', amount: 50, quantity: 1, description: 'Billable Line' }],
      })
    )
  })

  it('resolves to status: error (never throws) when a downstream step fails', async () => {
    setupSingleLineFixture()
    upsertQuickbooksItem.mockRejectedValue(
      new Error('Cannot create a QuickBooks item — set a default income account first.')
    )

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/default income account/)
    expect(CTX.callTool).not.toHaveBeenCalledWith('create_quickbooks_invoice', expect.anything())
  })

  it('errors when the invoice has no contact', async () => {
    listFiltered.mockResolvedValue({ ids: [], total: 0, hasMore: false, snapshotId: '' })
    getFieldValues.mockImplementation(async (recordId: string) => {
      if (recordId === `invoice:${INVOICE_ID}`) return new Map()
      return new Map()
    })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no contact/)
  })

  it('errors when every line is $0 (no billable lines to sync)', async () => {
    listFiltered.mockResolvedValue({ ids: [LINE_ID_1], total: 1, hasMore: false, snapshotId: '' })
    getFieldValues.mockImplementation(async (recordId: string) => {
      if (recordId === `invoice:${INVOICE_ID}`) {
        return new Map([[FIELD_IDS.invoice_contact!, relationshipValue(`contact:${CONTACT_ID}`)]])
      }
      if (recordId === `contact:${CONTACT_ID}`) return new Map()
      if (recordId === `line_item:${LINE_ID_1}`) {
        return new Map([[FIELD_IDS.line_item_line_total!, numberValue(0)]])
      }
      return new Map()
    })

    const result = await syncInvoiceToQuickbooks({
      organizationId: ORG_ID,
      invoiceInstanceId: INVOICE_ID,
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no billable lines/)
  })
})
