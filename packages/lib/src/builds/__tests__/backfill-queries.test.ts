// packages/lib/src/builds/__tests__/backfill-queries.test.ts
//
// The aggregate read behind the bulk builder
// (`plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 7.1/7.1a),
// at the only two things a db double can actually see: how many queries it
// issues, and what it makes of the rows they come back with.
//
// ⚠️ **The SQL predicates are NOT under test here and cannot be.**
// `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` whose COLUMNS are `undefined` — a `WHERE` is unreadable and an
// alias is indistinguishable from any other. So the rules that live in SQL —
// `completed` and `canceled` builds excluded from coverage, cancelled orders
// excluded from demand, the range applied to `order_placed_at` with the
// `createdAt` fallback — are asserted in `backfill-queries.int.test.ts` against
// a real database. Asserting them here would only be asserting the double.
//
// What IS here: the query BUDGET (five, whatever the range holds — section 4.1
// is explicit that this read must not inherit `readOrderRaisedBuilds`'s
// per-order cost) and the attribution pass that turns build rows into
// `BackfillCoverage`, which is where a build gets counted against the wrong
// window or against no window at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const LIFT = 'part_lift'
const BOLT = 'part_bolt'
const ORDER_IN = 'ord_in_range'
const ORDER_OUT = 'ord_out_of_range'
const PLACED_AT = '2026-01-10T00:00:00.000Z'

/** `db.select({...})` projections, which is how the double tells the reads apart. */
const DEMAND = 'orderId|partId|quantity|placedAt'
const COVERAGE = 'buildPartId|plannedQuantity|buildOrderId|periodStart|periodEnd'
const QUANTITY_ON_HAND = 'entityId|valueNumber'
const PART_KINDS = 'entityId|optionId'
const HAS_BOM = 'parentPartId'

const h = vi.hoisted(() => ({
  /** entityType -> `EntityDefinition.id`, for the defs the org has. */
  defs: new Map<string, string>(),
  /** systemAttributes the org has materialised, mapped to a field row id. */
  fields: new Map<string, string>(),
  /** projection key -> the rows that read returns. */
  rows: new Map<string, Record<string, unknown>[]>(),
  /** projection keys, in the order the reads were issued. */
  issued: [] as string[],
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => {
            const id = h.fields.get(attr)
            return [attr, id ? { id } : null]
          })
        ),
    }),
  }),
}))

import { readBackfillPlanReads } from '../backfill-queries'

const CHAIN_METHODS = ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']

/**
 * A promise carrying the chain methods, so `await` works anywhere along it —
 * the same shape `auto-build-queries.test.ts` uses.
 */
function chain(rows: Record<string, unknown>[]) {
  const promise = Promise.resolve(rows) as Promise<Record<string, unknown>[]> &
    Record<string, unknown>
  for (const method of CHAIN_METHODS) promise[method] = () => promise
  return promise
}

const db = {
  select: (projection: Record<string, unknown>) => {
    const key = Object.keys(projection).join('|')
    h.issued.push(key)
    return chain(h.rows.get(key) ?? [])
  },
} as never

const RANGE = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-02-01T00:00:00.000Z'),
}

/** One row as the demand query returns it. */
function demandRow(overrides: Record<string, unknown> = {}) {
  return { orderId: ORDER_IN, partId: LIFT, quantity: 2, placedAt: PLACED_AT, ...overrides }
}

/** One row as the coverage query returns it. */
function coverageRow(overrides: Record<string, unknown> = {}) {
  return {
    buildPartId: LIFT,
    plannedQuantity: 3,
    buildOrderId: null,
    periodStart: null,
    periodEnd: null,
    ...overrides,
  }
}

async function read() {
  const result = await readBackfillPlanReads(db, ORG, RANGE)
  if (result.isErr()) throw result.error
  return result.value
}

beforeEach(() => {
  vi.clearAllMocks()
  h.defs = new Map([
    ['order', 'def_order'],
    ['line_item', 'def_line'],
    ['build', 'def_build'],
    ['subpart', 'def_subpart'],
  ])
  h.fields = new Map(
    [
      'order_placed_at',
      'order_cancelled_at',
      'line_item_order',
      'line_item_part',
      'line_item_qty',
      'part_kind',
      'part_quantity_on_hand',
      'build_part',
      'build_status',
      'build_quantity_planned',
      'build_order',
      'build_reversal_of',
      'build_period_start',
      'build_period_end',
      'subpart_parent_part',
      'subpart_child_part',
      'subpart_quantity',
    ].map((attr) => [attr, `fld_${attr}`])
  )
  h.rows = new Map()
  h.issued = []
})

describe('readBackfillPlanReads — the query budget', () => {
  it('answers a whole range in five queries', async () => {
    // Section 4.1: the historical lane must NOT inherit `readOrderRaisedBuilds`'s
    // one-read-per-order cost. Five reads whatever the range holds — demand,
    // coverage, on hand, part kind, bill of materials.
    h.rows.set(DEMAND, [
      demandRow(),
      demandRow({ orderId: 'ord_2', partId: BOLT }),
      demandRow({ orderId: 'ord_3' }),
      demandRow({ orderId: 'ord_4' }),
    ])
    h.rows.set(PART_KINDS, [
      { entityId: LIFT, optionId: 'finished_good' },
      { entityId: BOLT, optionId: 'finished_good' },
    ])

    await read()

    // Sorted, because the three middle reads are issued together and resolve in
    // whatever order their cache lookups do — the BUDGET is what matters here,
    // not the sequence.
    expect([...h.issued].sort()).toEqual(
      [DEMAND, COVERAGE, QUANTITY_ON_HAND, PART_KINDS, HAS_BOM].sort()
    )
  })

  it('stops after the demand read when the range holds no demand', async () => {
    // Nothing ordered is nothing to build, and every read below it is keyed on
    // the parts the demand names.
    const reads = await read()

    expect(h.issued).toEqual([DEMAND])
    expect(reads.lines).toEqual([])
    expect(reads.coverage).toEqual([])
    expect(reads.quantitiesOnHand.size).toBe(0)
  })

  it('never asks for the bill of materials of a purchased part', async () => {
    // `reconcileOrderBuilds` orders these the same way — step 3 before step 2.
    // A `component` can never be built, so its BOM is never worth a read.
    h.rows.set(DEMAND, [demandRow({ partId: BOLT })])
    h.rows.set(PART_KINDS, [{ entityId: BOLT, optionId: 'component' }])

    await read()

    expect(h.issued).not.toContain(HAS_BOM)
  })
})

describe('readBackfillPlanReads — demand', () => {
  it('keeps one line per row, uncollapsed', async () => {
    // The contract hands the policy every line, not one per part: the drill-down
    // names the orders behind a bucket, and collapsing here would lose them.
    h.rows.set(DEMAND, [demandRow({ quantity: 2 }), demandRow({ quantity: 3 })])

    const { lines } = await read()

    expect(lines).toEqual([
      { orderId: ORDER_IN, partId: LIFT, quantity: 2, placedAt: new Date(PLACED_AT) },
      { orderId: ORDER_IN, partId: LIFT, quantity: 3, placedAt: new Date(PLACED_AT) },
    ])
  })

  it('reads a line with no `line_item_qty` as zero rather than dropping it', async () => {
    // Same as `loadAutoBuildOrders`. The POLICY decides a non-positive line
    // contributes nothing; dropping it in the reader would also hide its order
    // from the drill-down.
    h.rows.set(DEMAND, [demandRow({ quantity: null })])

    const { lines } = await read()

    expect(lines).toEqual([
      { orderId: ORDER_IN, partId: LIFT, quantity: 0, placedAt: new Date(PLACED_AT) },
    ])
  })

  it('drops a line whose date cannot be read', async () => {
    // An Invalid Date compares false against everything, so it would silently
    // fall out of every bucket much later instead of here.
    h.rows.set(DEMAND, [demandRow({ placedAt: 'not a date' }), demandRow()])

    const { lines } = await read()

    expect(lines).toHaveLength(1)
  })
})

describe('readBackfillPlanReads — coverage attribution', () => {
  beforeEach(() => {
    h.rows.set(DEMAND, [demandRow()])
    h.rows.set(PART_KINDS, [{ entityId: LIFT, optionId: 'finished_good' }])
  })

  it('resolves an order-raised build through its order to that order’s date', async () => {
    h.rows.set(COVERAGE, [coverageRow({ buildOrderId: ORDER_IN, plannedQuantity: 4 })])

    const { coverage } = await read()

    expect(coverage).toEqual([{ partId: LIFT, quantity: 4, appliesAt: new Date(PLACED_AT) }])
  })

  it('🛑 drops an order-raised build whose order is outside the range', async () => {
    // It covers demand this run is not looking at. Counting it as UNDATED
    // coverage instead — the tempting fallback — would let an April build
    // suppress January's, which is the opposite of what netting is for.
    h.rows.set(COVERAGE, [coverageRow({ buildOrderId: ORDER_OUT })])

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })

  it('resolves a batch build to its own period start', async () => {
    h.rows.set(COVERAGE, [
      coverageRow({
        plannedQuantity: 7,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-02-01T00:00:00.000Z',
      }),
    ])

    const { coverage } = await read()

    expect(coverage).toEqual([
      { partId: LIFT, quantity: 7, appliesAt: new Date('2026-01-01T00:00:00.000Z') },
    ])
  })

  it('🛑 keeps a period that OVERLAPS the range, not only one that starts inside it', async () => {
    // A January batch build still covers the first half of a January-15 range.
    // A start-inside test would drop it and rebuild demand that is already
    // committed.
    h.rows.set(COVERAGE, [
      coverageRow({
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-02-01T00:00:00.000Z',
      }),
    ])

    const result = await readBackfillPlanReads(db, ORG, {
      from: new Date('2026-01-15T00:00:00.000Z'),
      to: new Date('2026-02-15T00:00:00.000Z'),
    })
    if (result.isErr()) throw result.error

    expect(result.value.coverage).toEqual([
      { partId: LIFT, quantity: 3, appliesAt: new Date('2026-01-01T00:00:00.000Z') },
    ])
  })

  it('drops a period that ends before the range opens', async () => {
    h.rows.set(COVERAGE, [
      coverageRow({
        periodStart: '2025-11-01T00:00:00.000Z',
        periodEnd: '2025-12-01T00:00:00.000Z',
      }),
    ])

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })

  it('🛑 counts a build with neither an order nor a period as undated coverage', async () => {
    // That is a `manual` build, and section 7.1a is explicit that it counts:
    // the aggregate asks "is enough production planned for this demand?", not
    // "does this order have its build?". This DIVERGES from
    // `reconcile-policy.ts` deliberately — do not align the two.
    h.rows.set(COVERAGE, [coverageRow({ plannedQuantity: 5 })])

    const { coverage } = await read()

    expect(coverage).toEqual([{ partId: LIFT, quantity: 5, appliesAt: null }])
  })

  it('commits nothing for a build that plans nothing', async () => {
    h.rows.set(COVERAGE, [
      coverageRow({ plannedQuantity: null }),
      coverageRow({ plannedQuantity: 0 }),
      coverageRow({ plannedQuantity: -3 }),
    ])

    const { coverage } = await read()

    expect(coverage).toEqual([])
  })
})

describe('readBackfillPlanReads — the per-part maps', () => {
  it('carries on hand, part kind and the bill-of-materials flag straight through', async () => {
    h.rows.set(DEMAND, [demandRow(), demandRow({ partId: BOLT })])
    h.rows.set(QUANTITY_ON_HAND, [{ entityId: LIFT, valueNumber: 3 }])
    h.rows.set(PART_KINDS, [
      { entityId: LIFT, optionId: 'finished_good' },
      { entityId: BOLT, optionId: 'component' },
    ])
    h.rows.set(HAS_BOM, [{ parentPartId: LIFT }])

    const reads = await read()

    // A part nobody has counted has nothing on the shelf, not "unknown".
    expect(reads.quantitiesOnHand.get(LIFT)).toBe(3)
    expect(reads.quantitiesOnHand.get(BOLT)).toBe(0)
    expect(reads.partKinds.get(LIFT)).toBe('finished_good')
    expect(reads.hasBom.get(LIFT)).toBe(true)
    // Absent, not `false`: the contract says an absent part reads as no BOM,
    // and a purchased part is never asked about at all.
    expect(reads.hasBom.has(BOLT)).toBe(false)
  })
})

describe('readBackfillPlanReads — refusals', () => {
  it('reads an org with no order entity as having no demand', async () => {
    // Nothing to build from. Refusing loudly would turn opening the dialog on an
    // unmigrated org into an error rather than an empty preview.
    h.defs.delete('order')

    const reads = await read()

    expect(reads.lines).toEqual([])
    expect(h.issued).toEqual([])
  })

  it('🛑 refuses an org that HAS demand but no provisioned build entity', async () => {
    // The opposite call from the one above, and for the reason
    // `reconcile-queries.ts` documents: reading coverage as empty here would
    // plan builds on top of production that already exists.
    h.rows.set(DEMAND, [demandRow()])
    h.defs.delete('build')

    const result = await readBackfillPlanReads(db, ORG, RANGE)

    expect(result.isErr()).toBe(true)
  })

  it('🛑 refuses when `build_quantity_planned` is not materialised', async () => {
    // Every coverage row would read zero and be dropped, which is a silently
    // widened answer handed to a writer.
    h.rows.set(DEMAND, [demandRow()])
    h.fields.delete('build_quantity_planned')

    const result = await readBackfillPlanReads(db, ORG, RANGE)

    expect(result.isErr()).toBe(true)
  })
})
