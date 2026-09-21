// packages/lib/src/accounting/sales/fulfillments/__tests__/reads.test.ts
//
// `readFulfillmentsForOrders` is the shared contract every other module reads
// fulfillments through (`plans/money/tasks/55-shipment-lines.md` §6) - the
// bulk poster, the credit-memo readers, the order drawer's ledger card, and
// `sales/orders/reads.ts`'s single-order path. This is the one place that
// exercises the assembly end to end: which fulfillments belong to these
// orders, their own cells, which lines belong to those fulfillments, and the
// lines' cells.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../cache', () => ({ getCachedEntityDefId: vi.fn(), getOrgCache: vi.fn() }))

/** The options every `readSystemRecords` call was made with, so the archived-row contract is asserted and not just described. */
const readOptions = vi.hoisted(() => [] as (Record<string, unknown> | undefined)[])

vi.mock('../../../../resources/system-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../resources/system-records')>()
  return {
    ...actual,
    readSystemRecords: (...args: Parameters<typeof actual.readSystemRecords>) => {
      readOptions.push(args[3] as Record<string, unknown> | undefined)
      return actual.readSystemRecords(...args)
    },
  }
})

import { getCachedEntityDefId, getOrgCache } from '../../../../cache'
import { FULFILLMENT_FIELDS } from '../../../../resources/registry/resources/fulfillment-fields'
import { FULFILLMENT_LINE_FIELDS } from '../../../../resources/registry/resources/fulfillment-line-fields'
import { loadFulfillmentFieldContext, requireFulfillmentFieldContext } from '../fields'
import { readFulfillmentsForOrder, readFulfillmentsForOrders } from '../reads'

/** `systemAttribute -> field id`, standing in for the org cache's resolved `CustomFieldEntity`s. */
const FIELD_IDS: Record<string, string> = {
  fulfillment_order: 'fld_order',
  fulfillment_sequence: 'fld_sequence',
  fulfillment_shipped_at: 'fld_shipped_at',
  fulfillment_status: 'fld_status',
  fulfillment_cancelled_at: 'fld_cancelled_at',
  fulfillment_name: 'fld_name',
  fulfillment_tracking_number: 'fld_tracking_number',
  fulfillment_tracking_company: 'fld_tracking_company',
  fulfillment_tracking_url: 'fld_tracking_url',
  fulfillment_subtotal: 'fld_subtotal',
  fulfillment_total: 'fld_total',
  fulfillment_shipping_recognised: 'fld_shipping_recognised',
  fulfillment_recorded_at: 'fld_recorded_at',
  fulfillment_line_fulfillment: 'fld_line_fulfillment',
  fulfillment_line_line_item: 'fld_line_line_item',
  fulfillment_line_quantity: 'fld_line_quantity',
  fulfillment_line_quantity_relieved: 'fld_line_quantity_relieved',
}

/** The registry's own field type: a stub without one reads every cell as unset. */
function fieldTypeOf(attribute: string): string {
  for (const map of [FULFILLMENT_FIELDS, FULFILLMENT_LINE_FIELDS]) {
    for (const field of Object.values(map)) {
      if (field?.systemAttribute === attribute) return field.fieldType ?? 'TEXT'
    }
  }
  throw new Error(`No fulfillment registry field declares ${attribute}`)
}

function allFields(): Record<string, { id: string; type: string }> {
  return Object.fromEntries(
    Object.entries(FIELD_IDS).map(([attr, id]) => [attr, { id, type: fieldTypeOf(attr) }])
  )
}

/**
 * A `db` whose `.select().from().where()` resolves the next queued row set.
 *
 * `where()` answers a promise carrying its own `orderBy`, so the values query's
 * trailing `.orderBy(sortKey)` reads the SAME row set rather than consuming the
 * next one.
 */
function stubDb(queue: unknown[][]): Database {
  let index = 0
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => {
      const rows = queue[index++] ?? []
      const settled = Promise.resolve(rows) as Promise<unknown[]> & { orderBy: () => unknown }
      settled.orderBy = () => Promise.resolve(rows)
      return settled
    },
  }
  return { select: () => chain } as unknown as Database
}

/** One `fulfillment` instance row, as `readSystemRecords` selects it. */
function instance(id: string): Record<string, unknown> {
  return { id, createdAt: new Date('2026-09-01'), updatedAt: null, archivedAt: null }
}

beforeEach(() => {
  readOptions.length = 0
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org: string, entityType: string) =>
    entityType === 'fulfillment'
      ? 'def_fulfillment'
      : entityType === 'fulfillment_line'
        ? 'def_fulfillment_line'
        : undefined
  )
  vi.mocked(getOrgCache).mockReturnValue({
    from: () => ({ bySystemAttributes: async () => allFields() }),
  } as unknown as ReturnType<typeof getOrgCache>)
})

describe('loadFulfillmentFieldContext / requireFulfillmentFieldContext', () => {
  it('resolves both defs and the join fields', async () => {
    const ctx = await loadFulfillmentFieldContext(undefined, 'org_1')
    expect(ctx?.fulfillment.defId).toBe('def_fulfillment')
    expect(ctx?.line.defId).toBe('def_fulfillment_line')
  })

  it('is null when the org has not run entity migration 153', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    expect(await loadFulfillmentFieldContext(undefined, 'org_1')).toBeNull()
  })

  it('require throws the migration refusal instead of returning null', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    await expect(requireFulfillmentFieldContext(undefined, 'org_1')).rejects.toThrow(
      /migration 153/i
    )
  })
})

describe('readFulfillmentsForOrders', () => {
  it('returns empty without querying when no order ids are given', async () => {
    const db = stubDb([])
    expect(await readFulfillmentsForOrders(db, { organizationId: 'org_1', orderIds: [] })).toEqual(
      new Map()
    )
  })

  it('returns empty when the org has no fulfillment entities yet', async () => {
    vi.mocked(getCachedEntityDefId).mockResolvedValue(undefined)
    const db = stubDb([])
    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result).toEqual(new Map())
  })

  it('assembles one fulfillment with two lines from its cells and its lines', async () => {
    const db = stubDb([
      // Which fulfillments point at these orders.
      [{ entityId: 'ful_1' }],
      // Those instances.
      [instance('ful_1')],
      // Their cells.
      [
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
        { entityId: 'ful_1', fieldId: 'fld_shipped_at', valueDate: '2026-09-03T12:00:00.000Z' },
        { entityId: 'ful_1', fieldId: 'fld_status', optionId: 'success' },
        { entityId: 'ful_1', fieldId: 'fld_name', valueText: 'ORD-1-F1' },
        { entityId: 'ful_1', fieldId: 'fld_subtotal', valueNumber: 50_00 },
        { entityId: 'ful_1', fieldId: 'fld_total', valueNumber: 55_00 },
        { entityId: 'ful_1', fieldId: 'fld_shipping_recognised', valueBoolean: true },
        { entityId: 'ful_1', fieldId: 'fld_recorded_at', valueDate: '2026-09-03T00:00:00.000Z' },
      ],
      // Which lines point at those fulfillments.
      [{ entityId: 'fl_1' }, { entityId: 'fl_2' }],
      [instance('fl_1'), instance('fl_2')],
      [
        {
          entityId: 'fl_1',
          fieldId: 'fld_line_fulfillment',
          relatedEntityId: 'ful_1',
          relatedEntityDefinitionId: 'def_fulfillment',
        },
        {
          entityId: 'fl_1',
          fieldId: 'fld_line_line_item',
          relatedEntityId: 'li_1',
          relatedEntityDefinitionId: 'def_line_item',
        },
        { entityId: 'fl_1', fieldId: 'fld_line_quantity', valueNumber: 2 },
        {
          entityId: 'fl_2',
          fieldId: 'fld_line_fulfillment',
          relatedEntityId: 'ful_1',
          relatedEntityDefinitionId: 'def_fulfillment',
        },
        {
          entityId: 'fl_2',
          fieldId: 'fld_line_line_item',
          relatedEntityId: 'li_2',
          relatedEntityDefinitionId: 'def_line_item',
        },
        { entityId: 'fl_2', fieldId: 'fld_line_quantity', valueNumber: 3 },
        { entityId: 'fl_2', fieldId: 'fld_line_quantity_relieved', valueNumber: 1 },
      ],
      // The fulfillment's live subject posting, if any (none here).
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })

    expect(result.get('ord_1')).toEqual([
      {
        id: 'ful_1',
        recordId: 'fulfillment:ful_1',
        orderId: 'ord_1',
        sequence: 1,
        shippedAt: '2026-09-03T12:00:00.000Z',
        status: 'success',
        cancelledAt: null,
        name: 'ORD-1-F1',
        trackingNumber: null,
        trackingCompany: null,
        trackingUrl: null,
        subtotalMinor: 50_00,
        totalMinor: 55_00,
        shippingRecognised: true,
        glPosting: null,
        docNumber: null,
        recordedAt: '2026-09-03T00:00:00.000Z',
        lines: [
          {
            id: 'fl_1',
            recordId: 'fulfillment_line:fl_1',
            lineItemId: 'li_1',
            quantity: 2,
            quantityRelieved: null,
          },
          {
            id: 'fl_2',
            recordId: 'fulfillment_line:fl_2',
            lineItemId: 'li_2',
            quantity: 3,
            quantityRelieved: 1,
          },
        ],
      },
    ])
  })

  it('still returns an archived fulfillment and its archived lines', async () => {
    const archived = (id: string) => ({ ...instance(id), archivedAt: new Date('2026-09-04') })
    const db = stubDb([
      [{ entityId: 'ful_1' }],
      [archived('ful_1')],
      [
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [{ entityId: 'fl_1' }],
      [archived('fl_1')],
      [
        {
          entityId: 'fl_1',
          fieldId: 'fld_line_fulfillment',
          relatedEntityId: 'ful_1',
          relatedEntityDefinitionId: 'def_fulfillment',
        },
        {
          entityId: 'fl_1',
          fieldId: 'fld_line_line_item',
          relatedEntityId: 'li_1',
          relatedEntityDefinitionId: 'def_line_item',
        },
        { entityId: 'fl_1', fieldId: 'fld_line_quantity', valueNumber: 2 },
      ],
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })

    // An archived fulfillment keeps its live `GlPostingSource` claim, so a
    // reader that hid it would un-ship its quantity at the close.
    expect(result.get('ord_1')?.[0]?.id).toBe('ful_1')
    expect(result.get('ord_1')?.[0]?.lines.map((line) => line.id)).toEqual(['fl_1'])
    expect(readOptions.map((options) => options?.includeArchived)).toEqual([true, true])
  })

  it('reads an order edge whose row carries no relatedEntityDefinitionId', async () => {
    const db = stubDb([
      [{ entityId: 'ful_1' }],
      [instance('ful_1')],
      // No `relatedEntityDefinitionId`: `related()` reads null and the raw
      // column is the fallback, rather than the shipment vanishing.
      [
        { entityId: 'ful_1', fieldId: 'fld_order', relatedEntityId: 'ord_1' },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [],
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.[0]?.id).toBe('ful_1')
  })

  it('sorts an order with several fulfillments by sequence, not by write order', async () => {
    const db = stubDb([
      [{ entityId: 'ful_2' }, { entityId: 'ful_1' }],
      [instance('ful_2'), instance('ful_1')],
      [
        {
          entityId: 'ful_2',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_2', fieldId: 'fld_sequence', valueNumber: 2 },
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [], // no lines on either fulfillment
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.map((f) => f.sequence)).toEqual([1, 2])
  })

  it('drops a fulfillment_line row with no line_item edge rather than crashing', async () => {
    const db = stubDb([
      [{ entityId: 'ful_1' }],
      [instance('ful_1')],
      [
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [{ entityId: 'fl_1' }],
      [instance('fl_1')],
      // fl_1 carries a quantity but no line_item edge - unusable, not a crash.
      [
        {
          entityId: 'fl_1',
          fieldId: 'fld_line_fulfillment',
          relatedEntityId: 'ful_1',
          relatedEntityDefinitionId: 'def_fulfillment',
        },
        { entityId: 'fl_1', fieldId: 'fld_line_quantity', valueNumber: 2 },
      ],
      [],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.[0]?.lines).toEqual([])
  })

  it('reads glPosting and docNumber off the live subject claim, never a stamp field', async () => {
    const db = stubDb([
      [{ entityId: 'ful_1' }],
      [instance('ful_1')],
      [
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [], // no lines
      // `GlPostingSource` joined to `GlPosting` for this fulfillment's subject row.
      [{ sourceId: 'ful_1', glPostingId: 'gp_1', docNumber: 'AUXX-FUL-ORD1F1' }],
    ])

    const result = await readFulfillmentsForOrders(db, {
      organizationId: 'org_1',
      orderIds: ['ord_1'],
    })
    expect(result.get('ord_1')?.[0]).toMatchObject({
      glPosting: 'gp_1',
      docNumber: 'AUXX-FUL-ORD1F1',
    })
  })
})

describe('readFulfillmentsForOrder', () => {
  it('is readFulfillmentsForOrders for a single order id', async () => {
    const db = stubDb([
      [{ entityId: 'ful_1' }],
      [instance('ful_1')],
      [
        {
          entityId: 'ful_1',
          fieldId: 'fld_order',
          relatedEntityId: 'ord_1',
          relatedEntityDefinitionId: 'def_order',
        },
        { entityId: 'ful_1', fieldId: 'fld_sequence', valueNumber: 1 },
      ],
      [],
      [],
    ])
    const result = await readFulfillmentsForOrder(db, { organizationId: 'org_1', orderId: 'ord_1' })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('ful_1')
  })

  it('is empty for an order nothing has shipped against', async () => {
    const db = stubDb([[]])
    const result = await readFulfillmentsForOrder(db, { organizationId: 'org_1', orderId: 'ord_1' })
    expect(result).toEqual([])
  })
})
