// packages/lib/src/accounting/sales/totals/__tests__/totals-reentry.test.ts
//
// The engine's own writes now reach the field hooks (alias RecordIds resolve in the
// field-value layer), so every attribute it writes is fed back into every totals hook
// here: none may recompute a line total, and only the memo/credit line totals — which
// the parent re-sums as a fact — may re-sum a parent.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../../../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  readLinesForTotals: vi.fn(),
  setValuesForEntity: vi.fn(),
  fieldValueRows: vi.fn(),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: () => ({ from: () => ({ where: () => h.fieldValueRows() }) }),
    },
  }
})
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
  syncInvoicePaymentState: vi.fn(),
}))

import {
  recomputeOnCreditMemoLineChange,
  recomputeOnInvoiceBillingChange,
  recomputeOnLineChange,
  recomputeOnOrderBillingChange,
  recomputeOnPurchaseOrderBillingChange,
  recomputeOnPurchaseOrderLineChange,
  recomputeOnQuoteBillingChange,
  recomputeOnVendorCreditLineChange,
} from '../totals-hooks'

/** Every attribute the totals engine writes, per the entity it lands on. */
const ENGINE_WRITES = {
  line_item: ['line_item_line_total', 'line_item_net_total'],
  quote: ['quote_subtotal', 'quote_total', 'quote_tax_total'],
  invoice: ['invoice_subtotal', 'invoice_total', 'invoice_tax_total'],
  order: ['order_subtotal', 'order_total', 'order_tax_total'],
  purchase_order: ['purchase_order_subtotal', 'purchase_order_total'],
  purchase_order_line: ['purchase_order_line_line_total'],
  credit_memo_line: ['credit_memo_line_subtotal'],
  vendor_credit_line: ['vendor_credit_line_line_total'],
} as const

type Handler = (event: EntityFieldChangeEvent) => Promise<void> | void

/** The totals hooks registered on each entity (`field-hooks/register-hooks.ts`). */
const HOOKS: Record<keyof typeof ENGINE_WRITES, Handler[]> = {
  line_item: [recomputeOnLineChange as Handler],
  quote: [recomputeOnQuoteBillingChange as Handler],
  invoice: [recomputeOnInvoiceBillingChange as Handler],
  order: [recomputeOnOrderBillingChange as Handler],
  purchase_order: [recomputeOnPurchaseOrderBillingChange as Handler],
  purchase_order_line: [recomputeOnPurchaseOrderLineChange as Handler],
  credit_memo_line: [recomputeOnCreditMemoLineChange as Handler],
  vendor_credit_line: [recomputeOnVendorCreditLineChange as Handler],
}

function event(entityType: string, attribute: string): EntityFieldChangeEvent {
  return {
    organizationId: 'org_1',
    userId: 'usr_1',
    recordId: `def_${entityType}:inst_1`,
    field: { id: `f-${attribute}`, systemAttribute: attribute },
    oldValue: null,
    newValue: null,
  } as unknown as EntityFieldChangeEvent
}

/** Line-total attributes any `setValuesForEntity` call wrote. */
function lineTotalWrites(): string[] {
  const lineTotals = new Set<string>([
    'line_item_line_total',
    'purchase_order_line_line_total',
    'credit_memo_line_subtotal',
    'vendor_credit_line_line_total',
  ])
  return h.setValuesForEntity.mock.calls.flatMap((c) =>
    (c[0] as { values: Array<{ fieldId: string }> }).values
      .map((v) => v.fieldId)
      .filter((id) => lineTotals.has(id))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.map((a) => [a, { id: a, type: 'NUMBER' }]))
  )
  h.getFieldValues.mockResolvedValue(new Map())
  h.readLinesForTotals.mockResolvedValue([])
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.fieldValueRows.mockResolvedValue([])
})

describe('totals engine writes fed back into the totals hooks', () => {
  for (const [entityType, attributes] of Object.entries(ENGINE_WRITES)) {
    for (const attribute of attributes) {
      it(`${attribute} never rewrites a line total`, async () => {
        for (const hook of HOOKS[entityType as keyof typeof ENGINE_WRITES]) {
          await hook(event(entityType, attribute))
        }
        expect(lineTotalWrites()).toEqual([])
      })
    }
  }

  it('every write but the memo and credit line totals does no work at all', async () => {
    const inert = [
      'line_item',
      'quote',
      'invoice',
      'order',
      'purchase_order',
      'purchase_order_line',
    ] as const
    for (const entityType of inert) {
      for (const attribute of ENGINE_WRITES[entityType]) {
        for (const hook of HOOKS[entityType]) await hook(event(entityType, attribute))
      }
    }
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
    expect(h.getFieldValues).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
