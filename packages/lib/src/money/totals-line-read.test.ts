// packages/lib/src/money/totals-line-read.test.ts
//
// The line read and the no-op guard, both added by
// `plans/events/08-derived-parent-reconciler-plan.md` phase 1.
//
// What these pin is COST, which no other test in this module can see: the engine used to
// issue one `getFieldValues` per line, inside a `for await`, against an id list capped at
// 1000 — and the hook that calls it fires once per changed FIELD, so a 20-line bulk paste
// ran 40 recomputes each re-reading every line that existed so far. A regression here is
// silent: every totals assertion in the suite passes just as well at 20 queries as at one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  syncInvoicePaymentState: vi.fn(),
  fieldValueRows: vi.fn(),
  /** The totals stand-down's `isFieldConnectorManaged` read — a DIFFERENT table
   * (`DataConnectorItem`) from the line-value read below, kept off `fieldValueRows`'s
   * call count so the "one query, not one per line" assertions still measure only that. */
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
vi.mock('./payments/ledger', () => ({ syncInvoicePaymentState: h.syncInvoicePaymentState }))
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

import { recomputeTotals } from './totals-hooks'

const FIELDS: Record<string, { id: string; type: string }> = {
  quote_discount_type: { id: 'f-q-dtype', type: 'SINGLE_SELECT' },
  quote_discount_value: { id: 'f-q-dvalue', type: 'CURRENCY' },
  quote_tax_rate: { id: 'f-q-rate', type: 'NUMBER' },
  quote_subtotal: { id: 'f-q-subtotal', type: 'CURRENCY' },
  quote_tax_total: { id: 'f-q-taxtotal', type: 'CURRENCY' },
  quote_total: { id: 'f-q-total', type: 'CURRENCY' },
  invoice_discount_type: { id: 'f-i-dtype', type: 'SINGLE_SELECT' },
  invoice_discount_value: { id: 'f-i-dvalue', type: 'CURRENCY' },
  invoice_tax_rate: { id: 'f-i-rate', type: 'NUMBER' },
  invoice_subtotal: { id: 'f-i-subtotal', type: 'CURRENCY' },
  invoice_tax_total: { id: 'f-i-taxtotal', type: 'CURRENCY' },
  invoice_total: { id: 'f-i-total', type: 'CURRENCY' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_taxable: { id: 'f-li-taxable', type: 'BOOLEAN' },
  line_item_optional: { id: 'f-li-optional', type: 'BOOLEAN' },
  line_item_optional_selected: { id: 'f-li-optsel', type: 'BOOLEAN' },
}

function row(entityId: string, fieldId: string, value: number | boolean) {
  return typeof value === 'boolean'
    ? { entityId, fieldId, valueBoolean: value }
    : { entityId, fieldId, valueNumber: value }
}

function written(fieldId: string): number | undefined {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string; value: number }> }
    | undefined
  return call?.values.find((v) => v.fieldId === fieldId)?.value
}

const quote = { organizationId: 'org_1', userId: 'usr_1', documentInstanceId: 'q-1' } as const

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.syncInvoicePaymentState.mockResolvedValue(undefined)
  h.listFiltered.mockResolvedValue({ ids: [] })
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.managedFieldsRows.mockResolvedValue([])
})

describe('the line read is set-based', () => {
  it('issues ONE query for many lines, not one per line', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `li-${i}`)
    h.listFiltered.mockResolvedValue({ ids })
    h.fieldValueRows.mockResolvedValue(ids.map((id) => row(id, 'f-li-total', 100)))

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.fieldValueRows).toHaveBeenCalledTimes(1)
    expect(written('quote_subtotal')).toBe(2500)
  })

  it('chunks a document past 200 lines rather than sending one unbounded IN-list', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `li-${i}`)
    h.listFiltered.mockResolvedValue({ ids })
    h.fieldValueRows.mockResolvedValue([])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.fieldValueRows).toHaveBeenCalledTimes(2)
  })

  it('never queries at all when the document has no lines', async () => {
    await recomputeTotals({ ...quote, documentType: 'quote' })
    expect(h.fieldValueRows).not.toHaveBeenCalled()
    expect(written('quote_subtotal')).toBe(0)
  })
})

describe('per-line value semantics are unchanged', () => {
  it('counts a line with NO stored values as a zero contribution, not as absent', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1', 'li-2'] })
    // Only li-1 has a row. li-2 must still produce a line, exactly as the old
    // per-line loop did — it pushed an entry per id regardless of what came back.
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 5000)])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(5000)
  })

  it('treats an absent `taxable` as taxable and a stored `false` as not', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1', 'li-2'] })
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([['f-q-rate', { type: 'number', value: 10 }]])
    )
    h.fieldValueRows.mockResolvedValue([
      row('li-1', 'f-li-total', 10000), // no taxable row -> taxable
      row('li-2', 'f-li-total', 10000),
      row('li-2', 'f-li-taxable', false), // stored false -> not taxable
    ])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(20000)
    expect(written('quote_tax_total')).toBe(1000) // 10% of li-1 only
  })

  it('drops an unselected optional line from the total', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1', 'li-2'] })
    h.fieldValueRows.mockResolvedValue([
      row('li-1', 'f-li-total', 10000),
      row('li-2', 'f-li-total', 9900),
      row('li-2', 'f-li-optional', true),
      row('li-2', 'f-li-optsel', false),
    ])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(10000)
  })
})

describe('the no-op guard', () => {
  it('skips the write when every mirror already holds the computed value', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10000)])
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-q-subtotal', { type: 'number', value: 10000 }],
        ['f-q-taxtotal', { type: 'number', value: 0 }],
        ['f-q-total', { type: 'number', value: 10000 }],
      ])
    )

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('writes when ANY mirror differs, even by a cent', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10000)])
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-q-subtotal', { type: 'number', value: 10000 }],
        ['f-q-taxtotal', { type: 'number', value: 0 }],
        ['f-q-total', { type: 'number', value: 9999 }],
      ])
    )

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('writes when a mirror is UNSET — null is not a match', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10000)])
    h.getFieldValues.mockResolvedValue(new Map())

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('still runs afterWrite on a no-op — a payment moves `balance` with totals unchanged', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.fieldValueRows.mockResolvedValue([row('li-1', 'f-li-total', 10000)])
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-i-subtotal', { type: 'number', value: 10000 }],
        ['f-i-taxtotal', { type: 'number', value: 0 }],
        ['f-i-total', { type: 'number', value: 10000 }],
      ])
    )

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'invoice',
      documentInstanceId: 'inv-1',
    })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(h.syncInvoicePaymentState).toHaveBeenCalledTimes(1)
  })
})
