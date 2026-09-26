// packages/lib/src/inventory/relief/__tests__/relieve.test.ts

/**
 * `relieveFulfillmentLines` (plans/money/tasks/50-batch-inventory-relief.md §1).
 *
 * Every collaborator that touches the database or another module's write lane
 * is mocked - this file is about the ARITHMETIC and the SKIP/WARN
 * decisions §1.5-§4.2 make, not about `writeStockMovementsBatch`,
 * `batchRecalculateQoH` or the roll-up's own SQL, each of which has its own
 * tests. `readPartLedgerAverages` / `readFulfillmentLineRelievedAverages`
 * (`inventory/costing/cost-reads`) are mocked to their documented return shapes rather than
 * exercised for real, since that module is a different agent's surface.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fieldsByAttr: {} as Record<string, { id: string } | undefined>,
  defIds: {
    stock_movement: 'def_stock_movement',
    part: 'def_part',
    fulfillment_line: 'def_fulfillment_line',
  } as Record<string, string>,
  ledgerAverages: new Map<string, unknown>(),
  relievedAverages: new Map<string, unknown>(),
  /** What the `sale` movements say each line has relieved, as the in-tx re-read sees it. */
  relievedQuantities: new Map<string, number>(),
  standardCosts: new Map<string, unknown>(),
  postSpy: vi.fn(async (..._args: unknown[]) => null as unknown),
  writeStockMovementsBatch: vi.fn(),
  batchRecalculateQoH: vi.fn(async () => {}),
  recalculateFulfillmentLineQuantityRelievedBatch: vi.fn(async () => {}),
  announceQuietReliefWrites: vi.fn(),
  reliefWriteSession: vi.fn(() => ({ origin: { kind: 'automation' }, mode: { kind: 'quiet' } })),
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
  deleteWorkItemsAtStage: vi.fn(async () => ({ isOk: () => true })),
  /** The fake subledger the park reads: every row the write double minted, with its basis. */
  ledger: [] as Array<{
    id: string
    partInstanceId: string
    fulfillmentLineId: string | undefined
    costBasis: string | undefined
  }>,
}))

vi.mock('../../../resources/system-records', async () => {
  const actual = await vi.importActual<typeof import('../../../resources/system-records')>(
    '../../../resources/system-records'
  )
  return {
    ...actual,
    // `readPendingMovements` asks for the movements on the offered lines; answer from the fake ledger.
    readSystemRecords: async (
      _db: unknown,
      _org: string,
      _ctx: unknown,
      options: { by?: { in: readonly string[] } }
    ) =>
      h.ledger
        .filter((row) => row.fulfillmentLineId && options.by?.in.includes(row.fulfillmentLineId))
        .map((row) => ({
          id: row.id,
          option: () => row.costBasis ?? null,
          related: (attribute: string) =>
            attribute === 'stock_movement_fulfillment_line'
              ? row.fulfillmentLineId
              : row.partInstanceId,
        })),
  }
})

vi.mock('../../../accounting/work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
  deleteWorkItemsAtStage: h.deleteWorkItemsAtStage,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) => {
        const out: Record<string, { id: string } | undefined> = {}
        for (const attr of attrs) out[attr] = h.fieldsByAttr[attr]
        return out
      },
    }),
  }),
  requireCachedEntityDefId: async (_orgId: string, entityType: string) => {
    const id = h.defIds[entityType]
    if (!id) throw new Error(`no def for ${entityType}`)
    return id
  },
}))

vi.mock('../../costing', () => ({
  readStandardCost: async (_db: unknown, _orgId: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, Record<string, number | null>>()
    for (const id of partIds) {
      const value = h.standardCosts.get(id)
      if (value == null) continue
      map.set(
        id,
        typeof value === 'number'
          ? { standardCost: value, standardLaborCost: null, standardOverheadCost: null }
          : (value as Record<string, number | null>)
      )
    }
    return ok(map)
  },
}))

vi.mock('../../costing/qoh', () => ({
  batchRecalculateQoH: h.batchRecalculateQoH,
}))

vi.mock('../../../field-hooks/post/fulfillment-line-rollups', () => ({
  recalculateFulfillmentLineQuantityRelievedBatch:
    h.recalculateFulfillmentLineQuantityRelievedBatch,
  readRelievedQuantities: async () => h.relievedQuantities,
}))

vi.mock('../../../accounting/ledger/post/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {},
}))

vi.mock('../../movements', async () => {
  const actual = await vi.importActual<typeof import('../../movements')>('../../movements')
  return { ...actual, writeStockMovementsBatch: h.writeStockMovementsBatch }
})

vi.mock('../../costing/cost-reads', () => ({
  readPartLedgerAverages: async () => {
    const { ok } = await import('neverthrow')
    return ok(h.ledgerAverages)
  },
  readFulfillmentLineRelievedAverages: async () => {
    const { ok } = await import('neverthrow')
    return ok(h.relievedAverages)
  },
}))

vi.mock('../write-lane', () => ({
  reliefWriteSession: h.reliefWriteSession,
  announceQuietReliefWrites: h.announceQuietReliefWrites,
}))

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { relieveFulfillmentLines } from '../relieve'

const ORG = 'org_1'
const USER = 'user_1'

function stubDb(): Database {
  return { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as unknown as Database
}

const OCCURRED_AT = new Date('2026-09-03T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldsByAttr = {
    line_item_part: { id: 'f_part' },
    part_kind: { id: 'f_kind' },
    stock_movement_fulfillment_line: { id: 'f_mv_line' },
    stock_movement_cost_basis: { id: 'f_mv_basis' },
    stock_movement_part: { id: 'f_mv_part' },
  }
  h.ledgerAverages = new Map()
  h.relievedAverages = new Map()
  h.relievedQuantities = new Map()
  h.standardCosts = new Map()
  h.ledger = []
  h.reliefWriteSession.mockReturnValue({
    origin: { kind: 'automation' },
    mode: { kind: 'quiet' },
  } as never)
  h.writeStockMovementsBatch.mockImplementation(writeDouble({ costed: false }))
})

/**
 * A `writeStockMovementsBatch` double: mints ids in input order, records every row in
 * the fake ledger, and echoes the input's cost - `null` on a pending row - or,
 * with `costed`, the priced figures a real write would return.
 */
function writeDouble(options: { costed: boolean; glAccount?: string }) {
  return async (_ctx: unknown, inputs: unknown[]) => {
    const typed = inputs as Array<{
      partInstanceId: string
      quantity: number
      unitCost: number | null
      costBasis?: string
      glAccount?: string
      links?: { fulfillmentLineId?: string }
    }>
    const records = typed.map((input, index) => {
      const id = `mv_${index}`
      h.ledger.push({
        id,
        partInstanceId: input.partInstanceId,
        fulfillmentLineId: input.links?.fulfillmentLineId,
        costBasis: input.costBasis,
      })
      const priced = input.unitCost != null && options.costed
      return {
        movementId: id,
        recordId: `def_stock_movement:${id}`,
        partInstanceId: input.partInstanceId,
        quantity: options.costed ? input.quantity : 0,
        unitCost: input.unitCost,
        extendedCost: input.unitCost == null ? null : priced ? input.quantity * input.unitCost : 0,
        glAccount: options.costed ? (options.glAccount ?? input.glAccount ?? null) : null,
        occurredAt: OCCURRED_AT,
      }
    })
    return ok({
      records,
      affectedPartIds: [...new Set(typed.map((input) => input.partInstanceId))],
    })
  }
}

/** `readLineItemParts` and `readPartKindsLocal` both hit `db.select(...).where(...)` directly. */
function fakeDb(byField: {
  line_item_part?: Array<{ entityId: string; relatedEntityId: string }>
  part_kind?: Array<{ entityId: string; optionId: string }>
}): Database {
  // relieve.ts always resolves `line_item_part` (readLineItemParts) before
  // `part_kind` (readPartKindsLocal) - the first raw `db.select` call is
  // always the line-item-part lookup, the second the part-kind lookup.
  const order: Array<keyof typeof byField> = ['line_item_part', 'part_kind']
  let call = 0
  return {
    select: () => ({
      from: () => ({
        where: async () => byField[order[call++]!] ?? [],
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as Database
}

describe('relieveFulfillmentLines', () => {
  it('returns zeroed counts and writes nothing for an empty input', async () => {
    const result = await relieveFulfillmentLines(stubDb(), {
      organizationId: ORG,
      userId: USER,
      lines: [],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      movementIds: [],
      posts: [],
      affectedPartIds: [],
      skippedNoPart: 0,
      skippedZeroDelta: 0,
      skippedNoCost: 0,
      skippedService: 0,
      negativeQoHPartIds: [],
    })
    expect(h.writeStockMovementsBatch).not.toHaveBeenCalled()
  })

  it('§1.6 - skips a line with no line_item_part and counts it, never guessing', async () => {
    const db = fakeDb({ line_item_part: [] })
    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().skippedNoPart).toBe(1)
    expect(h.writeStockMovementsBatch).not.toHaveBeenCalled()
  })

  it('§1.5 - a delta of zero writes no row', async () => {
    const db = fakeDb({ line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }] })
    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: 3,
          occurredAt: OCCURRED_AT,
        },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().skippedZeroDelta).toBe(1)
    expect(h.writeStockMovementsBatch).not.toHaveBeenCalled()
  })

  it('73 §6.2 rule 3 - a positive delta writes a NEGATIVE movement priced at the STANDARD', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    // The ledger average says 4,000 and is deliberately ignored: since 73 the
    // standard is the only price, or the close's qty x standard check fails.
    h.ledgerAverages.set('part_1', {
      partInstanceId: 'part_1',
      valueMinor: 40_000,
      quantity: 10,
      unitCostMinor: 4_000,
    })
    h.standardCosts.set('part_1', 5_500)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.skippedNoCost).toBe(0)
    expect(h.writeStockMovementsBatch).toHaveBeenCalledTimes(1)
    const [ctx, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(ctx.lane.kind).toBe('quiet')
    expect(inputs).toEqual([
      expect.objectContaining({
        partInstanceId: 'part_1',
        type: 'sale',
        quantity: -3, // -(quantity - quantityRelieved) = -(3 - 0)
        unitCost: 5_500,
        costBasis: 'standard',
        glAccount: 'inventory_finished_goods',
        occurredAt: OCCURRED_AT,
        links: { fulfillmentLineId: 'fl_1' },
      }),
    ])
  })

  it('§3.5 - a negative delta (over-relieved) writes a POSITIVE movement priced at what was already relieved', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'component' }],
    })
    h.relievedAverages.set('fl_1', {
      fulfillmentLineId: 'fl_1',
      fulfillmentId: 'ful_1',
      orderId: 'ord_1',
      relievedQuantity: 12,
      relievedValueMinor: 50_400,
      unitCostMinor: 4_200,
    })
    h.relievedQuantities.set('fl_1', 12)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      // 10 owed, 12 already relieved - a down-revision.
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 10,
          quantityRelieved: 12,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    const [, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(inputs).toEqual([
      expect.objectContaining({
        partInstanceId: 'part_1',
        quantity: 2, // -(10 - 12) = +2, un-relieving
        unitCost: 4_200,
        glAccount: 'inventory_raw_materials',
      }),
    ])
  })

  // 73 §6.3's month, the relief line: F = 1 material + 5 labour + 3 overhead =
  // 20; four shipped -> Dr COGS mat 48 / Dr COGS labour 20 / Dr COGS OH 12 /
  // Cr FG 80. The entry builder turns the split into the three legs; this
  // asserts the two figures relief hands it, and that material is the rest.
  it('73 §6.2 rule 3 - hands the posting the labour and overhead of the standard it relieved', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.standardCosts.set('part_1', {
      standardCost: 2_000,
      standardLaborCost: 500,
      standardOverheadCost: 300,
    })
    h.writeStockMovementsBatch.mockImplementation(async (_ctx: unknown, inputs: unknown[]) =>
      ok({
        records: (inputs as Array<{ partInstanceId: string; quantity: number }>).map(
          (input, index) => ({
            movementId: `mv_${index}`,
            recordId: `def_stock_movement:mv_${index}`,
            partInstanceId: input.partInstanceId,
            quantity: input.quantity,
            unitCost: 2_000,
            extendedCost: -8_000,
            glAccount: 'inventory_finished_goods',
            occurredAt: OCCURRED_AT,
          })
        ),
        affectedPartIds: ['part_1'],
      })
    )

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 4,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    const [, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(inputs).toEqual([expect.objectContaining({ unitCost: 2_000, costBasis: 'standard' })])
    const posted = h.postSpy.mock.calls[0]![1] as { cogsSplit: unknown }
    expect(posted.cogsSplit).toEqual({ laborMinor: 2_000, overheadMinor: 1_200 })
  })

  it('an un-relief carries no split - it is priced at what the line was relieved at', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.standardCosts.set('part_1', {
      standardCost: 2_000,
      standardLaborCost: 500,
      standardOverheadCost: 300,
    })
    h.relievedAverages.set('fl_1', { fulfillmentLineId: 'fl_1', unitCostMinor: 4_200 })
    h.relievedQuantities.set('fl_1', 12)
    h.writeStockMovementsBatch.mockImplementation(async (_ctx: unknown, inputs: unknown[]) =>
      ok({
        records: (inputs as Array<{ partInstanceId: string }>).map((input, index) => ({
          movementId: `mv_${index}`,
          recordId: `def_stock_movement:mv_${index}`,
          partInstanceId: input.partInstanceId,
          quantity: 2,
          unitCost: 4_200,
          extendedCost: 8_400,
          glAccount: 'inventory_finished_goods',
          occurredAt: OCCURRED_AT,
        })),
        affectedPartIds: ['part_1'],
      })
    )

    await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 10,
          quantityRelieved: 12,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    const posted = h.postSpy.mock.calls[0]![1] as { cogsSplit: unknown }
    expect(posted.cogsSplit).toEqual({ laborMinor: 0, overheadMinor: 0 })
  })

  it('111 Q18 - a line whose part has no standard writes a PENDING sale with no cost, and QoH moves', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    // No standard cost at all, and since 73 there is no average behind it.

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ skippedNoCost: 1, movementIds: ['mv_0'] })
    const [, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(inputs).toEqual([
      expect.objectContaining({
        quantity: -2,
        unitCost: null,
        costBasis: 'pending',
        glAccount: 'inventory_finished_goods',
        links: { fulfillmentLineId: 'fl_1' },
      }),
    ])
    // The row carries no cost keys at all - never a 0 - and is never offered to the builder.
    expect(inputs[0]).not.toHaveProperty('extendedCost')
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.batchRecalculateQoH).toHaveBeenCalledWith(ORG, ['part_1'])
    expect(h.recalculateFulfillmentLineQuantityRelievedBatch).toHaveBeenCalledWith(ORG, ['fl_1'])
  })

  it('111 Q18 - a down-delta on a line relieved while pending writes a pending positive row', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    // The standard exists now, but the line's earlier rows are pending, so it has no relieved average.
    h.standardCosts.set('part_1', 4_000)
    h.relievedQuantities.set('fl_1', 5)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: 5,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ skippedNoCost: 1, movementIds: ['mv_0'] })
    const [, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(inputs).toEqual([
      expect.objectContaining({ quantity: 2, unitCost: null, costBasis: 'pending' }),
    ])
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({ sourceId: 'ful_1', stage: 'price', externalRef: 'part_1' })
    )
  })

  it('111 Q18 - a dispatch mixing a priced and a pending line posts the priced row only', async () => {
    const db = fakeDb({
      line_item_part: [
        { entityId: 'li_1', relatedEntityId: 'part_1' },
        { entityId: 'li_2', relatedEntityId: 'part_2' },
      ],
      part_kind: [
        { entityId: 'part_1', optionId: 'finished_good' },
        { entityId: 'part_2', optionId: 'finished_good' },
      ],
    })
    h.standardCosts.set('part_1', 1_000)
    h.writeStockMovementsBatch.mockImplementation(
      writeDouble({ costed: true, glAccount: 'inventory_finished_goods' })
    )
    const line = (id: string, lineItemId: string) => ({
      fulfillmentLineId: id,
      fulfillmentId: 'ful_1',
      orderId: 'ord_1',
      lineItemId,
      quantity: 3,
      quantityRelieved: null,
      occurredAt: OCCURRED_AT,
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [line('fl_1', 'li_1'), line('fl_2', 'li_2')],
    })

    expect(result._unsafeUnwrap()).toMatchObject({
      skippedNoCost: 1,
      movementIds: ['mv_0', 'mv_1'],
    })
    expect(h.postSpy).toHaveBeenCalledTimes(1)
    const posted = h.postSpy.mock.calls[0]![1] as { movements: Array<{ id: string }> }
    expect(posted.movements.map((movement) => movement.id)).toEqual(['mv_0'])
    // The dispatch still parks: its pending row waits for the pricer.
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceId: 'ful_1',
        stage: 'price',
        externalRef: 'part_2',
        detail: { partIds: ['part_2'], pendingMovementIds: ['mv_1'] },
      })
    )
  })

  it('111 Q18 - a re-run at zero delta does not clear a dispatch whose earlier rows are still pending', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.ledger.push({
      id: 'mv_earlier',
      partInstanceId: 'part_1',
      fulfillmentLineId: 'fl_1',
      costBasis: 'pending',
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: 2,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ skippedZeroDelta: 1, movementIds: [] })
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: [],
      stage: 'price',
    })
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceId: 'ful_1',
        stage: 'price',
        detail: { partIds: ['part_1'], pendingMovementIds: ['mv_earlier'] },
      })
    )
  })

  it('task 100 / 111 Q21 - parks a dispatch with an unpriced part at stage price and clears the ones that relieved', async () => {
    const db = fakeDb({
      line_item_part: [
        { entityId: 'li_1', relatedEntityId: 'part_1' },
        { entityId: 'li_2', relatedEntityId: 'part_2' },
      ],
    })
    h.standardCosts.set('part_2', 4_000)
    const line = (id: string, fulfillmentId: string, lineItemId: string) => ({
      fulfillmentLineId: id,
      fulfillmentId,
      orderId: 'ord_1',
      lineItemId,
      quantity: 1,
      quantityRelieved: null,
      occurredAt: OCCURRED_AT,
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [line('fl_1', 'ful_1', 'li_1'), line('fl_2', 'ful_2', 'li_2')],
    })

    expect(result.isOk()).toBe(true)
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_2'],
      stage: 'price',
    })
    expect(h.upsertWorkItem).toHaveBeenCalledTimes(1)
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceKind: 'fulfillment',
        sourceId: 'ful_1',
        stage: 'price',
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: 'part_1',
        detail: { partIds: ['part_1'], pendingMovementIds: ['mv_0'] },
      })
    )
  })

  it('103 §5a - a $0 standard relieves at $0, posts nothing and clears the park', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.standardCosts.set('part_1', 0)
    h.writeStockMovementsBatch.mockImplementation(
      writeDouble({ costed: true, glAccount: 'inventory_finished_goods' })
    )

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ skippedNoCost: 0, movementIds: ['mv_0'] })
    const [, inputs] = h.writeStockMovementsBatch.mock.calls[0]!
    expect(inputs).toEqual([expect.objectContaining({ quantity: -2, unitCost: 0 })])
    // A zero-amount entry is refused by the builder, so the document is never offered to it.
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.recalculateFulfillmentLineQuantityRelievedBatch).toHaveBeenCalledWith(ORG, ['fl_1'])
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
      stage: 'price',
    })
  })

  it('107-D10 - a service line writes no movement, is counted, and never parks', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_svc' }],
      part_kind: [{ entityId: 'part_svc', optionId: 'service' }],
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ skippedService: 1, skippedNoCost: 0 })
    expect(h.writeStockMovementsBatch).not.toHaveBeenCalled()
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
      stage: 'price',
    })
  })

  it('107-D10 - a dispatch mixing a service and an unpriced good parks only on the good', async () => {
    const db = fakeDb({
      line_item_part: [
        { entityId: 'li_1', relatedEntityId: 'part_svc' },
        { entityId: 'li_2', relatedEntityId: 'part_good' },
      ],
      part_kind: [
        { entityId: 'part_svc', optionId: 'service' },
        { entityId: 'part_good', optionId: 'finished_good' },
      ],
    })
    const line = (id: string, lineItemId: string) => ({
      fulfillmentLineId: id,
      fulfillmentId: 'ful_1',
      orderId: 'ord_1',
      lineItemId,
      quantity: 1,
      quantityRelieved: null,
      occurredAt: OCCURRED_AT,
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [line('fl_1', 'li_1'), line('fl_2', 'li_2')],
    })

    expect(result.isOk()).toBe(true)
    // The service line has no row at all; the good is written pending.
    expect(result._unsafeUnwrap()).toMatchObject({
      skippedService: 1,
      skippedNoCost: 1,
      movementIds: ['mv_0'],
    })
    expect(h.upsertWorkItem).toHaveBeenCalledTimes(1)
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceId: 'ful_1',
        stage: 'price',
        reasonCode: 'STANDARD_COST_MISSING',
        externalRef: 'part_good',
        detail: { partIds: ['part_good'], pendingMovementIds: ['mv_0'] },
      })
    )
  })

  it('§4.2 - warns and reports a part this run leaves at negative QoH, without refusing', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.ledgerAverages.set('part_1', {
      partInstanceId: 'part_1',
      valueMinor: 8_000,
      quantity: 2,
      unitCostMinor: 4_000,
    })
    h.standardCosts.set('part_1', 4_000)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      // 5 owed against only 2 on the ledger - would go to -3.
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 5,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().negativeQoHPartIds).toEqual(['part_1'])
    // Never refuses - the movement still writes.
    expect(h.writeStockMovementsBatch).toHaveBeenCalledTimes(1)
  })

  it('discharges both post-commit obligations and announces the movement rows', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.ledgerAverages.set('part_1', {
      partInstanceId: 'part_1',
      valueMinor: 40_000,
      quantity: 10,
      unitCostMinor: 4_000,
    })
    h.standardCosts.set('part_1', 4_000)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          fulfillmentId: 'ful_1',
          orderId: 'ord_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    expect(h.batchRecalculateQoH).toHaveBeenCalledWith(ORG, ['part_1'])
    expect(h.recalculateFulfillmentLineQuantityRelievedBatch).toHaveBeenCalledWith(ORG, ['fl_1'])
    expect(h.announceQuietReliefWrites).toHaveBeenCalledWith(ORG, 'def_stock_movement', ['mv_0'])
    expect(h.announceQuietReliefWrites).toHaveBeenCalledWith(ORG, 'def_part', ['part_1'])
    expect(h.announceQuietReliefWrites).toHaveBeenCalledWith(ORG, 'def_fulfillment_line', ['fl_1'])
  })
})

describe('each relief run is its own document', () => {
  const pricedLine = {
    fulfillmentLineId: 'fl_1',
    fulfillmentId: 'ful_1',
    orderId: 'ord_1',
    lineItemId: 'li_1',
    quantity: 3,
    quantityRelieved: null,
    occurredAt: OCCURRED_AT,
  }

  function pricedDb(): Database {
    h.standardCosts.set('part_1', 1_000)
    h.writeStockMovementsBatch.mockImplementation(
      writeDouble({ costed: true, glAccount: 'inventory_finished_goods' })
    )
    return fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
  }

  it("claims the run's first movement, with the fulfillment and the order as parents", async () => {
    const db = pricedDb()
    await relieveFulfillmentLines(db, { organizationId: ORG, userId: USER, lines: [pricedLine] })

    const posted = h.postSpy.mock.calls[0]![1] as { subject: unknown; parents: unknown }
    expect(posted.subject).toEqual({ sourceKind: 'stock_movement', sourceId: 'mv_0' })
    expect(posted.parents).toEqual([
      { sourceKind: 'fulfillment', sourceId: 'ful_1' },
      { sourceKind: 'order', sourceId: 'ord_1' },
    ])
  })

  it('refuses a run whose lines another run relieved since they were read, and refreshes the roll-up', async () => {
    const db = pricedDb()
    // The stored roll-up says nothing was relieved; the movements say all three were.
    h.relievedQuantities.set('fl_1', 3)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [pricedLine],
    })

    expect(result.isErr()).toBe(true)
    expect(h.writeStockMovementsBatch).not.toHaveBeenCalled()
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.recalculateFulfillmentLineQuantityRelievedBatch).toHaveBeenCalledWith(ORG, ['fl_1'])
  })

  it('never lets a run that wrote movements settle for an existing entry', async () => {
    const db = pricedDb()
    h.postSpy.mockResolvedValueOnce({ status: 'already_posted', glPostingId: 'gp_other' })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [pricedLine],
    })

    expect(result.isErr()).toBe(true)
    expect(h.announceQuietReliefWrites).not.toHaveBeenCalled()
  })
})

// The posting seam has its own test (`postings/__tests__/post-inventory-movement.test.ts`);
// this file is about the movements. `vi.mock` is hoisted, so placement is free.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  postInventoryMovementInTx: (...args: unknown[]) => h.postSpy(...args),
  exportInventoryMovement: async () => null,
  inventoryTxnDate: (day: Date) => day.toISOString().slice(0, 10),
  reverseInventoryMovementPosting: async () => null,
  reversePostingForMovement: async () => null,
  linkMovementsToPosting: async () => undefined,
}))
