// packages/lib/src/returns/__tests__/salvage-writer.test.ts

/**
 * `writeSalvageMovements` / `reverseSalvageMovement` - step 7 of
 * plans/money/tasks/54-returns.md.
 *
 * Everything that touches the database or another module's write lane is
 * mocked: this file is about WHICH nodes produce a movement, WHAT is on it, and
 * which refusals stop the whole run - not about `writeStockMovements`,
 * `batchRecalculateQoH` or `reverseMovement`, each of which has its own tests.
 *
 * The TREE is real. `buildSalvageTree`, `selectSalvageMovementNodes`,
 * `checkSalvageTree` and `computeSalvageUnitCost` all run unmocked over a real
 * bill-of-materials map, so "only the highest `good` node in a branch writes"
 * is pinned against the actual selection rather than against a stub of it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defIds: { stock_movement: 'def_movement', part: 'def_part' } as Record<string, string>,
  fieldsByAttr: {} as Record<string, { id: string } | undefined>,
  /** Rows the two private `db.select` reads answer with, in call order. */
  selectRows: [] as unknown[][],
  standardCosts: new Map<string, number>(),
  graph: new Map<string, { childId: string; qty: number }[]>(),
  rows: [] as unknown[],
  nodes: [] as unknown[],
  returnLine: {} as Record<string, unknown>,
  partLine: null as unknown,
  handlers: [] as Array<{ options?: { session?: unknown } }>,
  bulkUpdate: vi.fn(async () => ({ updated: 0, errors: [] as unknown[] })),
  writeStockMovements: vi.fn(),
  batchRecalculateQoH: vi.fn(async () => {}),
  publishRecordsChanged: vi.fn(
    async (_service: unknown, _organizationId: string, _payload: { entityDefinitionId: string }) =>
      undefined
  ),
  reverseMovement: vi.fn(),
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
  getCachedEntityDefId: async (_orgId: string, entityType: string) => h.defIds[entityType] ?? null,
}))

vi.mock('../field-context', () => ({
  requireReturnPartLineFieldContext: async () => ({
    returnPartLineDefId: 'def_return_part_line',
    fields: {},
  }),
}))

vi.mock('../reads', () => ({
  requireReturnLine: async () => h.returnLine,
  readReturnPartLines: async () => h.rows,
  readReturnPartLine: async () => h.partLine,
}))

vi.mock('../salvage-reads', () => ({
  assembleSalvageTree: async () => ({
    returnLineId: 'rl_1',
    recordId: 'def_return_line:rl_1',
    rootPartId: 'part_lift',
    returnLineQuantity: h.returnLine.quantity ?? 1,
    nodes: h.nodes,
  }),
}))

vi.mock('../../bom/subpart-graph', () => ({
  loadSubpartGraph: async () => h.graph,
}))

vi.mock('../../bom/qoh', () => ({
  batchRecalculateQoH: h.batchRecalculateQoH,
}))

vi.mock('../../builds', () => ({
  readStandardCost: async (_db: unknown, _orgId: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, { standardCost: number }>()
    for (const id of partIds) {
      const value = h.standardCosts.get(id)
      if (value !== undefined) map.set(id, { standardCost: value })
    }
    return ok(map)
  },
}))

vi.mock('../../stock-movements', async () => {
  const actual =
    await vi.importActual<typeof import('../../stock-movements')>('../../stock-movements')
  return { ...actual, writeStockMovements: h.writeStockMovements }
})

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsChanged: h.publishRecordsChanged,
}))

vi.mock('../../receiving', () => ({
  reverseMovement: h.reverseMovement,
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    bulkUpdate = h.bulkUpdate
    constructor(
      _orgId: string,
      _userId: string,
      _db: unknown,
      _capabilities: unknown,
      public options?: { session?: unknown }
    ) {
      h.handlers.push(this)
    }
  },
}))

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { buildSalvageTree } from '../salvage-tree'
import {
  reverseSalvageMovement,
  type WriteSalvageMovementsResult,
  writeSalvageMovements,
} from '../salvage-writer'
import type { MaterializedSalvageRow, SalvagePartInfo, SalvageStatus } from '../types'

const ORG = 'org_1'
const USER = 'user_1'

/**
 * A lift of one mast (carrying four bolts) and one pump.
 *
 * Deep enough for invariant 1 to have something to shadow, and wide enough for
 * invariant 2's per-parent allowance to be breachable.
 */
const GRAPH = new Map<string, { childId: string; qty: number }[]>([
  [
    'part_lift',
    [
      { childId: 'part_mast', qty: 1 },
      { childId: 'part_pump', qty: 1 },
    ],
  ],
  ['part_mast', [{ childId: 'part_bolt', qty: 4 }]],
])

const PARTS = new Map<string, SalvagePartInfo>([
  ['part_mast', { name: 'Mast assembly', number: 'MAST-1' }],
  ['part_pump', { name: 'Hydraulic pump', number: 'PUMP-1' }],
  ['part_bolt', { name: 'M12 bolt', number: null }],
])

/** A `return_part_line` as `readReturnPartLines` hands it back. */
function row(
  id: string,
  partId: string,
  overrides: Partial<{
    parentId: string | null
    quantity: number
    status: SalvageStatus
    salvagePercent: number
    unitCost: number | null
    movementId: string | null
  }> = {}
) {
  return {
    id,
    recordId: `def_return_part_line:${id}`,
    returnLineId: 'rl_1',
    parentId: overrides.parentId ?? null,
    partId,
    quantity: overrides.quantity ?? 1,
    status: overrides.status ?? 'undecided',
    salvagePercent: overrides.salvagePercent ?? 100,
    sortOrder: null,
    unitCost: overrides.unitCost ?? null,
    movementId: overrides.movementId ?? null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  }
}

/** Install a set of rows, and build the REAL tree they produce. */
function withRows(rows: ReturnType<typeof row>[], returnLineQuantity = 1) {
  h.rows = rows
  h.returnLine = {
    returnLineId: 'rl_1',
    recordId: 'def_return_line:rl_1',
    returnId: 'ret_1',
    partId: 'part_lift',
    quantity: returnLineQuantity,
  }
  h.nodes = buildSalvageTree({
    graph: GRAPH,
    rootPartId: 'part_lift',
    returnLineQuantity,
    rows: rows as unknown as MaterializedSalvageRow[],
    parts: PARTS,
  })
}

/**
 * The two private reads run in a fixed order - `part_kind` first
 * (`readSalvagePartKinds`), then `return_number` (`readReturnNumber`) - so the
 * fake answers by call index, the same shape `relief/__tests__/relieve.test.ts`
 * uses.
 */
function stubDb(): Database {
  let call = 0
  return {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => {
          const rows = h.selectRows[call++] ?? []
          return Object.assign(Promise.resolve(rows), { limit: async () => rows })
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as Database
}

function unwrap(result: { isOk(): boolean; _unsafeUnwrap(): WriteSalvageMovementsResult }) {
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

/** The `StockMovementInput[]` handed to the shared writer on the only call. */
function writtenInputs(): Array<Record<string, unknown>> {
  expect(h.writeStockMovements).toHaveBeenCalledTimes(1)
  return h.writeStockMovements.mock.calls[0]![1] as Array<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.handlers = []
  h.graph = GRAPH
  h.fieldsByAttr = { part_kind: { id: 'f_kind' }, return_number: { id: 'f_number' } }
  h.selectRows = [[{ entityId: 'part_mast', optionId: 'subassembly' }], [{ value: 'RMA-0007' }]]
  h.standardCosts = new Map([
    ['part_mast', 30_000],
    ['part_pump', 20_000],
    ['part_bolt', 500],
  ])
  h.partLine = null
  h.bulkUpdate.mockResolvedValue({ updated: 0, errors: [] })
  h.writeStockMovements.mockImplementation(async (_ctx: unknown, inputs: unknown[]) =>
    ok({
      records: (inputs as Array<{ partInstanceId: string }>).map((input, index) => ({
        movementId: `mv_${index}`,
        recordId: `def_movement:mv_${index}`,
        partInstanceId: input.partInstanceId,
        quantity: 0,
        unitCost: 0,
        extendedCost: 0,
        glAccount: null,
        occurredAt: new Date(),
      })),
      affectedPartIds: [
        ...new Set((inputs as Array<{ partInstanceId: string }>).map((i) => i.partInstanceId)),
      ],
    })
  )
})

describe('writeSalvageMovements - what writes and what does not', () => {
  it('writes nothing when no node is good', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'damaged' })])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.movements).toEqual([])
    expect(result.affectedPartIds).toEqual([])
    expect(h.writeStockMovements).not.toHaveBeenCalled()
    expect(h.batchRecalculateQoH).not.toHaveBeenCalled()
  })

  it('invariant 1 - only the HIGHEST good node in a branch writes', async () => {
    // Mast good, and its bolts also ticked good underneath it. That is ONE
    // recovery, not two: the mast went into inventory whole.
    withRows([
      row('r_mast', 'part_mast', { status: 'good' }),
      row('r_bolt', 'part_bolt', { parentId: 'r_mast', quantity: 4, status: 'good' }),
    ])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]?.partId).toBe('part_mast')
    expect(writtenInputs()).toHaveLength(1)
  })

  it('descends past a damaged parent to recover a good child', async () => {
    withRows([
      row('r_mast', 'part_mast', { status: 'damaged' }),
      row('r_bolt', 'part_bolt', { parentId: 'r_mast', quantity: 4, status: 'good' }),
    ])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.movements.map((movement) => movement.partId)).toEqual(['part_bolt'])
  })

  it('scrap, missing and undecided write nothing - only good does', async () => {
    withRows([
      row('r_mast', 'part_mast', { status: 'scrap' }),
      row('r_pump', 'part_pump', { status: 'good' }),
    ])
    h.selectRows[0] = [{ entityId: 'part_pump', optionId: 'component' }]

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.movements.map((movement) => movement.partId)).toEqual(['part_pump'])
  })

  it('skips a good row of zero units rather than writing an empty movement', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good', quantity: 0 })])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.skippedZeroQuantity).toBe(1)
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('skips a row that already carries a movement - the ledger is append-only', async () => {
    withRows([
      row('r_mast', 'part_mast', { status: 'good', movementId: 'mv_old' }),
      row('r_pump', 'part_pump', { status: 'good' }),
    ])
    h.selectRows[0] = [{ entityId: 'part_pump', optionId: 'component' }]

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(result.skippedAlreadySalvaged).toBe(1)
    expect(result.movements.map((movement) => movement.partId)).toEqual(['part_pump'])
  })
})

describe('writeSalvageMovements - what is on the movement', () => {
  it('never sets adjustSubparts and never sets any link, fulfillmentLine least of all', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good' })])

    await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    const [input] = writtenInputs()
    // 🛑 Not `false` - ABSENT. The contract types it `?: true`, and a flagged
    // row would explode into every leaf subpart AND vanish from the on-hand SUM.
    expect(input).not.toHaveProperty('adjustSubparts')
    expect(input).not.toHaveProperty('links')
  })

  it('is a return_in of a POSITIVE quantity at standard x percent, stamped with the role', async () => {
    // Two lifts back, each carrying one mast, so two masts is within the
    // allowance invariant 2 computes (`bomQuantity x parent quantity`).
    withRows([row('r_mast', 'part_mast', { status: 'good', quantity: 2, salvagePercent: 60 })], 2)

    await writeSalvageMovements(stubDb(), ORG, USER, {
      returnLineId: 'rl_1',
      occurredAt: new Date('2026-10-02T00:00:00.000Z'),
    })

    expect(writtenInputs()[0]).toEqual({
      partInstanceId: 'part_mast',
      type: 'return_in',
      quantity: 2,
      unitCost: 18_000,
      costBasis: 'standard',
      glAccount: 'inventory_raw_materials',
      occurredAt: new Date('2026-10-02T00:00:00.000Z'),
      reason: 'RMA-0007 salvage',
    })
  })

  it('rounds the salvage ONCE and freezes the identical number onto the return part line', async () => {
    h.standardCosts = new Map([['part_mast', 1_499]])
    withRows([row('r_mast', 'part_mast', { status: 'good', salvagePercent: 60 })])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    // 1499 x 60 / 100 = 899.4, kept at a RATE's precision rather than collapsed
    // to a whole cent.
    expect(writtenInputs()[0]?.unitCost).toBe(899.4)
    expect(result.movements[0]?.unitCost).toBe(899.4)
    expect(h.bulkUpdate).toHaveBeenCalledWith([
      {
        recordId: 'def_return_part_line:r_mast',
        values: {
          return_part_line_unit_cost: 899.4,
          return_part_line_movement: 'def_movement:mv_0',
        },
      },
    ])
  })

  it('falls back to a reason that says what the row is when the return has no number yet', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good' })])
    h.selectRows[1] = []

    await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(writtenInputs()[0]?.reason).toBe('Return salvage')
  })
})

describe('writeSalvageMovements - the refusals', () => {
  it('refuses a part with a NULL standard cost, naming the part, and writes nothing', async () => {
    h.standardCosts = new Map()
    withRows([row('r_mast', 'part_mast', { status: 'good' })])

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr() as { reason?: string; message: string }
    expect(error.reason).toBe('missing_standard_cost')
    expect(error.message).toContain('Mast assembly')
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('refuses a part whose standard cost is ZERO - a zero passes every `== null` guard', async () => {
    h.standardCosts = new Map([['part_mast', 0]])
    withRows([row('r_mast', 'part_mast', { status: 'good' })])

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    expect((result._unsafeUnwrapErr() as { reason?: string }).reason).toBe('missing_standard_cost')
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('invariant 2 - refuses when sibling rows exceed what the parent can hold', async () => {
    // One mast holds four bolts; three split rows claiming two each is five too
    // many, and the split button may divide a row but never invent units.
    withRows([
      row('r_mast', 'part_mast', { status: 'good' }),
      row('r_b1', 'part_bolt', { parentId: 'r_mast', quantity: 2, status: 'good' }),
      row('r_b2', 'part_bolt', { parentId: 'r_mast', quantity: 2, status: 'good' }),
      row('r_b3', 'part_bolt', { parentId: 'r_mast', quantity: 5, status: 'good' }),
    ])

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    expect((result._unsafeUnwrapErr() as { reason?: string }).reason).toBe(
      'quantity_exceeds_allowance'
    )
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('refuses a salvage percentage above 100 - salvage is never worth more than new', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good', salvagePercent: 120 })])

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    expect((result._unsafeUnwrapErr() as { reason?: string }).reason).toBe(
      'salvage_percent_out_of_range'
    )
    expect(h.writeStockMovements).not.toHaveBeenCalled()
  })

  it('refuses a salvage percentage of zero - a worthless part is scrap, which writes nothing', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good', salvagePercent: 0 })])

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    expect((result._unsafeUnwrapErr() as { reason?: string }).reason).toBe(
      'salvage_percent_out_of_range'
    )
  })

  it('refuses when a freeze write fails, so no movement is left with nothing pointing at it', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good' })])
    h.bulkUpdate.mockResolvedValue({
      updated: 0,
      errors: [{ recordId: 'def_return_part_line:r_mast', error: 'nope' }],
    })

    const result = await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(result.isErr()).toBe(true)
    // The whole write is inside one transaction, so the caller's rollback is
    // what undoes the movement. Nothing post-commit may have run.
    expect(h.batchRecalculateQoH).not.toHaveBeenCalled()
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
  })
})

describe('writeSalvageMovements - the quiet lane and its obligations', () => {
  it('writes through a declared quiet session, on one handler shared with the movements', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good' })])

    await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    expect(h.handlers).toHaveLength(1)
    const session = h.handlers[0]?.options?.session as { mode?: { kind?: string } }
    expect(session.mode?.kind).toBe('quiet')

    const [ctx] = h.writeStockMovements.mock.calls[0]!
    expect(ctx.lane.kind).toBe('quiet')
    expect(ctx.lane.session).toBe(session)
    expect(ctx.handler).toBe(h.handlers[0])
  })

  it('discharges ONE post-commit recalc, over the affectedPartIds the writer returned', async () => {
    withRows([
      row('r_mast', 'part_mast', { status: 'good' }),
      row('r_pump', 'part_pump', { status: 'good' }),
    ])

    const result = unwrap(
      await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })
    )

    expect(h.batchRecalculateQoH).toHaveBeenCalledTimes(1)
    expect(h.batchRecalculateQoH).toHaveBeenCalledWith(ORG, ['part_mast', 'part_pump'])
    expect(result.affectedPartIds).toEqual(['part_mast', 'part_pump'])
  })

  it('self-announces both the movement rows and the return part line rows', async () => {
    withRows([row('r_mast', 'part_mast', { status: 'good' })])

    await writeSalvageMovements(stubDb(), ORG, USER, { returnLineId: 'rl_1' })

    const defs = h.publishRecordsChanged.mock.calls.map((call) => call[2].entityDefinitionId)
    expect(defs).toEqual(['def_movement', 'def_return_part_line'])
  })
})

describe('reverseSalvageMovement', () => {
  it('reverses the frozen movement and touches nothing else', async () => {
    h.partLine = row('r_mast', 'part_mast', { status: 'good', movementId: 'mv_old' })
    h.reverseMovement.mockResolvedValue(ok({ movementId: 'mv_rev' }))

    const result = await reverseSalvageMovement(stubDb(), ORG, USER, { partLineId: 'r_mast' })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      partLineId: 'r_mast',
      reversedMovementId: 'mv_old',
      movementId: 'mv_rev',
    })
    // Priced at what was frozen, by `reverseMovement` itself - this function
    // supplies no cost of its own, and writes no scrap movement afterwards.
    expect(h.reverseMovement).toHaveBeenCalledWith(expect.anything(), ORG, USER, {
      movementId: 'mv_old',
      reason: 'Salvage decision corrected',
    })
    expect(h.writeStockMovements).not.toHaveBeenCalled()
    expect(h.bulkUpdate).not.toHaveBeenCalled()
  })

  it('refuses a row that never produced a salvage movement', async () => {
    h.partLine = row('r_mast', 'part_mast', { status: 'good' })

    const result = await reverseSalvageMovement(stubDb(), ORG, USER, { partLineId: 'r_mast' })

    expect(result.isErr()).toBe(true)
    expect(h.reverseMovement).not.toHaveBeenCalled()
  })
})
