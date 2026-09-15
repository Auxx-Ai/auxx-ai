// packages/lib/src/money/totals-header-discount.test.ts
//
// A native order's header discount lands ON THE LINES, in `line_item_net_total`
// (plans/accounting/tasks/29-clearing-at-the-payment-date.md §12 item 7, §2.3).
// Before this, `order_discount_type` / `order_discount_value` reduced `order_total`
// while every line stayed at `qty x unitPrice`, so Σ lines exceeded the subtotal and
// the fulfillment entry - which recognises revenue from the lines - booked the
// discount as revenue. `line_item_line_total` stays GROSS on every document (MK,
// 2026-09-14: a customer expects the line to match what Shopify shows), and the
// allocated net goes to the new column. What these pin: the net line writes and the
// header mirrors are ONE consistent set, the gross column is never rewritten by the
// document recompute, a quote or invoice never writes the net at all, a
// connector-managed order is not touched, a removed discount sets the net back to
// the gross, an org without the net field still gets its header mirrors, and nothing
// here re-enters the line hook.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  /** `select()` with no projection - the LINE VALUE read in `totals-hooks`. */
  fieldValueRows: vi.fn(),
  /** `select({...})` from `DataConnectorItem` - `isFieldConnectorManaged`'s own read. */
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

import { LINE_TRIGGER_ATTRS, recomputeTotals } from './totals-hooks'

const FIELDS: Record<string, { id: string; type: string }> = {
  order_discount_type: { id: 'f-o-dtype', type: 'SINGLE_SELECT' },
  order_discount_value: { id: 'f-o-dvalue', type: 'CURRENCY' },
  order_tax_rate: { id: 'f-o-rate', type: 'NUMBER' },
  order_shipping_total: { id: 'f-o-shipping', type: 'CURRENCY' },
  order_subtotal: { id: 'f-o-subtotal', type: 'CURRENCY' },
  order_tax_total: { id: 'f-o-taxtotal', type: 'CURRENCY' },
  order_total: { id: 'f-o-total', type: 'CURRENCY' },
  quote_discount_type: { id: 'f-q-dtype', type: 'SINGLE_SELECT' },
  quote_discount_value: { id: 'f-q-dvalue', type: 'CURRENCY' },
  quote_tax_rate: { id: 'f-q-rate', type: 'NUMBER' },
  quote_subtotal: { id: 'f-q-subtotal', type: 'CURRENCY' },
  quote_tax_total: { id: 'f-q-taxtotal', type: 'CURRENCY' },
  quote_total: { id: 'f-q-total', type: 'CURRENCY' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_net_total: { id: 'f-li-net', type: 'CURRENCY' },
  line_item_qty: { id: 'f-li-qty', type: 'NUMBER' },
  line_item_unit_price: { id: 'f-li-price', type: 'CURRENCY' },
}

function row(entityId: string, fieldId: string, value: number) {
  return { entityId, fieldId, valueNumber: value }
}

/**
 * Two lines with GROSS totals of 100.00 and 50.00 (the line hook's `qty x unitPrice`
 * write), and whatever NET is stored on them - null for a line never recomputed
 * since the column existed.
 */
function twoLines(net: { first: number | null; second: number | null }) {
  return [
    row('li-1', 'f-li-qty', 2),
    row('li-1', 'f-li-price', 5_000),
    row('li-1', 'f-li-total', 10_000),
    ...(net.first === null ? [] : [row('li-1', 'f-li-net', net.first)]),
    row('li-2', 'f-li-qty', 1),
    row('li-2', 'f-li-price', 5_000),
    row('li-2', 'f-li-total', 5_000),
    ...(net.second === null ? [] : [row('li-2', 'f-li-net', net.second)]),
  ]
}

function header(values: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(values))
}

const percent = (value: number) => ({
  'f-o-dtype': { type: 'option', optionId: 'percent' },
  'f-o-dvalue': { type: 'number', value },
})
const amount = (value: number) => ({
  'f-o-dtype': { type: 'option', optionId: 'amount' },
  'f-o-dvalue': { type: 'number', value },
})

type Write = { recordId: string; values: Array<{ fieldId: string; value: number | null }> }
const writes = (): Write[] => h.setValuesForEntity.mock.calls.map((call) => call[0] as Write)
const lineWrites = () => writes().filter((w) => w.recordId.startsWith('line_item:'))
const headerWrite = () => writes().find((w) => !w.recordId.startsWith('line_item:'))
const written = (fieldId: string) => headerWrite()?.values.find((v) => v.fieldId === fieldId)?.value

const order = {
  organizationId: 'org_1',
  userId: 'usr_1',
  documentType: 'order' as const,
  documentInstanceId: 'ord-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.listFiltered.mockResolvedValue({ ids: ['li-1', 'li-2'] })
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.managedFieldsRows.mockResolvedValue([])
})

describe('a native order with a header discount', () => {
  it('10% off 100 and 50 writes NETS of 90 and 45, subtotal 135 and total 135', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(header(percent(10)))

    await recomputeTotals(order)

    expect(lineWrites()).toEqual([
      {
        recordId: 'line_item:li-1',
        values: [{ fieldId: 'line_item_net_total', value: 9_000 }],
        publishEvents: true,
      },
      {
        recordId: 'line_item:li-2',
        values: [{ fieldId: 'line_item_net_total', value: 4_500 }],
        publishEvents: true,
      },
    ])
    expect(written('order_subtotal')).toBe(13_500)
    expect(written('order_total')).toBe(13_500)
    // Σ line nets IS the subtotal - the property the fulfillment entry needs.
    expect(lineWrites().reduce((sum, w) => sum + (w.values[0]?.value ?? 0), 0)).toBe(13_500)
  })

  it("never writes line_item_line_total from the document recompute: the gross column is the line hook's", async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(header(percent(10)))

    await recomputeTotals(order)

    const fieldIds = writes().flatMap((w) => w.values.map((v) => v.fieldId))
    expect(fieldIds).not.toContain('line_item_line_total')
    expect(fieldIds.filter((id) => id === 'line_item_net_total')).toHaveLength(2)
  })

  it('7.00 off writes 95.33 and 47.67 (largest remainder, odd cent to the first line) and subtotal 143', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(header(amount(700)))

    await recomputeTotals(order)

    expect(lineWrites().map((w) => w.values[0]?.value)).toEqual([9_533, 4_767])
    expect(written('order_subtotal')).toBe(14_300)
    expect(written('order_total')).toBe(14_300)
  })

  it('taxes the NET lines and adds shipping on top: total = subtotal + tax + shipping', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(
      header({
        ...percent(10),
        'f-o-rate': { type: 'number', value: 10 },
        'f-o-shipping': { type: 'number', value: 500 },
      })
    )

    await recomputeTotals(order)

    expect(written('order_subtotal')).toBe(13_500)
    expect(written('order_tax_total')).toBe(1_350)
    expect(written('order_total')).toBe(13_500 + 1_350 + 500)
  })

  it('rewrites only the line whose stored net is not its allocated net', async () => {
    // li-2 already holds last recompute's net; li-1 was never recomputed since
    // the column existed (a price edit rewrote its gross, its net is stale).
    h.fieldValueRows.mockResolvedValue(twoLines({ first: 10_000, second: 4_500 }))
    h.getFieldValues.mockResolvedValue(header(percent(10)))

    await recomputeTotals(order)

    expect(lineWrites().map((w) => [w.recordId, w.values[0]?.value])).toEqual([
      ['line_item:li-1', 9_000],
    ])
    expect(written('order_subtotal')).toBe(13_500)
  })

  it('sets the net back to the gross when the discount is removed', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: 9_000, second: 4_500 }))
    h.getFieldValues.mockResolvedValue(new Map())

    await recomputeTotals(order)

    expect(lineWrites().map((w) => w.values[0]?.value)).toEqual([10_000, 5_000])
    expect(written('order_subtotal')).toBe(15_000)
    expect(written('order_total')).toBe(15_000)
  })

  it('writes nothing at all when every line and every mirror already holds its value', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: 9_000, second: 4_500 }))
    h.getFieldValues.mockResolvedValue(
      header({
        ...percent(10),
        'f-o-subtotal': { type: 'number', value: 13_500 },
        'f-o-taxtotal': { type: 'number', value: 0 },
        'f-o-total': { type: 'number', value: 13_500 },
      })
    )

    await recomputeTotals(order)

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    // And the no-op never pays the connector-managed lookup either.
    expect(h.managedFieldsRows).not.toHaveBeenCalled()
  })

  it('leaves an unpriced line alone: a null gross has no net to write', async () => {
    h.fieldValueRows.mockResolvedValue([
      row('li-1', 'f-li-qty', 2),
      row('li-1', 'f-li-price', 5_000),
      row('li-1', 'f-li-total', 10_000),
      row('li-2', 'f-li-qty', 1),
    ])
    h.getFieldValues.mockResolvedValue(header(percent(10)))

    await recomputeTotals(order)

    expect(lineWrites().map((w) => [w.recordId, w.values[0]?.value])).toEqual([
      ['line_item:li-1', 9_000],
    ])
    expect(written('order_subtotal')).toBe(9_000)
  })

  it('still writes the header mirrors, and no line at all, on an org without the net field', async () => {
    // Entity migration 157 has not run here: `line_item_net_total` resolves to no
    // field. The subtotal is still Σ allocated net; the ledger falls back to gross.
    h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
      Object.fromEntries(
        attrs.filter((a) => FIELDS[a] && a !== 'line_item_net_total').map((a) => [a, FIELDS[a]])
      )
    )
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(header(percent(10)))

    await recomputeTotals(order)

    expect(lineWrites()).toEqual([])
    expect(written('order_subtotal')).toBe(13_500)
    expect(written('order_total')).toBe(13_500)
  })
})

describe('the connector-managed order is untouched', () => {
  it('writes neither the lines nor the header when order_total is connector-managed', async () => {
    // The connector wrote gross totals and its own nets from the payload. Nothing
    // here may "correct" either, and no header mirror may move.
    h.fieldValueRows.mockResolvedValue(twoLines({ first: 9_000, second: 4_500 }))
    h.getFieldValues.mockResolvedValue(header(percent(10)))
    h.managedFieldsRows.mockResolvedValue([{ managedFields: ['def_o:f-o-total'] }])

    await recomputeTotals(order)

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    // ONE lookup per record, covering the line writes and the mirrors together.
    expect(h.managedFieldsRows).toHaveBeenCalledTimes(1)
  })
})

describe('the discount stays on the header for every other document', () => {
  it('a quote with a header discount writes no line nets and keeps the header formula', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(
      header({
        'f-q-dtype': { type: 'option', optionId: 'percent' },
        'f-q-dvalue': { type: 'number', value: 10 },
      })
    )

    await recomputeTotals({ ...order, documentType: 'quote', documentInstanceId: 'q-1' })

    expect(lineWrites()).toEqual([])
    expect(written('quote_subtotal')).toBe(15_000)
    expect(written('quote_total')).toBe(13_500)
  })

  it('a quote does not even ask for line_item_net_total: the column is order-only', async () => {
    h.fieldValueRows.mockResolvedValue(twoLines({ first: null, second: null }))
    h.getFieldValues.mockResolvedValue(new Map())

    await recomputeTotals({ ...order, documentType: 'quote', documentInstanceId: 'q-1' })

    const requested = h.bySystemAttributes.mock.calls.flatMap((call) => call[0] as string[])
    expect(requested).not.toContain('line_item_net_total')
  })
})

describe('the line writes cannot loop', () => {
  it('neither total column is a line trigger, so the writes exit the line hook on its filter', () => {
    expect(LINE_TRIGGER_ATTRS.has('line_item_line_total')).toBe(false)
    expect(LINE_TRIGGER_ATTRS.has('line_item_net_total')).toBe(false)
  })
})
