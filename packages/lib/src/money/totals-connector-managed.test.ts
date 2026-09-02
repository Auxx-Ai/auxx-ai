// packages/lib/src/money/totals-connector-managed.test.ts
//
// The totals stand-down (plans/money/tasks/37-shopify-native-retarget.md §6): a synced
// order's totals are TRANSCRIBED from the connector, not computed, so both cores the
// finalize integrity passes and the inline hooks share — `recomputeDocumentTotals` (via
// `recomputeTotals`) and `recomputeLineTotal` — must stand down when the record they are
// about to write is connector-managed. What matters here: the write is skipped (not just a
// warning), the check costs ONE call per record (not one per mirror field), and an
// unmanaged record is completely unaffected — plus the new `order_shipping_total` header
// input actually reaches `order_total`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  /** `select()` with no projection — the LINE VALUE read in `totals-hooks`. */
  fieldValueRows: vi.fn(),
  /** `select({...})` from `DataConnectorItem` — `isFieldConnectorManaged`'s own read. */
  managedFieldsRows: vi.fn(),
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
    listFiltered = h.listFiltered
  },
}))
vi.mock('../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('./payments/ledger', () => ({ syncInvoicePaymentState: vi.fn() }))
// Real schema (so `eq`/`isNull` get real columns, and `table === schema.DataConnectorItem`
// identity-matches inside `managed-fields.ts`), stubbed connection.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            table === schema.DataConnectorItem ? h.managedFieldsRows() : h.fieldValueRows(),
        }),
      }),
    },
  }
})

import { recomputeLineTotal, recomputeTotals } from './totals-hooks'

const FIELDS: Record<string, { id: string; type: string }> = {
  order_discount_type: { id: 'f-o-dtype', type: 'SINGLE_SELECT' },
  order_discount_value: { id: 'f-o-dvalue', type: 'CURRENCY' },
  order_tax_rate: { id: 'f-o-rate', type: 'NUMBER' },
  order_shipping_total: { id: 'f-o-shipping', type: 'CURRENCY' },
  order_subtotal: { id: 'f-o-subtotal', type: 'CURRENCY' },
  order_tax_total: { id: 'f-o-taxtotal', type: 'CURRENCY' },
  order_total: { id: 'f-o-total', type: 'CURRENCY' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_qty: { id: 'f-li-qty', type: 'NUMBER' },
  line_item_unit_price: { id: 'f-li-price', type: 'CURRENCY' },
}

function row(
  entityId: string,
  fieldId: string,
  value: number
): { entityId: string } & Record<string, unknown> {
  return { entityId, fieldId, valueNumber: value }
}

function writtenValues(): Array<{ fieldId: string; value: number }> {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string; value: number }> }
    | undefined
  return call?.values ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.listFiltered.mockResolvedValue({ ids: [] })
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.managedFieldsRows.mockResolvedValue([])
})

describe('the document-level stand-down', () => {
  it('writes nothing for an order whose total is connector-managed', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10_000)])
    h.managedFieldsRows.mockResolvedValue([{ managedFields: ['order_total'] }])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'order',
      documentInstanceId: 'ord-1',
    })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('writes normally when the order is not connector-managed', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10_000)])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'order',
      documentInstanceId: 'ord-1',
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    expect(writtenValues().find((v) => v.fieldId === 'order_total')?.value).toBe(10_000)
  })

  it('checks connector-managed status ONCE per record, not once per mirror field', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10_000)])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'order',
      documentInstanceId: 'ord-1',
    })

    // Three mirrors are candidates for this document (subtotal, tax_total, total) — the
    // stand-down must cost one lookup, not three.
    expect(h.managedFieldsRows).toHaveBeenCalledTimes(1)
  })

  it('folds order_shipping_total into order_total as a header input (money plan 37 §6)', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10_000)])
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([['f-o-shipping', { type: 'number', value: 500 }]])
    )

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'order',
      documentInstanceId: 'ord-1',
    })

    expect(writtenValues().find((v) => v.fieldId === 'order_total')?.value).toBe(10_500)
  })
})

describe('the line-level stand-down', () => {
  it('leaves line_item_line_total untouched when the line itself is connector-managed', async () => {
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-li-qty', { type: 'number', value: 3 }],
        ['f-li-price', { type: 'number', value: 500 }],
      ])
    )
    h.managedFieldsRows.mockResolvedValue([{ managedFields: ['line_item_line_total'] }])

    await recomputeLineTotal({ organizationId: 'org_1', userId: 'usr_1', lineInstanceId: 'li-1' })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('recomputes line_item_line_total normally when the line is not connector-managed', async () => {
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-li-qty', { type: 'number', value: 3 }],
        ['f-li-price', { type: 'number', value: 500 }],
      ])
    )

    await recomputeLineTotal({ organizationId: 'org_1', userId: 'usr_1', lineInstanceId: 'li-1' })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    expect(writtenValues()[0]?.value).toBe(1500)
  })
})
