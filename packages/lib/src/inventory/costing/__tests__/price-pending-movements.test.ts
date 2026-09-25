// packages/lib/src/inventory/costing/__tests__/price-pending-movements.test.ts
//
// The pricer (111 Q18/Q22), through the real document poster, the real
// `postInventoryMovementInTx` and the real entry builder, down to a stubbed
// `postEntryInTx`: what a first standard values, what it posts, and what it
// leaves alone. The subledger is a fake `h.ledger` the fill writes onto.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LedgerRow {
  id: string
  partId: string
  type: string
  quantity: number
  unitCost: number | null
  extendedCost: number | null
  costBasis: string | null
  glAccount: string | null
  occurredAt: string
  fulfillmentLineId?: string
  buildId?: string
}

const h = vi.hoisted(() => ({
  ledger: [] as LedgerRow[],
  standards: new Map<
    string,
    { standardCost: number; labor: number | null; overhead: number | null }
  >(),
  lineFulfillment: new Map<string, string>(),
  fulfillmentOrder: new Map<string, string>(),
  workItems: [] as { sourceId: string; detail: Record<string, unknown> }[],
  accountingEnabled: true,
  settings: {
    'accounting.bookTimeZone': 'UTC',
    'accounting.cutoffPeriod': null,
  } as Record<string, string | null>,
  postEntryInTx: vi.fn(
    async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
      status: 'posted',
      glPostingId: 'gp_1',
    })
  ),
  fillPendingCost: vi.fn(),
  deleteWorkItemsAtStage: vi.fn(async () => ({ isOk: () => true })),
  finishPricedBuild: vi.fn(),
}))

vi.mock('@auxx/database', () => ({
  schema: {
    AccountingWorkItem: {
      organizationId: 'organizationId',
      sourceKind: 'sourceKind',
      sourceId: 'sourceId',
      stage: 'stage',
      detail: 'detail',
    },
  },
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => 'user_system' }),
}))
vi.mock('../../../accounting/work-items/write', () => ({
  deleteWorkItemsAtStage: h.deleteWorkItemsAtStage,
}))
vi.mock('../../../accounting/sales/fulfillments/fields', () => ({
  loadFulfillmentFieldContext: async () => ({
    fulfillment: { defId: 'def_ful', fields: {} },
    line: { defId: 'def_line', fields: {} },
  }),
}))
vi.mock('../../../resources/system-records', () => ({
  systemFields: async () => ({ defId: 'def_mv', fields: {} }),
  findSystemRecordIdsByValue: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    criteria: Array<{ attribute: string; option?: string[]; related?: string[] }>
  ) => {
    const rows = h.ledger.filter((row) =>
      criteria.every((criterion) => {
        if (criterion.attribute === 'stock_movement_cost_basis')
          return criterion.option!.includes(row.costBasis ?? '')
        if (criterion.attribute === 'stock_movement_part')
          return criterion.related!.includes(row.partId)
        if (criterion.attribute === 'stock_movement_build')
          return criterion.related!.includes(row.buildId ?? '')
        return false
      })
    )
    return new Map([['key', rows.map((row) => row.id)]])
  },
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    ctx: { defId: string },
    options: { ids: string[] }
  ) =>
    options.ids.flatMap((id): unknown[] => {
      if (ctx.defId === 'def_line') {
        const fulfillmentId = h.lineFulfillment.get(id)
        return fulfillmentId ? [{ id, related: () => fulfillmentId }] : []
      }
      if (ctx.defId === 'def_ful') {
        const orderId = h.fulfillmentOrder.get(id)
        return orderId ? [{ id, related: () => orderId }] : []
      }
      const row = h.ledger.find((candidate) => candidate.id === id)
      if (!row) return []
      return [
        {
          id,
          createdAt: new Date(row.occurredAt),
          related: (attribute: string) =>
            attribute === 'stock_movement_part'
              ? row.partId
              : attribute === 'stock_movement_fulfillment_line'
                ? (row.fulfillmentLineId ?? null)
                : attribute === 'stock_movement_build'
                  ? (row.buildId ?? null)
                  : null,
          option: (attribute: string) =>
            attribute === 'stock_movement_type' ? row.type : row.costBasis,
          number: (attribute: string) =>
            attribute === 'stock_movement_quantity'
              ? row.quantity
              : attribute === 'stock_movement_unit_cost'
                ? row.unitCost
                : attribute === 'stock_movement_extended_cost'
                  ? row.extendedCost
                  : null,
          text: () => row.glAccount,
          date: () => row.occurredAt,
        },
      ]
    }),
}))
vi.mock('../../movements/fill-pending-cost', () => ({ fillPendingCost: h.fillPendingCost }))
vi.mock('../standard-cost-queries', () => ({
  readStandardCost: async (_db: unknown, _org: string, partIds: string[]) => ({
    isErr: () => false,
    value: new Map(
      partIds.flatMap((id) => {
        const standard = h.standards.get(id)
        return standard
          ? [
              [
                id,
                {
                  partId: id,
                  standardCost: standard.standardCost,
                  standardMaterialCost: standard.standardCost,
                  standardLaborCost: standard.labor,
                  standardOverheadCost: standard.overhead,
                  effectiveAt: null,
                },
              ],
            ]
          : []
      })
    ),
  }),
}))
vi.mock('../../builds/price-build', () => ({ finishPricedBuild: h.finishPricedBuild }))
vi.mock('../../builds/build-queries', () => ({
  getBuild: async () => ({ isErr: () => false, value: null }),
  readBuildMovements: async () => [],
  requireBuildMovementContext: async () => ({}),
}))
// `postInventoryMovementInTx` is real; its own collaborators are stubbed as in its test.
vi.mock('../../../accounting/ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => h.accountingEnabled,
}))
vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => h.settings,
}))
vi.mock('../../../accounting/ledger/post/post-entry', () => ({
  postEntryInTx: h.postEntryInTx,
  exportPostedEntry: async () => ({ status: 'posted' as const }),
}))
vi.mock('../../../accounting/ledger/post/reverse-entry', () => ({ reverseEntry: vi.fn() }))
vi.mock('../../../accounting/ledger/reads/list-postings', () => ({
  listPostingsForSource: async () => ({ isErr: () => false, value: [] }),
}))
vi.mock('../../../accounting/ledger/reads/read-posting', () => ({
  readPostingLineSourceIds: async () => ({ isErr: () => false, value: [] }),
}))

import { pricePendingMovements } from '../price-pending-movements'

const ORG = 'org_1'
const TX = { marker: 'tx' }
const db = {
  transaction: async (run: (tx: unknown) => unknown) => run(TX),
  select: () => ({ from: () => ({ where: async () => h.workItems }) }),
} as never

function pending(
  id: string,
  partId: string,
  type: string,
  quantity: number,
  extra: Partial<LedgerRow> = {}
): LedgerRow {
  return {
    id,
    partId,
    type,
    quantity,
    unitCost: null,
    extendedCost: null,
    costBasis: 'pending',
    glAccount: 'inventory_finished_goods',
    occurredAt: '2026-08-18T12:00:00.000Z',
    ...extra,
  }
}

interface PostedEntry {
  txnDate: string
  lines: Array<{ accountRole: string; direction: string; amount: number }>
}

function postedEntries(): Array<{ entry: PostedEntry; sources: Array<Record<string, string>> }> {
  return h.postEntryInTx.mock.calls.map(
    (call) => call[1] as unknown as { entry: PostedEntry; sources: Array<Record<string, string>> }
  )
}

function leg(entry: PostedEntry, role: string) {
  return entry.lines.find((line) => line.accountRole === role)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ledger = []
  h.workItems = []
  h.accountingEnabled = true
  h.settings = { 'accounting.bookTimeZone': 'UTC', 'accounting.cutoffPeriod': null }
  h.standards = new Map([['part_a', { standardCost: 1_000, labor: 200, overhead: 100 }]])
  h.lineFulfillment = new Map([
    ['line_1', 'ful_1'],
    ['line_2', 'ful_1'],
    ['line_9', 'ful_9'],
  ])
  h.fulfillmentOrder = new Map([
    ['ful_1', 'ord_1'],
    ['ful_9', 'ord_9'],
  ])
  // The fill values the fake subledger in place, as the real one does.
  h.fillPendingCost.mockImplementation(
    async (_db: unknown, _org: string, fills: Array<{ movementId: string; unitCost: number }>) => ({
      isErr: () => false,
      value: fills.map((fill) => {
        const row = h.ledger.find((candidate) => candidate.id === fill.movementId)!
        row.unitCost = fill.unitCost
        row.extendedCost = Math.round(fill.unitCost * row.quantity) || 0
        row.costBasis = 'standard'
        return {
          movementId: row.id,
          partInstanceId: row.partId,
          quantity: row.quantity,
          unitCost: row.unitCost,
          extendedCost: row.extendedCost,
          glAccount: row.glAccount,
          occurredAt: new Date(row.occurredAt),
        }
      }),
    })
  )
  h.finishPricedBuild.mockImplementation(async (_db: unknown, _org: string, buildId: string) => ({
    finished: !h.ledger.some((row) => row.buildId === buildId && row.costBasis === 'pending'),
    post: null,
  }))
})

describe('a first standard values every pending row of the part', () => {
  it('fills each row at the standard and posts one sale entry per dispatch, dated the ship date, with the COGS split', async () => {
    h.ledger = [
      pending('mv_1', 'part_a', 'sale', -2, { fulfillmentLineId: 'line_1' }),
      pending('mv_2', 'part_a', 'sale', -1, { fulfillmentLineId: 'line_2' }),
      pending('mv_3', 'part_a', 'sale', -4, {
        fulfillmentLineId: 'line_9',
        occurredAt: '2026-08-20T23:30:00.000Z',
      }),
    ]

    const result = await pricePendingMovements(db, ORG, ['part_a'])

    expect(result._unsafeUnwrap()).toMatchObject({
      pricedMovementIds: ['mv_1', 'mv_2', 'mv_3'],
      unpricedPartIds: [],
      documentsPosted: 2,
      documentsFailed: 0,
    })
    expect(h.fillPendingCost).toHaveBeenCalledWith(db, ORG, [
      { movementId: 'mv_1', unitCost: 1_000 },
      { movementId: 'mv_2', unitCost: 1_000 },
      { movementId: 'mv_3', unitCost: 1_000 },
    ])
    expect(h.ledger.map((row) => row.extendedCost)).toEqual([-2_000, -1_000, -4_000])

    const [first, second] = postedEntries()
    expect(first!.entry.txnDate).toBe('2026-08-18')
    expect(first!.sources).toEqual([
      { sourceKind: 'stock_movement', sourceId: 'mv_1', linkRole: 'subject' },
      { sourceKind: 'fulfillment', sourceId: 'ful_1', linkRole: 'parent' },
      { sourceKind: 'order', sourceId: 'ord_1', linkRole: 'parent' },
      { sourceKind: 'stock_movement', sourceId: 'mv_1', linkRole: 'member' },
      { sourceKind: 'stock_movement', sourceId: 'mv_2', linkRole: 'member' },
    ])
    // 3 units: labour 600, overhead 300, material the remainder of 3,000.
    expect(leg(first!.entry, 'cogs_direct_labor')).toMatchObject({
      direction: 'debit',
      amount: 600,
    })
    expect(leg(first!.entry, 'applied_overhead')).toMatchObject({ direction: 'debit', amount: 300 })
    expect(leg(first!.entry, 'cogs_product_cost')).toMatchObject({
      direction: 'debit',
      amount: 2_100,
    })
    expect(leg(first!.entry, 'inventory_finished_goods')).toMatchObject({
      direction: 'credit',
      amount: 3_000,
    })
    expect(second!.entry.txnDate).toBe('2026-08-20')
    expect(second!.sources[0]).toEqual({
      sourceKind: 'stock_movement',
      sourceId: 'mv_3',
      linkRole: 'subject',
    })
  })

  it('posts an adjust against count variance and an initial as an opening', async () => {
    h.ledger = [
      pending('mv_adj', 'part_a', 'adjust', 3, { glAccount: 'inventory_raw_materials' }),
      pending('mv_init', 'part_a', 'initial', 5, { glAccount: 'inventory_raw_materials' }),
    ]

    await pricePendingMovements(db, ORG, ['part_a'])

    const [adjust, opening] = postedEntries()
    expect(adjust!.sources[0]).toEqual({
      sourceKind: 'stock_movement',
      sourceId: 'mv_adj',
      linkRole: 'subject',
    })
    expect(leg(adjust!.entry, 'inventory_raw_materials')).toMatchObject({
      direction: 'debit',
      amount: 3_000,
    })
    expect(leg(adjust!.entry, 'inventory_count_variance')).toMatchObject({
      direction: 'credit',
      amount: 3_000,
    })
    expect(leg(opening!.entry, 'equity_opening_balance')).toMatchObject({
      direction: 'credit',
      amount: 5_000,
    })
  })

  it('finishes a build only once every leg is valued, and clears its work item then', async () => {
    h.standards.set('part_b', { standardCost: 500, labor: null, overhead: null })
    h.ledger = [
      pending('mv_c', 'part_a', 'build_consume', -2, { buildId: 'build_1' }),
      pending('mv_p', 'part_b', 'build_produce', 1, { buildId: 'build_1' }),
    ]

    // Only the component priced: the produce leg is still pending.
    const partial = await pricePendingMovements(db, ORG, ['part_a'])
    expect(partial._unsafeUnwrap().finishedBuildIds).toEqual([])
    expect(h.finishPricedBuild).toHaveBeenCalledWith(db, ORG, 'build_1')
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'build',
      sourceIds: [],
      stage: 'price',
    })

    const complete = await pricePendingMovements(db, ORG, ['part_b'])
    expect(complete._unsafeUnwrap().finishedBuildIds).toEqual(['build_1'])
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'build',
      sourceIds: ['build_1'],
      stage: 'price',
    })
    // A build never goes through the row poster: its entry is the build's, posted by the finisher.
    expect(h.postEntryInTx).not.toHaveBeenCalled()
  })

  // 103 §5a / 106-D9: a stored $0 with an origin is a standard. It fills at 0 and books nothing.
  it('prices at a $0 standard, filling the row and posting no zero entry', async () => {
    h.standards.set('part_a', { standardCost: 0, labor: null, overhead: null })
    h.ledger = [pending('mv_free', 'part_a', 'adjust', 2)]

    const result = await pricePendingMovements(db, ORG, ['part_a'])

    expect(result._unsafeUnwrap().pricedMovementIds).toEqual(['mv_free'])
    expect(h.ledger[0]).toMatchObject({ unitCost: 0, extendedCost: 0, costBasis: 'standard' })
    expect(h.postEntryInTx).not.toHaveBeenCalled()
  })
})

describe('what the pricer leaves alone', () => {
  it('skips a part with no usable standard and reports it', async () => {
    h.ledger = [pending('mv_1', 'part_x', 'adjust', 1)]

    const result = await pricePendingMovements(db, ORG, ['part_x', 'part_a'])

    expect(result._unsafeUnwrap()).toMatchObject({
      pricedMovementIds: [],
      unpricedPartIds: ['part_x'],
    })
    expect(h.fillPendingCost).not.toHaveBeenCalled()
  })

  it('values a pre-cutover row and posts nothing for it (the X1 floor)', async () => {
    h.settings['accounting.cutoffPeriod'] = '2026-08'
    h.ledger = [pending('mv_old', 'part_a', 'adjust', 1)]

    const result = await pricePendingMovements(db, ORG, ['part_a'])

    expect(result._unsafeUnwrap().pricedMovementIds).toEqual(['mv_old'])
    expect(h.ledger[0]).toMatchObject({ unitCost: 1_000, costBasis: 'standard' })
    expect(h.postEntryInTx).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap().documentsFailed).toBe(0)
  })

  it('values the rows and posts nothing, without error, when accounting is off', async () => {
    h.accountingEnabled = false
    h.ledger = [pending('mv_1', 'part_a', 'sale', -1, { fulfillmentLineId: 'line_1' })]

    const result = await pricePendingMovements(db, ORG, ['part_a'])

    expect(result.isOk()).toBe(true)
    expect(h.ledger[0]).toMatchObject({ extendedCost: -1_000, costBasis: 'standard' })
    expect(h.postEntryInTx).not.toHaveBeenCalled()
  })

  it('is a no-op the second time: nothing is pending any more', async () => {
    h.ledger = [pending('mv_1', 'part_a', 'adjust', 1)]
    await pricePendingMovements(db, ORG, ['part_a'])
    h.fillPendingCost.mockClear()
    h.postEntryInTx.mockClear()

    const again = await pricePendingMovements(db, ORG, ['part_a'])

    expect(again._unsafeUnwrap().pricedMovementIds).toEqual([])
    expect(h.fillPendingCost).not.toHaveBeenCalled()
    expect(h.postEntryInTx).not.toHaveBeenCalled()
  })

  it('never fails the pass for a document the ledger declined: the rows stay valued', async () => {
    h.postEntryInTx.mockRejectedValueOnce(new Error('ledger down'))
    h.ledger = [pending('mv_1', 'part_a', 'adjust', 1), pending('mv_2', 'part_a', 'adjust', 2)]

    const result = await pricePendingMovements(db, ORG, ['part_a'])

    expect(result._unsafeUnwrap()).toMatchObject({ documentsPosted: 1, documentsFailed: 1 })
    expect(h.ledger.every((row) => row.costBasis === 'standard')).toBe(true)
  })
})

describe('the work items it resolves', () => {
  it('clears a movement row, and a dispatch row once none of its pending ids is pending', async () => {
    h.ledger = [
      pending('mv_1', 'part_a', 'sale', -1, { fulfillmentLineId: 'line_1' }),
      pending('mv_2', 'part_x', 'sale', -1, { fulfillmentLineId: 'line_9' }),
      pending('mv_adj', 'part_a', 'adjust', 1),
    ]
    h.workItems = [
      { sourceId: 'ful_1', detail: { pendingMovementIds: ['mv_1'] } },
      // Half priced: `mv_2` is another part's and stays pending.
      { sourceId: 'ful_9', detail: { pendingMovementIds: ['mv_2', 'mv_1'] } },
      // Re-staged from `relieve` with no ids: the sweep handler's, not the pricer's.
      { sourceId: 'ful_legacy', detail: {} },
    ]

    await pricePendingMovements(db, ORG, ['part_a'])

    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'stock_movement',
      sourceIds: ['mv_1', 'mv_adj'],
      stage: 'price',
    })
    expect(h.deleteWorkItemsAtStage).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
      stage: 'price',
    })
  })
})
