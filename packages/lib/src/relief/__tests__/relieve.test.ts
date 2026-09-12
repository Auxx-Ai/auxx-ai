// packages/lib/src/relief/__tests__/relieve.test.ts

/**
 * `relieveFulfillmentLines` (plans/money/tasks/50-batch-inventory-relief.md §1).
 *
 * Every collaborator that touches the database or another module's write lane
 * is mocked - this file is about the ARITHMETIC and the SKIP/FALLBACK/WARN
 * decisions §1.5-§4.2 make, not about `writeStockMovements`,
 * `batchRecalculateQoH` or the roll-up's own SQL, each of which has its own
 * tests. `readPartLedgerAverages` / `readFulfillmentLineRelievedAverages`
 * (`./cost-reads`) are mocked to their documented return shapes rather than
 * exercised for real, since that module is a different agent's surface.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fieldsByAttr: {} as Record<string, { id: string } | undefined>,
  defIds: { stock_movement: 'def_stock_movement', part: 'def_part' } as Record<string, string>,
  ledgerAverages: new Map<string, unknown>(),
  relievedAverages: new Map<string, unknown>(),
  standardCosts: new Map<string, unknown>(),
  writeStockMovements: vi.fn(),
  batchRecalculateQoH: vi.fn(async () => {}),
  recalculateFulfillmentLineQuantityRelievedBatch: vi.fn(async () => {}),
  announceQuietReliefWrites: vi.fn(),
  reliefWriteSession: vi.fn(() => ({ origin: { kind: 'automation' }, mode: { kind: 'quiet' } })),
}))

vi.mock('../../cache', () => ({
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

vi.mock('../../builds', () => ({
  readStandardCost: async (_db: unknown, _orgId: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, { standardCost: number }>()
    for (const id of partIds) {
      const value = h.standardCosts.get(id)
      if (value != null) map.set(id, { standardCost: value as number })
    }
    return ok(map)
  },
}))

vi.mock('../../bom/qoh', () => ({
  batchRecalculateQoH: h.batchRecalculateQoH,
}))

vi.mock('../../field-hooks/post/fulfillment-line-rollups', () => ({
  recalculateFulfillmentLineQuantityRelievedBatch:
    h.recalculateFulfillmentLineQuantityRelievedBatch,
}))

vi.mock('../../stock-movements', async () => {
  const actual =
    await vi.importActual<typeof import('../../stock-movements')>('../../stock-movements')
  return { ...actual, writeStockMovements: h.writeStockMovements }
})

vi.mock('../cost-reads', () => ({
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
  h.fieldsByAttr = { line_item_part: { id: 'f_part' }, part_kind: { id: 'f_kind' } }
  h.ledgerAverages = new Map()
  h.relievedAverages = new Map()
  h.standardCosts = new Map()
  h.reliefWriteSession.mockReturnValue({
    origin: { kind: 'automation' },
    mode: { kind: 'quiet' },
  } as never)
  h.writeStockMovements.mockImplementation(async (_ctx: unknown, inputs: unknown[]) =>
    ok({
      records: (inputs as Array<{ partInstanceId: string }>).map((input, index) => ({
        movementId: `mv_${index}`,
        recordId: `def_stock_movement:mv_${index}`,
        partInstanceId: input.partInstanceId,
        quantity: 0,
        unitCost: 0,
        extendedCost: 0,
        glAccount: null,
        occurredAt: OCCURRED_AT,
      })),
      affectedPartIds: [
        ...new Set((inputs as Array<{ partInstanceId: string }>).map((i) => i.partInstanceId)),
      ],
    })
  )
})

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
      affectedPartIds: [],
      skippedNoPart: 0,
      skippedZeroDelta: 0,
      skippedNoCost: 0,
      fallbackStandardCostPartIds: [],
      negativeQoHPartIds: [],
    })
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('§1.6 - skips a line with no line_item_part and counts it, never guessing', async () => {
    const db = fakeDb({ line_item_part: [] })
    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().skippedNoPart).toBe(1)
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('§1.5 - a delta of zero writes no row', async () => {
    const db = fakeDb({ line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }] })
    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          lineItemId: 'li_1',
          quantity: 3,
          quantityRelieved: 3,
          occurredAt: OCCURRED_AT,
        },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().skippedZeroDelta).toBe(1)
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('§1.5/§3.3 - a positive delta writes a NEGATIVE movement priced at the ledger average', async () => {
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

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
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
    expect(value.fallbackStandardCostPartIds).toEqual([])
    expect(h.writeStockMovements).toHaveBeenCalledTimes(1)
    const [ctx, inputs] = h.writeStockMovements.mock.calls[0]!
    expect(ctx.lane.kind).toBe('quiet')
    expect(inputs).toEqual([
      expect.objectContaining({
        partInstanceId: 'part_1',
        type: 'sale',
        quantity: -3, // -(quantity - quantityRelieved) = -(3 - 0)
        unitCost: 4_000,
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
      relievedQuantity: 12,
      relievedValueMinor: 50_400,
      unitCostMinor: 4_200,
    })

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      // 10 owed, 12 already relieved - a down-revision.
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          lineItemId: 'li_1',
          quantity: 10,
          quantityRelieved: 12,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    const [, inputs] = h.writeStockMovements.mock.calls[0]!
    expect(inputs).toEqual([
      expect.objectContaining({
        partInstanceId: 'part_1',
        quantity: 2, // -(10 - 12) = +2, un-relieving
        unitCost: 4_200,
        glAccount: 'inventory_raw_materials',
      }),
    ])
  })

  it('§3.6 - falls back to part_standard_cost when the ledger average is unusable (QoH <= 0)', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    h.ledgerAverages.set('part_1', {
      partInstanceId: 'part_1',
      valueMinor: 0,
      quantity: 0,
      unitCostMinor: null,
    })
    h.standardCosts.set('part_1', 5_500)

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.fallbackStandardCostPartIds).toEqual(['part_1'])
    const [, inputs] = h.writeStockMovements.mock.calls[0]!
    expect(inputs).toEqual([expect.objectContaining({ unitCost: 5_500 })])
  })

  it('never posts a zero cost - a line with no average and no standard cost is skipped and counted', async () => {
    const db = fakeDb({
      line_item_part: [{ entityId: 'li_1', relatedEntityId: 'part_1' }],
      part_kind: [{ entityId: 'part_1', optionId: 'finished_good' }],
    })
    // No ledger average, no standard cost at all.

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
          lineItemId: 'li_1',
          quantity: 2,
          quantityRelieved: null,
          occurredAt: OCCURRED_AT,
        },
      ],
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().skippedNoCost).toBe(1)
    expect(h.writeStockMovements).not.toHaveBeenCalled()
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

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      // 5 owed against only 2 on the ledger - would go to -3.
      lines: [
        {
          fulfillmentLineId: 'fl_1',
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
    expect(h.writeStockMovements).toHaveBeenCalledTimes(1)
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

    const result = await relieveFulfillmentLines(db, {
      organizationId: ORG,
      userId: USER,
      lines: [
        {
          fulfillmentLineId: 'fl_1',
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
  })
})
