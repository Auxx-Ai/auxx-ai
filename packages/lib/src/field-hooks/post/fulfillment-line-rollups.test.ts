// packages/lib/src/field-hooks/post/fulfillment-line-rollups.test.ts
//
// `fulfillment_line_quantity_relieved` is declared `creatable: false, updatable: false,
// computed: true` - unwritable by a human by construction - so if this module is not its
// writer it is NULL forever, exactly the failure `purchase-order-line-rollups.test.ts`
// pins for the buy side.
//
// The SQL-level exclusion of `return_in` movements (brief §1's 🛑) cannot be pinned by the
// FIFO-queue mock this file uses, because that mock trusts whatever total is queued rather
// than executing the query's join predicates. That exclusion is pinned separately in
// `fulfillment-line-rollups-scope.test.ts`, which runs the real query against fixture rows.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
  // The two shapes the module asks the db for, in call order.
  dbResults: [] as unknown[][],
}))

/** Chainable drizzle stub - resolves to the next queued result set. */
function makeChain() {
  const result = h.dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'groupBy']) {
    chain[key] = () => chain
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

vi.mock('@auxx/database', () => ({
  database: { select: () => makeChain() },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
    CustomField: { id: 'id', systemAttribute: 'systemAttribute' },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: () => 'NUMBER' }))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import type { EntityTriggerEvent } from '../types'
import {
  FULFILLMENT_LINE_RELIEF_ATTRS,
  recalculateFulfillmentLineQuantityRelieved,
  recalculateFulfillmentLineQuantityRelievedBatch,
  recalculateFulfillmentLineRelieved,
} from './fulfillment-line-rollups'

const LINE = 'fline-1'

function event(
  values: Record<string, unknown>,
  overrides: Partial<EntityTriggerEvent> = {}
): EntityTriggerEvent {
  return {
    action: 'created',
    entitySlug: 'stock-movements',
    entityType: '',
    entityDefinitionId: 'smdef',
    entityInstanceId: 'sm-1',
    organizationId: 'org_1',
    userId: 'usr_1',
    values,
    ...overrides,
  } as unknown as EntityTriggerEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
  h.bySystemAttributes.mockResolvedValue({
    stock_movement_quantity: { id: 'fld-qty', type: 'NUMBER' },
    stock_movement_type: { id: 'fld-type', type: 'SINGLE_SELECT' },
    stock_movement_fulfillment_line: { id: 'fld-line', type: 'RELATIONSHIP' },
    fulfillment_line_quantity_relieved: { id: 'fld-relieved', type: 'NUMBER' },
  })
  h.createFieldValueContext.mockReturnValue({ organizationId: 'org_1' })
  h.requireCachedEntityDefId.mockResolvedValue('flinedef')
  h.setValueWithType.mockResolvedValue([])
  h.publishFieldValueUpdates.mockResolvedValue(undefined)
})

describe('the attribute names this module is built on', () => {
  it('names the sell-side fields, never the buy-side ones', () => {
    expect(FULFILLMENT_LINE_RELIEF_ATTRS).toEqual({
      quantity: 'stock_movement_quantity',
      type: 'stock_movement_type',
      lineRel: 'stock_movement_fulfillment_line',
      target: 'fulfillment_line_quantity_relieved',
    })
  })
})

describe('recalculateFulfillmentLineQuantityRelieved - the sign', () => {
  it('negates a negative raw sum - a sale ships units out and relieved counts them positive', async () => {
    // A single -5 sale movement.
    h.dbResults.push([{ total: '-5' }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recordId: `flinedef:${LINE}`,
        fieldId: 'fld-relieved',
        value: { type: 'number', value: 5 },
      })
    )
  })

  it('nets a relief and an un-relieving correction - sum stays signed correctly', async () => {
    // -5 (the original relief) + 2 (a correction that gives some back) = -3 raw,
    // so 3 units remain relieved. Getting the negation backwards here would
    // write -3, which reads as "the line owes 3 units back to stock".
    h.dbResults.push([{ total: '-3' }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 3 } })
    )
  })

  it('writes 0 rather than skipping when the last sale movement is deleted', async () => {
    h.dbResults.push([{ total: '0' }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 0 } })
    )
  })
})

describe('recalculateFulfillmentLineQuantityRelieved - the stored total short-circuit', () => {
  it('writes nothing when the line already holds the (negated) total', async () => {
    // Raw sum -5, stored 5 - they already agree once the sign is applied.
    h.dbResults.push([{ total: '-5', current: 5 }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('🛑 writes when the stored total could not be read - fail SAFE, never the other way round', async () => {
    h.dbResults.push([{ total: '-5', current: null }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 5 } })
    )
  })

  it('writes when a stored total of zero differs from the new one', async () => {
    h.dbResults.push([{ total: '-2', current: 0 }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).toHaveBeenCalled()
  })

  it('does not write a zero back over a stored zero when the last movement goes', async () => {
    h.dbResults.push([{ total: '0', current: 0 }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('recalculateFulfillmentLineQuantityRelieved - missing fields', () => {
  it('writes nothing when the org lacks one of the four fields', async () => {
    h.bySystemAttributes.mockResolvedValue({
      stock_movement_quantity: { id: 'fld-qty', type: 'NUMBER' },
      // stock_movement_type missing
      stock_movement_fulfillment_line: { id: 'fld-line', type: 'RELATIONSHIP' },
      fulfillment_line_quantity_relieved: { id: 'fld-relieved', type: 'NUMBER' },
    })

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('recalculateFulfillmentLineQuantityRelieved - realtime', () => {
  it('publishes the negated total, not the raw sum', async () => {
    h.dbResults.push([{ total: '-7' }])

    await recalculateFulfillmentLineQuantityRelieved('org_1', LINE)

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2]
    expect(entries).toEqual([expect.objectContaining({ value: { type: 'number', value: 7 } })])
  })
})

describe('the batched roll-up', () => {
  const LINES = ['fl_1', 'fl_2', 'fl_3']

  /** The two reads the batch makes: the grouped SUM, then the stored totals. */
  function queueBatchReads(
    // `readTotalsByLine` already negates per line, so these are the RELIEVED
    // (post-negation) totals the batch's grouped query is set up to return.
    relieved: Array<[string, number]>,
    stored: Array<[string, number | null]>
  ) {
    h.dbResults.push(
      relieved.map(([lineId, total]) => ({ lineId, total: String(-total) })),
      stored.map(([entityId, valueNumber]) => ({ entityId, valueNumber }))
    )
  }

  it('reads every line in TWO queries, not two per line', async () => {
    const before = h.dbResults.length
    queueBatchReads(
      LINES.map((id, i) => [id, i + 1] as [string, number]),
      []
    )
    expect(h.dbResults.length - before).toBe(2)

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', LINES)

    expect(h.setValueWithType).toHaveBeenCalledTimes(3)
  })

  it('writes only the lines whose relieved total actually moved', async () => {
    queueBatchReads(
      [
        ['fl_1', 5],
        ['fl_2', 9],
        ['fl_3', 2],
      ],
      [
        ['fl_1', 5],
        ['fl_2', 4],
        ['fl_3', 2],
      ]
    )

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', LINES)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'flinedef:fl_2', value: { type: 'number', value: 9 } })
    )
  })

  it('reads a line with no sale movements as zero rather than dropping it', async () => {
    queueBatchReads([['fl_1', 5]], [['fl_2', 3]])

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', LINES)

    // fl_1 moves to 5; fl_2 falls back to 0; fl_3 has neither a total nor a
    // stored value, and an unreadable stored value always writes.
    expect(h.setValueWithType).toHaveBeenCalledTimes(3)
    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'flinedef:fl_2', value: { type: 'number', value: 0 } })
    )
  })

  it('derives nothing when no line moved', async () => {
    queueBatchReads(
      [
        ['fl_1', 5],
        ['fl_2', 9],
        ['fl_3', 1],
      ],
      [
        ['fl_1', 5],
        ['fl_2', 9],
        ['fl_3', 1],
      ]
    )

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', LINES)

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('publishes every changed line in ONE realtime call', async () => {
    queueBatchReads(
      [
        ['fl_1', 5],
        ['fl_2', 9],
      ],
      []
    )

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', LINES)

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    expect(h.publishFieldValueUpdates.mock.calls[0]?.[2]).toHaveLength(3)
  })

  it('dedupes a line that appears twice in the set', async () => {
    h.dbResults.push([{ total: '-8', current: null }])

    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', [LINE, LINE])

    // One line means the single-line path, which is one query rather than two.
    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty set', async () => {
    await recalculateFulfillmentLineQuantityRelievedBatch('org_1', [])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('recalculateFulfillmentLineRelieved - the create/delete trigger', () => {
  it('re-SUMs the line named in the threaded event values', async () => {
    h.dbResults.push([{ total: '-4' }])

    await recalculateFulfillmentLineRelieved(event({ stock_movement_fulfillment_line: LINE }))

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: `flinedef:${LINE}`, value: { type: 'number', value: 4 } })
    )
  })

  it('accepts a RecordId-shaped relationship value as well as a bare instance id', async () => {
    h.dbResults.push([{ total: '-4' }])

    await recalculateFulfillmentLineRelieved(
      event({ stock_movement_fulfillment_line: `flinedef:${LINE}` })
    )

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: `flinedef:${LINE}` })
    )
  })

  it('falls back to the movement’s own field value when the event carried none - the delete path', async () => {
    h.dbResults.push([{ relatedEntityId: LINE }]) // the fallback lookup
    h.dbResults.push([{ total: '-1' }]) // the SUM

    await recalculateFulfillmentLineRelieved(event({}, { action: 'deleted' }))

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { type: 'number', value: 1 } })
    )
  })

  it('is a silent no-op for a movement with no fulfillment line - a receipt, an adjustment, a build', async () => {
    h.dbResults.push([]) // fallback lookup finds nothing

    await recalculateFulfillmentLineRelieved(event({}))

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
