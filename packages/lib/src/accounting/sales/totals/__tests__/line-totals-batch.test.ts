// packages/lib/src/accounting/sales/totals/__tests__/line-totals-batch.test.ts
//
// plans/events/10 §4.4: the sync lane's core for `recomputeOnLineChange`, through the real
// reconciler. Ported from the retired pass 1 of
// `events/handlers/__tests__/finalize-integrity-passes.test.ts`. Same mock harness as
// totals-coalescing.test.ts next door — `listFiltered` counts document rebuilds.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldChangeRef } from '../../../../field-hooks/types'
import type { CachedField } from '../../../../field-values/types'
import { runWithDirtyParents } from '../../../../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  fieldValueRows: vi.fn(),
  relationRows: vi.fn(),
  managedFieldsRows: vi.fn(),
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
    listFiltered = h.listFiltered
  },
}))
vi.mock('../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  return {
    schema,
    database: {
      select: (projection?: unknown) => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === schema.DataConnectorItem) return h.managedFieldsRows()
            return projection ? h.relationRows() : h.fieldValueRows()
          },
        }),
      }),
    },
  }
})

import { database } from '@auxx/database'
import { recomputeLineTotalsBatch } from '../totals-hooks'
import { registerMoneyTotalsReconcilers } from '../totals-reconciler'

const FIELDS: Record<string, { id: string; type: string }> = {
  quote_discount_type: { id: 'f-q-dtype', type: 'SINGLE_SELECT' },
  quote_discount_value: { id: 'f-q-dvalue', type: 'CURRENCY' },
  quote_tax_rate: { id: 'f-q-rate', type: 'NUMBER' },
  quote_subtotal: { id: 'f-q-subtotal', type: 'CURRENCY' },
  quote_tax_total: { id: 'f-q-taxtotal', type: 'CURRENCY' },
  quote_total: { id: 'f-q-total', type: 'CURRENCY' },
  line_item_qty: { id: 'f-li-qty', type: 'NUMBER' },
  line_item_unit_price: { id: 'f-li-price', type: 'CURRENCY' },
  line_item_line_total: { id: 'f-li-total', type: 'CURRENCY' },
  line_item_quote: { id: 'f-li-quote', type: 'RELATIONSHIP' },
  line_item_invoice: { id: 'f-li-invoice', type: 'RELATIONSHIP' },
  line_item_order: { id: 'f-li-order', type: 'RELATIONSHIP' },
  line_item_work_order: { id: 'f-li-wo', type: 'RELATIONSHIP' },
}

const ORG = 'org_1'
// The run's own connection, as the finalize threads it in — the totals stand-down's
// connector-managed check (money plan 37 §6) reads through it.
const DB = database as never

function target(lineInstanceId: string, systemAttribute: string): FieldChangeRef {
  return {
    recordId: `line_item:${lineInstanceId}`,
    entityDefinitionId: 'def_li',
    entityType: 'line_item',
    entitySlug: 'line-items',
    field: { id: 'f', systemAttribute, type: 'CURRENCY' } as unknown as CachedField,
    organizationId: ORG,
    userId: 'system',
  } as FieldChangeRef
}

/** The core marks; the drain runs on the way out of the scope. */
const batch = (targets: FieldChangeRef[]) =>
  runWithDirtyParents(ORG, 'system', () =>
    recomputeLineTotalsBatch({ organizationId: ORG, userId: 'system', db: DB, targets })
  )

/** `setValuesForEntity` calls that wrote a line's own total (keyed by attribute, not field id). */
const lineTotalWrites = () =>
  h.setValuesForEntity.mock.calls.filter(
    ([params]) => params.values[0]?.fieldId === 'line_item_line_total'
  )

/** How many times a whole document was rebuilt. */
const rebuilds = () => h.listFiltered.mock.calls.length

beforeAll(() => {
  registerMoneyTotalsReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.listFiltered.mockResolvedValue({ ids: [] })
  h.getFieldValues.mockResolvedValue(new Map())
  h.fieldValueRows.mockResolvedValue([])
  h.relationRows.mockResolvedValue([])
  h.managedFieldsRows.mockResolvedValue([])
})

describe('recomputeLineTotalsBatch', () => {
  it('writes the line total BEFORE the parent recompute sums the lines', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    await batch([target('li-1', 'line_item_qty')])

    expect(lineTotalWrites()).toHaveLength(1)
    expect(rebuilds()).toBe(1)
    expect(h.setValuesForEntity.mock.invocationCallOrder[0]!).toBeLessThan(
      h.listFiltered.mock.invocationCallOrder[0]!
    )
  })

  it('rewrites one line total per LINE, not per changed attribute', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    await batch([target('li-1', 'line_item_qty'), target('li-1', 'line_item_unit_price')])

    expect(lineTotalWrites()).toHaveLength(1)
    expect(rebuilds()).toBe(1)
  })

  it('skips the line-total rewrite for a relation-only change, but still recomputes the parent', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    await batch([target('li-1', 'line_item_quote')])

    expect(lineTotalWrites()).toHaveLength(0)
    expect(rebuilds()).toBe(1)
  })

  it('collapses two lines of one document into ONE rebuild, with one relation query', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-1', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
      { entityId: 'li-2', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])

    await batch([target('li-1', 'line_item_qty'), target('li-2', 'line_item_qty')])

    expect(h.relationRows).toHaveBeenCalledTimes(1)
    expect(rebuilds()).toBe(1)
  })

  it('does nothing for an attribute outside the trigger set', async () => {
    await batch([target('li-1', 'line_item_description')])

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(rebuilds()).toBe(0)
  })

  it('a failing line total never starves the rest of the batch', async () => {
    h.relationRows.mockResolvedValue([
      { entityId: 'li-2', fieldId: 'f-li-quote', relatedEntityId: 'q-1' },
    ])
    h.setValuesForEntity.mockRejectedValueOnce(new Error('boom'))

    await expect(
      batch([target('li-1', 'line_item_qty'), target('li-2', 'line_item_qty')])
    ).resolves.toBeUndefined()

    expect(rebuilds()).toBe(1)
  })
})
