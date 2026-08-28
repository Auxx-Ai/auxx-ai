// packages/lib/src/money/purchase-order-totals.test.ts
//
// `purchase_order_subtotal`, `purchase_order_total` and `purchase_order_line_line_total`
// are all `creatable: false` with the totals engine named as their only writer, so a
// missing engine arm leaves them NULL on every row with nothing to complain about.
//
// The other half of what these pin is that the arm is a LOOKUP, not a branch: the PO's
// header has no `_discount_type` and no `_tax_rate`, so a prefix derived by a
// boolean-shaped expression would have it reading and writing the QUOTE's fields — the
// exact defect `billingPrefix` carried in `line-builder/line-values.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  syncInvoicePaymentState: vi.fn(),
  /**
   * The LINE read. It is a set-based select over `FieldValue` rather than a
   * `getFieldValues` per line — one query per 200 ids instead of one per line
   * (`plans/events/08-derived-parent-reconciler-plan.md` §1), so the line half of
   * these fixtures is raw rows while the HEADER half stays `getFieldValues`.
   */
  fieldValueRows: vi.fn(),
}))

// Real schema (so `eq`/`inArray` get real columns), stubbed connection.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: () => ({ from: () => ({ where: () => h.fieldValueRows() }) }),
    },
  }
})

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

import {
  PURCHASE_ORDER_LINE_TRIGGER_ATTRS,
  PURCHASE_ORDER_TRIGGER_ATTRS,
  recomputeOnPurchaseOrderBillingChange,
  recomputeTotals,
} from './totals-hooks'

/** Field row ids, one per systemAttribute the engine may ask for. */
const FIELDS: Record<string, { id: string; type: string }> = {
  purchase_order_discount_value: { id: 'f-po-discount', type: 'CURRENCY' },
  purchase_order_shipping_total: { id: 'f-po-shipping', type: 'CURRENCY' },
  purchase_order_tax_total: { id: 'f-po-tax', type: 'CURRENCY' },
  purchase_order_line_line_total: { id: 'f-pol-total', type: 'CURRENCY' },
  purchase_order_line_purchase_order: { id: 'f-pol-po', type: 'RELATIONSHIP' },
  quote_discount_type: { id: 'f-q-dtype', type: 'SINGLE_SELECT' },
  quote_discount_value: { id: 'f-q-dvalue', type: 'CURRENCY' },
  quote_tax_rate: { id: 'f-q-rate', type: 'NUMBER' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_taxable: { id: 'f-li-taxable', type: 'BOOLEAN' },
  line_item_optional: { id: 'f-li-optional', type: 'BOOLEAN' },
  line_item_optional_selected: { id: 'f-li-optsel', type: 'BOOLEAN' },
}

function writtenFieldIds(): string[] {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string }> }
    | undefined
  return (call?.values ?? []).map((v) => v.fieldId)
}

function writtenValue(fieldId: string): number | undefined {
  const call = h.setValuesForEntity.mock.calls.at(-1)?.[0] as
    | { values: Array<{ fieldId: string; value: number }> }
    | undefined
  return call?.values.find((v) => v.fieldId === fieldId)?.value
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
})

/** One `FieldValue` row as the set-based line read sees it. */
function row(entityId: string, fieldId: string, value: number | boolean) {
  return typeof value === 'boolean'
    ? { entityId, fieldId, valueBoolean: value }
    : { entityId, fieldId, valueNumber: value }
}

describe('purchase order totals', () => {
  it('sums PURCHASE ORDER LINES, not line_items', async () => {
    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'purchase_order',
      documentInstanceId: 'po-1',
    })

    const listArg = h.listFiltered.mock.calls[0]![0] as {
      entityDefinitionId: string
      filters: Array<{ conditions: Array<{ fieldId: string; value: string }> }>
    }
    expect(listArg.entityDefinitionId).toBe('purchase_order_line')
    expect(listArg.filters[0]!.conditions[0]!.fieldId).toBe('purchase_order_line:purchaseOrder')
    expect(listArg.filters[0]!.conditions[0]!.value).toBe('purchase_order:po-1')
  })

  it('never reads a quote field — the header attrs are looked up, not prefixed', async () => {
    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'purchase_order',
      documentInstanceId: 'po-1',
    })

    const asked = h.bySystemAttributes.mock.calls.flatMap((c) => c[0] as string[])
    expect(asked).not.toContain('purchase_order_discount_type')
    expect(asked).not.toContain('purchase_order_tax_rate')
    expect(asked.some((a) => a.startsWith('quote_'))).toBe(false)
    expect(asked).toContain('purchase_order_discount_value')
    expect(asked).toContain('purchase_order_shipping_total')
    expect(asked).toContain('purchase_order_tax_total')
  })

  it('adds the STATED shipping and tax on top and subtracts the flat discount', async () => {
    // Two lines at $50.00 and $30.00; $10.00 discount, $5.00 freight, $6.40 stated tax.
    h.listFiltered.mockResolvedValue({ ids: ['pol-1', 'pol-2'] })
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-po-discount', { type: 'number', value: 1000 }],
        ['f-po-shipping', { type: 'number', value: 500 }],
        ['f-po-tax', { type: 'number', value: 640 }],
      ])
    )
    h.fieldValueRows.mockResolvedValue([
      row('pol-1', 'f-pol-total', 5000),
      row('pol-2', 'f-pol-total', 3000),
    ])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'purchase_order',
      documentInstanceId: 'po-1',
    })

    expect(writtenValue('purchase_order_subtotal')).toBe(8000)
    // 8000 - 1000 discount + 500 freight + 640 tax
    expect(writtenValue('purchase_order_total')).toBe(8140)
  })

  it('does NOT write purchase_order_tax_total — it is a human input to the total', async () => {
    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'purchase_order',
      documentInstanceId: 'po-1',
    })

    expect(writtenFieldIds()).toEqual(['purchase_order_subtotal', 'purchase_order_total'])
  })

  it('treats the flat discount as an AMOUNT with no discount-type field to read', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['pol-1'] })
    // A `percent` reading of 25 would give 7500, not 9975.
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([['f-po-discount', { type: 'number', value: 25 }]])
    )
    h.fieldValueRows.mockResolvedValue([row('pol-1', 'f-pol-total', 10000)])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'purchase_order',
      documentInstanceId: 'po-1',
    })

    expect(writtenValue('purchase_order_total')).toBe(9975)
  })
})

describe('the sell side is byte-for-byte unchanged', () => {
  it('still sums line_items and still writes all three quote mirrors', async () => {
    h.listFiltered.mockResolvedValue({ ids: ['li-1'] })
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        ['f-q-dtype', { type: 'option', optionId: 'percent' }],
        ['f-q-dvalue', { type: 'number', value: 10 }],
        ['f-q-rate', { type: 'number', value: 10 }],
      ])
    )
    h.fieldValueRows.mockResolvedValue([
      row('li-1', 'f-li-total', 10000),
      row('li-1', 'f-li-taxable', true),
    ])

    await recomputeTotals({
      organizationId: 'org_1',
      userId: 'usr_1',
      documentType: 'quote',
      documentInstanceId: 'q-1',
    })

    expect(
      (h.listFiltered.mock.calls[0]![0] as { entityDefinitionId: string }).entityDefinitionId
    ).toBe('line_item')
    expect(writtenFieldIds().sort()).toEqual(['quote_subtotal', 'quote_tax_total', 'quote_total'])
    expect(writtenValue('quote_subtotal')).toBe(10000)
    expect(writtenValue('quote_tax_total')).toBe(900) // 10% of the discounted 9000
    expect(writtenValue('quote_total')).toBe(9900)
  })
})

describe('the purchase order trigger vocabulary', () => {
  function event(systemAttribute: string): EntityFieldChangeEvent {
    return {
      recordId: 'purchase_order:po-1',
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f', systemAttribute, type: 'CURRENCY' },
    } as unknown as EntityFieldChangeEvent
  }

  it('names only fields the PO actually has', () => {
    expect([...PURCHASE_ORDER_TRIGGER_ATTRS].sort()).toEqual([
      'purchase_order_discount_value',
      'purchase_order_shipping_total',
      'purchase_order_tax_total',
    ])
    expect([...PURCHASE_ORDER_LINE_TRIGGER_ATTRS].sort()).toEqual([
      'purchase_order_line_expected_unit_price',
      'purchase_order_line_purchase_order',
      'purchase_order_line_quantity_ordered',
    ])
  })

  it('recomputes on a stated-money change and ignores everything else', async () => {
    await recomputeOnPurchaseOrderBillingChange(event('purchase_order_shipping_total'))
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)

    h.setValuesForEntity.mockClear()
    // The fields the hook WRITES must not re-enter it, or the recompute loops.
    await recomputeOnPurchaseOrderBillingChange(event('purchase_order_subtotal'))
    await recomputeOnPurchaseOrderBillingChange(event('purchase_order_total'))
    await recomputeOnPurchaseOrderBillingChange(event('purchase_order_status'))
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
