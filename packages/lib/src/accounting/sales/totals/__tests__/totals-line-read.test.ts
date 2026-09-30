// packages/lib/src/accounting/sales/totals/__tests__/totals-line-read.test.ts
//
// The line read and the no-op guard (`plans/events/08-derived-parent-reconciler-plan.md`
// phase 1). The read itself is the lines module's `readLinesForTotals` now
// (plans/entity/domain-tables/01 §1.2); its set-based cost is `readSystemRecords`'.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  readLinesForTotals: vi.fn(),
  setValuesForEntity: vi.fn(),
  syncInvoicePaymentState: vi.fn(),
  fieldValueRows: vi.fn(),
  /** The totals stand-down's `isFieldConnectorManaged` read — a DIFFERENT table
   * (`DataConnectorItem`) from the line-value read below, kept off `fieldValueRows`'s
   * call count so the "one query, not one per line" assertions still measure only that. */
  managedFieldsRows: vi.fn(),
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
  },
}))
vi.mock('../../../documents/lines/reads', () => ({ readLinesForTotals: h.readLinesForTotals }))
vi.mock('../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../../../money/invoice-payments/payment-state', () => ({
  syncInvoicePaymentState: h.syncInvoicePaymentState,
}))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
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

import { recomputeTotals } from '../totals-hooks'
import { totalsRow } from './support/totals-rows'

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
  h.readLinesForTotals.mockResolvedValue([])
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.managedFieldsRows.mockResolvedValue([])
})

describe('the line read', () => {
  it('reads the document once through the lines module, with no cap', async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => totalsRow(`li-${i}`, { lineTotal: 100 }))
    h.readLinesForTotals.mockResolvedValue(lines)

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.readLinesForTotals).toHaveBeenCalledTimes(1)
    expect(h.readLinesForTotals.mock.calls[0]![2]).toEqual({
      documentType: 'quote',
      documentId: 'q-1',
    })
    expect(written('quote_subtotal')).toBe(120_000)
  })

  it('never reads lines when the org has no line total field, and totals zero', async () => {
    h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
      Object.fromEntries(
        attrs.filter((a) => FIELDS[a] && a !== 'line_item_line_total').map((a) => [a, FIELDS[a]])
      )
    )
    await recomputeTotals({ ...quote, documentType: 'quote' })
    expect(h.readLinesForTotals).not.toHaveBeenCalled()
    expect(written('quote_subtotal')).toBe(0)
  })
})

describe('per-line value semantics are unchanged', () => {
  it('counts a line with NO stored total as a zero contribution, not as absent', async () => {
    h.readLinesForTotals.mockResolvedValue([
      totalsRow('li-1', { lineTotal: 5000 }),
      totalsRow('li-2'),
    ])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(5000)
  })

  it('taxes a taxable line and not one stored `false`', async () => {
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([['f-q-rate', { type: 'number', value: 10 }]])
    )
    h.readLinesForTotals.mockResolvedValue([
      totalsRow('li-1', { lineTotal: 10000 }),
      totalsRow('li-2', { lineTotal: 10000, taxable: false }),
    ])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(20000)
    expect(written('quote_tax_total')).toBe(1000) // 10% of li-1 only
  })

  it('drops an unselected optional line from the total', async () => {
    h.readLinesForTotals.mockResolvedValue([
      totalsRow('li-1', { lineTotal: 10000 }),
      totalsRow('li-2', { lineTotal: 9900, optional: true, optionalSelected: false }),
    ])

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(written('quote_subtotal')).toBe(10000)
  })
})

describe('the no-op guard', () => {
  it('skips the write when every mirror already holds the computed value', async () => {
    h.readLinesForTotals.mockResolvedValue([totalsRow('li-1', { lineTotal: 10000 })])
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
    h.readLinesForTotals.mockResolvedValue([totalsRow('li-1', { lineTotal: 10000 })])
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
    h.readLinesForTotals.mockResolvedValue([totalsRow('li-1', { lineTotal: 10000 })])
    h.getFieldValues.mockResolvedValue(new Map())

    await recomputeTotals({ ...quote, documentType: 'quote' })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('still runs afterWrite on a no-op — a payment moves `balance` with totals unchanged', async () => {
    h.readLinesForTotals.mockResolvedValue([totalsRow('li-1', { lineTotal: 10000 })])
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
