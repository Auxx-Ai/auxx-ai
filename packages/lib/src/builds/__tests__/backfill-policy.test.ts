// packages/lib/src/builds/__tests__/backfill-policy.test.ts
//
// The whole of the backfill decision, with no database in sight
// (plans/money/tasks/44-auto-build-cutoff-and-backfill.md sections 7.1, 7.1a,
// 7.2b). Pure - no doubles, no mocks, nothing to set up.
//
// The cases that earn their keep are the three the plan names as the ones the
// obvious implementation gets wrong: on-hand spread across many buckets, a
// monthly coverage entry viewed at weekly grouping, and an order placed late on
// the last evening of a month in a negative-offset zone.

import { describe, expect, it } from 'vitest'
import { planBackfill } from '../backfill-policy'
import {
  BACKFILL_EXCLUSION_REASONS,
  BACKFILL_GROUPINGS,
  type BackfillCoverage,
  type BackfillDemandLine,
  type BackfillGrouping,
  type BackfillPlanInput,
} from '../backfill-types'

const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const BOLT = 'part_bolt'

/** Negative offset year-round, and the zone section 7.1a's example is written in. */
const NEW_YORK = 'America/New_York'

let sequence = 0

/** One order line. Defaults to a single unit of the lift, mid-January. */
function line(overrides: Partial<BackfillDemandLine> = {}): BackfillDemandLine {
  sequence += 1
  return {
    orderId: `order_${sequence}`,
    partId: LIFT,
    quantity: 1,
    placedAt: new Date('2026-01-15T12:00:00.000Z'),
    ...overrides,
  }
}

/** Committed production: a `planned` build's units, per section 7.1a. */
function coverage(overrides: Partial<BackfillCoverage> = {}): BackfillCoverage {
  return { partId: LIFT, quantity: 1, appliesAt: null, ...overrides }
}

/**
 * The happy-path world: every part is a `finished_good` with a bill of
 * materials, nothing on the shelf and nothing committed, so the arithmetic turns
 * entirely on what the test varies.
 */
function input(overrides: Partial<BackfillPlanInput> = {}): BackfillPlanInput {
  return {
    lines: [],
    coverage: [],
    quantitiesOnHand: new Map(),
    partKinds: new Map([
      [LIFT, 'finished_good'],
      [HOIST, 'subassembly'],
      [BOLT, 'component'],
    ]),
    hasBom: new Map([
      [LIFT, true],
      [HOIST, true],
    ]),
    grouping: 'month',
    timeZone: NEW_YORK,
    ...overrides,
  }
}

/** Monthly demand at noon UTC, one order per month, starting in January. */
function monthlyLines(quantities: readonly number[], partId = LIFT): BackfillDemandLine[] {
  return quantities.map((quantity, index) =>
    line({
      partId,
      quantity,
      orderId: `order_m${index + 1}`,
      placedAt: new Date(`2026-${String(index + 1).padStart(2, '0')}-15T12:00:00.000Z`),
    })
  )
}

function onlyPart(plan: ReturnType<typeof planBackfill>) {
  const part = plan.parts[0]
  if (!part) throw new Error('expected exactly one part in the plan')
  return part
}

describe('planBackfill admission', () => {
  it('excludes a component as not-a-built-part', () => {
    const plan = planBackfill(input({ lines: [line({ partId: BOLT, quantity: 4 })] }))

    expect(plan.parts).toEqual([])
    expect(plan.excluded).toEqual([
      {
        partId: BOLT,
        quantityOrdered: 4,
        quantityOnHand: 0,
        quantityCovered: 0,
        reason: 'not-a-built-part',
      },
    ])
  })

  it('reads an absent or unrecognised part kind as a component', () => {
    const lines = [line({ partId: 'part_mystery', quantity: 2 })]
    const absent = planBackfill(input({ lines, hasBom: new Map([['part_mystery', true]]) }))
    const unknown = planBackfill(
      input({
        lines,
        partKinds: new Map([['part_mystery', 'widget']]),
        hasBom: new Map([['part_mystery', true]]),
      })
    )

    expect(absent.excluded[0]?.reason).toBe('not-a-built-part')
    expect(unknown.excluded[0]?.reason).toBe('not-a-built-part')
  })

  it('excludes a built part with no bill of materials', () => {
    const plan = planBackfill(
      input({ lines: [line({ quantity: 7 })], hasBom: new Map([[LIFT, false]]) })
    )

    expect(plan.parts).toEqual([])
    expect(plan.excluded).toEqual([
      {
        partId: LIFT,
        quantityOrdered: 7,
        quantityOnHand: 0,
        quantityCovered: 0,
        reason: 'no-bill-of-materials',
      },
    ])
  })

  it('checks the part kind before the bill of materials', () => {
    // A purchased part never needs a bill of materials, so it must not be the
    // reason shown for one.
    const plan = planBackfill(input({ lines: [line({ partId: BOLT })], hasBom: new Map() }))

    expect(plan.excluded[0]?.reason).toBe('not-a-built-part')
  })

  it('excludes a part the shelf already covers, carrying the numbers that show why', () => {
    const plan = planBackfill(
      input({ lines: [line({ quantity: 3 })], quantitiesOnHand: new Map([[LIFT, 5]]) })
    )

    expect(plan.parts).toEqual([])
    expect(plan.excluded).toEqual([
      {
        partId: LIFT,
        quantityOrdered: 3,
        quantityOnHand: 5,
        quantityCovered: 0,
        reason: 'covered-by-stock',
      },
    ])
  })

  it('excludes a part committed production already covers as already-covered', () => {
    // The second run of the dialog: every part just built is fully covered by
    // its own new builds, and calling that `covered-by-stock` would claim the
    // stock room is full of units nobody has made yet.
    const plan = planBackfill(
      input({ lines: [line({ quantity: 3 })], coverage: [coverage({ quantity: 3 })] })
    )

    expect(plan.excluded).toEqual([
      {
        partId: LIFT,
        quantityOrdered: 3,
        quantityOnHand: 0,
        quantityCovered: 3,
        reason: 'already-covered',
      },
    ])
  })

  it('prefers already-covered when BOTH pools contributed', () => {
    // The committed-production remedy is the actionable one, so it wins the tie.
    const plan = planBackfill(
      input({
        lines: [line({ quantity: 10 })],
        coverage: [coverage({ quantity: 4 })],
        quantitiesOnHand: new Map([[LIFT, 6]]),
      })
    )

    expect(plan.excluded).toEqual([
      {
        partId: LIFT,
        quantityOrdered: 10,
        quantityOnHand: 6,
        quantityCovered: 4,
        reason: 'already-covered',
      },
    ])
  })

  it('still says covered-by-stock when the shelf did all of the work', () => {
    const plan = planBackfill(
      input({
        lines: [line({ quantity: 10 })],
        coverage: [coverage({ quantity: 0 })],
        quantitiesOnHand: new Map([[LIFT, 10]]),
      })
    )

    expect(plan.excluded).toEqual([
      {
        partId: LIFT,
        quantityOrdered: 10,
        quantityOnHand: 10,
        quantityCovered: 0,
        reason: 'covered-by-stock',
      },
    ])
  })

  it('carries the evidence for its own reason on every exclusion row', () => {
    // Section 7.2b: an omission a person cannot explain makes the preview
    // untrustworthy, so the two netting reasons must be distinguishable by the
    // numbers on the row and not only by the reason string.
    const plan = planBackfill(
      input({
        lines: [line({ partId: LIFT, quantity: 6 }), line({ partId: HOIST, quantity: 6 })],
        coverage: [coverage({ partId: HOIST, quantity: 9 })],
        quantitiesOnHand: new Map([[LIFT, 8]]),
      })
    )

    expect(plan.excluded).toEqual([
      {
        partId: HOIST,
        quantityOrdered: 6,
        quantityOnHand: 0,
        // The pool AVAILABLE, not the 6 consumed - a part with no surviving
        // bucket has no per-bucket consumption to report.
        quantityCovered: 9,
        reason: 'already-covered',
      },
      {
        partId: LIFT,
        quantityOrdered: 6,
        quantityOnHand: 8,
        quantityCovered: 0,
        reason: 'covered-by-stock',
      },
    ])
  })

  it('reads the netting reason off the DROPPED buckets, not the surviving ones', () => {
    // Nothing survives, so the answer can only come from what the dropped
    // buckets consumed. Coverage runs out in February; stock finishes March.
    const plan = planBackfill(
      input({
        lines: monthlyLines([10, 10, 10]),
        coverage: [coverage({ quantity: 15 })],
        quantitiesOnHand: new Map([[LIFT, 15]]),
      })
    )

    expect(plan.parts).toEqual([])
    expect(plan.excluded[0]?.reason).toBe('already-covered')
  })

  it('draws every exclusion from the closed four-member vocabulary', () => {
    const plan = planBackfill(
      input({
        lines: [
          line({ partId: BOLT }),
          line({ partId: HOIST }),
          line({ partId: LIFT, quantity: 2 }),
          line({ partId: 'part_winch', quantity: 2 }),
        ],
        partKinds: new Map([
          [BOLT, 'component'],
          [HOIST, 'subassembly'],
          [LIFT, 'finished_good'],
          ['part_winch', 'finished_good'],
        ]),
        hasBom: new Map([
          [LIFT, true],
          ['part_winch', true],
        ]),
        quantitiesOnHand: new Map([[LIFT, 9]]),
        coverage: [coverage({ partId: 'part_winch', quantity: 2 })],
      })
    )

    expect(plan.excluded.map((row) => row.reason).sort()).toEqual([
      'already-covered',
      'covered-by-stock',
      'no-bill-of-materials',
      'not-a-built-part',
    ])
    expect(BACKFILL_EXCLUSION_REASONS).toEqual(
      expect.arrayContaining(plan.excluded.map((row) => row.reason))
    )
  })
})

describe('planBackfill on-hand netting', () => {
  it('consumes on hand ONCE across every bucket, not once per bucket', () => {
    // Section 7.1: three lifts on the shelf and eight monthly buckets is three
    // units of coverage in total. The per-row bug reads as 3 x 8 = 24.
    const plan = planBackfill(
      input({
        lines: monthlyLines([10, 10, 10, 10, 10, 10, 10, 10]),
        quantitiesOnHand: new Map([[LIFT, 3]]),
      })
    )

    const part = onlyPart(plan)
    expect(part.quantityOrdered).toBe(80)
    expect(part.quantityToBuild).toBe(77)
    expect(plan.unitCount).toBe(77)
    expect(part.buckets).toHaveLength(8)
    expect(part.buckets.reduce((total, b) => total + b.quantityFromStock, 0)).toBe(3)
  })

  it('takes on hand off the EARLIEST bucket', () => {
    const plan = planBackfill(
      input({
        lines: monthlyLines([10, 10, 10]),
        quantitiesOnHand: new Map([[LIFT, 4]]),
      })
    )

    expect(
      onlyPart(plan).buckets.map((b) => [b.periodKey, b.quantityFromStock, b.quantityToBuild])
    ).toEqual([
      ['2026-01', 4, 6],
      ['2026-02', 0, 10],
      ['2026-03', 0, 10],
    ])
  })

  it('drops a bucket stock swallows whole without handing its stock on', () => {
    // The bucket is dropped AFTER it has taken its share - skipping it instead
    // would let January's stock be spent again in February.
    const plan = planBackfill(
      input({ lines: monthlyLines([10, 10, 10]), quantitiesOnHand: new Map([[LIFT, 10]]) })
    )

    const part = onlyPart(plan)
    expect(part.buckets.map((b) => b.periodKey)).toEqual(['2026-02', '2026-03'])
    expect(part.quantityToBuild).toBe(20)
    expect(plan.buildCount).toBe(2)
  })

  it('reads a negative quantity on hand as no coverage, and still reports it', () => {
    // Section 5: -280 across all 22 components of the org this was written for.
    // Negative coverage would inflate every build in the range.
    const plan = planBackfill(
      input({ lines: monthlyLines([10, 10]), quantitiesOnHand: new Map([[LIFT, -280]]) })
    )

    const part = onlyPart(plan)
    expect(part.quantityOnHand).toBe(-280)
    expect(part.quantityToBuild).toBe(20)
    expect(part.buckets.every((b) => b.quantityFromStock === 0)).toBe(true)
  })

  it('reads an absent or non-finite quantity on hand as zero', () => {
    const plan = planBackfill(
      input({ lines: monthlyLines([10]), quantitiesOnHand: new Map([[LIFT, Number.NaN]]) })
    )

    expect(onlyPart(plan).quantityOnHand).toBe(0)
    expect(onlyPart(plan).quantityToBuild).toBe(10)
  })
})

describe('planBackfill coverage netting', () => {
  it('counts a monthly coverage entry ONCE across the weeks it overlaps', () => {
    // Section 7.1a: build by month, view by week, and one monthly build overlaps
    // five weekly buckets. Netting per bucket counts it fivefold - here that
    // would leave nothing to build at all.
    const plan = planBackfill(
      input({
        grouping: 'week',
        lines: [
          line({ quantity: 10, placedAt: new Date('2026-03-02T12:00:00.000Z') }),
          line({ quantity: 10, placedAt: new Date('2026-03-09T12:00:00.000Z') }),
          line({ quantity: 10, placedAt: new Date('2026-03-16T12:00:00.000Z') }),
          line({ quantity: 10, placedAt: new Date('2026-03-23T12:00:00.000Z') }),
        ],
        coverage: [coverage({ quantity: 25, appliesAt: new Date('2026-03-01T05:00:00.000Z') })],
      })
    )

    const part = onlyPart(plan)
    expect(part.quantityOrdered).toBe(40)
    expect(part.quantityCovered).toBe(25)
    expect(part.quantityToBuild).toBe(15)
    // Netting per bucket would set 25 against each week's 10 and exclude the
    // part outright; the two fully-covered weeks are dropped, and the third
    // takes only what is left of the pool.
    expect(part.buckets.map((b) => [b.periodKey, b.quantityCovered, b.quantityToBuild])).toEqual([
      ['2026-W12', 5, 5],
      ['2026-W13', 0, 10],
    ])
  })

  it('pools several coverage entries for one part', () => {
    const plan = planBackfill(
      input({
        lines: monthlyLines([10, 10]),
        coverage: [coverage({ quantity: 4 }), coverage({ quantity: 6 })],
      })
    )

    const part = onlyPart(plan)
    expect(part.quantityCovered).toBe(10)
    expect(part.buckets.map((b) => b.periodKey)).toEqual(['2026-02'])
  })

  it('drains coverage before stock, and reports the two columns separately', () => {
    const plan = planBackfill(
      input({
        lines: monthlyLines([10, 10]),
        coverage: [coverage({ quantity: 6 })],
        quantitiesOnHand: new Map([[LIFT, 3]]),
      })
    )

    const part = onlyPart(plan)
    expect(part.quantityToBuild).toBe(11)
    expect(
      part.buckets.map((b) => [
        b.periodKey,
        b.quantityCovered,
        b.quantityFromStock,
        b.quantityToBuild,
      ])
    ).toEqual([
      ['2026-01', 6, 3, 1],
      ['2026-02', 0, 0, 10],
    ])
  })

  it('ignores a non-positive or non-finite coverage quantity', () => {
    const plan = planBackfill(
      input({
        lines: monthlyLines([10]),
        coverage: [
          coverage({ quantity: 0 }),
          coverage({ quantity: -5 }),
          coverage({ quantity: Number.POSITIVE_INFINITY }),
          coverage({ quantity: 3 }),
        ],
      })
    )

    expect(onlyPart(plan).quantityCovered).toBe(3)
    expect(onlyPart(plan).quantityToBuild).toBe(7)
  })

  it('ignores coverage for a part nothing was ordered of', () => {
    const plan = planBackfill(
      input({ lines: monthlyLines([10]), coverage: [coverage({ partId: HOIST, quantity: 99 })] })
    )

    expect(plan.parts.map((p) => p.partId)).toEqual([LIFT])
    expect(onlyPart(plan).quantityToBuild).toBe(10)
  })
})

describe('planBackfill bucketing in the book timezone', () => {
  it('buckets 7pm on the last day of a month into that month, not the next', () => {
    // 2026-01-31T23:00 in New York is already 2026-02-01T04:00 in UTC.
    const placedAt = new Date('2026-02-01T04:00:00.000Z')

    const local = planBackfill(input({ lines: [line({ quantity: 5, placedAt })] }))
    const utc = planBackfill(input({ timeZone: 'UTC', lines: [line({ quantity: 5, placedAt })] }))

    expect(onlyPart(local).buckets[0]?.periodKey).toBe('2026-01')
    expect(onlyPart(utc).buckets[0]?.periodKey).toBe('2026-02')
  })

  it('buckets the same instant into the right DAY and WEEK too', () => {
    const placedAt = new Date('2026-02-01T04:00:00.000Z')
    const lines = [line({ quantity: 5, placedAt })]

    expect(onlyPart(planBackfill(input({ grouping: 'day', lines }))).buckets[0]?.periodKey).toBe(
      '2026-01-31'
    )
    expect(onlyPart(planBackfill(input({ grouping: 'week', lines }))).buckets[0]?.periodKey).toBe(
      '2026-W05'
    )
  })

  it('gives a monthly bucket half-open boundaries at local midnight', () => {
    const plan = planBackfill(input({ lines: monthlyLines([10]) }))

    const bucket = onlyPart(plan).buckets[0]
    expect(bucket?.periodStart.toISOString()).toBe('2026-01-01T05:00:00.000Z')
    expect(bucket?.periodEnd.toISOString()).toBe('2026-02-01T05:00:00.000Z')
  })

  it('keys a week by its ISO week-numbering year, which is not always its calendar year', () => {
    const plan = planBackfill(
      input({
        grouping: 'week',
        lines: [line({ quantity: 2, placedAt: new Date('2025-12-29T12:00:00.000Z') })],
      })
    )

    expect(onlyPart(plan).buckets[0]?.periodKey).toBe('2026-W01')
  })

  it('separates two instants that share a UTC day but not a local one', () => {
    const plan = planBackfill(
      input({
        grouping: 'day',
        lines: [
          line({ quantity: 1, placedAt: new Date('2026-03-10T03:00:00.000Z') }),
          line({ quantity: 1, placedAt: new Date('2026-03-10T12:00:00.000Z') }),
        ],
      })
    )

    expect(onlyPart(plan).buckets.map((b) => b.periodKey)).toEqual(['2026-03-09', '2026-03-10'])
  })
})

describe('planBackfill grouping', () => {
  const threeOrders = [
    line({ orderId: 'order_a', quantity: 5, placedAt: new Date('2026-03-02T12:00:00.000Z') }),
    line({ orderId: 'order_b', quantity: 5, placedAt: new Date('2026-03-02T18:00:00.000Z') }),
    line({ orderId: 'order_c', quantity: 5, placedAt: new Date('2026-03-09T12:00:00.000Z') }),
  ]

  const expectedBuckets: Record<BackfillGrouping, number> = {
    order: 3,
    day: 2,
    week: 2,
    month: 1,
    range: 1,
  }

  for (const grouping of BACKFILL_GROUPINGS) {
    it(`collapses the same demand into ${expectedBuckets[grouping]} bucket(s) at '${grouping}' grouping`, () => {
      const plan = planBackfill(input({ grouping, lines: threeOrders }))

      const part = onlyPart(plan)
      expect(part.buckets).toHaveLength(expectedBuckets[grouping])
      expect(plan.buildCount).toBe(expectedBuckets[grouping])
      // The grouping is a presentation and write choice, never an input to the
      // arithmetic (section 7.1a).
      expect(part.quantityOrdered).toBe(15)
      expect(part.quantityToBuild).toBe(15)
      expect(plan.unitCount).toBe(15)
      expect(part.buckets.reduce((total, b) => total + b.quantityOrdered, 0)).toBe(15)
    })
  }

  it("collapses period start and end onto the order's own instant at 'order' grouping", () => {
    const plan = planBackfill(input({ grouping: 'order', lines: threeOrders }))

    const buckets = onlyPart(plan).buckets
    expect(buckets.map((b) => b.orderIds)).toEqual([['order_a'], ['order_b'], ['order_c']])
    expect(buckets[0]?.periodStart.toISOString()).toBe('2026-03-02T12:00:00.000Z')
    expect(buckets[0]?.periodEnd.toISOString()).toBe('2026-03-02T12:00:00.000Z')
    // Display only: two orders on one local day share a key, and `orderIds` is
    // what tells them apart.
    expect(buckets[0]?.periodKey).toBe('2026-03-02')
    expect(buckets[1]?.periodKey).toBe('2026-03-02')
  })

  it("keeps one order's lines together at 'order' grouping, dated to the earlier one", () => {
    const plan = planBackfill(
      input({
        grouping: 'order',
        lines: [
          line({ orderId: 'order_a', quantity: 2, placedAt: new Date('2026-03-04T12:00:00.000Z') }),
          line({ orderId: 'order_a', quantity: 3, placedAt: new Date('2026-03-02T12:00:00.000Z') }),
        ],
      })
    )

    const buckets = onlyPart(plan).buckets
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.quantityOrdered).toBe(5)
    expect(buckets[0]?.periodStart.toISOString()).toBe('2026-03-02T12:00:00.000Z')
  })

  it("spans every part's demand with one window at 'range' grouping", () => {
    const plan = planBackfill(
      input({
        grouping: 'range',
        lines: [
          line({ partId: LIFT, quantity: 4, placedAt: new Date('2026-01-15T12:00:00.000Z') }),
          line({ partId: HOIST, quantity: 6, placedAt: new Date('2026-08-20T12:00:00.000Z') }),
        ],
      })
    )

    const keys = plan.parts.flatMap((part) => part.buckets.map((b) => b.periodKey))
    expect(keys).toEqual(['2026-01-15..2026-08-20', '2026-01-15..2026-08-20'])
    const bucket = plan.parts[0]?.buckets[0]
    expect(bucket?.periodStart.toISOString()).toBe('2026-01-15T05:00:00.000Z')
    expect(bucket?.periodEnd.toISOString()).toBe('2026-08-21T04:00:00.000Z')
  })

  it('gives two same-day orders distinct bucket ids where their period keys collide', () => {
    const plan = planBackfill(input({ grouping: 'order', lines: threeOrders }))

    const buckets = onlyPart(plan).buckets
    expect(buckets.map((b) => b.bucketId)).toEqual([
      `${LIFT}:order_a`,
      `${LIFT}:order_b`,
      `${LIFT}:order_c`,
    ])
    // The pair anything else might have keyed off does collide.
    expect(new Set(buckets.map((b) => `${b.partId}:${b.periodKey}`)).size).toBe(2)
  })

  it('keys a calendar bucket by its part and period', () => {
    const plan = planBackfill(input({ lines: monthlyLines([10, 10]) }))

    expect(onlyPart(plan).buckets.map((b) => b.bucketId)).toEqual([
      `${LIFT}:2026-01`,
      `${LIFT}:2026-02`,
    ])
  })

  it('keeps bucket ids unique across the whole plan, at every grouping', () => {
    const lines = [...threeOrders, ...threeOrders.map((entry) => ({ ...entry, partId: HOIST }))]

    for (const grouping of BACKFILL_GROUPINGS) {
      const plan = planBackfill(input({ grouping, lines }))
      const ids = plan.parts.flatMap((part) => part.buckets.map((b) => b.bucketId))

      expect(ids).toHaveLength(plan.buildCount)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('gathers every order behind a bucket, deduplicated and sorted', () => {
    const plan = planBackfill(
      input({
        lines: [
          line({ orderId: 'order_c', quantity: 1 }),
          line({ orderId: 'order_a', quantity: 1 }),
          line({ orderId: 'order_c', quantity: 1 }),
          line({ orderId: 'order_b', quantity: 1 }),
        ],
      })
    )

    expect(onlyPart(plan).buckets[0]?.orderIds).toEqual(['order_a', 'order_b', 'order_c'])
  })
})

describe('planBackfill line hygiene', () => {
  it('contributes nothing from a non-positive or non-finite quantity', () => {
    const plan = planBackfill(
      input({
        lines: [
          line({ quantity: 0 }),
          line({ quantity: -5 }),
          line({ quantity: Number.NaN }),
          line({ quantity: Number.POSITIVE_INFINITY }),
          line({ quantity: 4 }),
        ],
      })
    )

    expect(onlyPart(plan).quantityOrdered).toBe(4)
    expect(onlyPart(plan).quantityToBuild).toBe(4)
  })

  it('leaves a part with no usable line out of the plan entirely, excluded or not', () => {
    // Not an exclusion: "0 ordered, not a built part" answers a question nobody
    // asked, and the screen is a list of what was ordered.
    const plan = planBackfill(
      input({
        lines: [line({ quantity: 0 }), line({ partId: BOLT, quantity: Number.NaN })],
      })
    )

    expect(plan.parts).toEqual([])
    expect(plan.excluded).toEqual([])
    expect(plan.buildCount).toBe(0)
    expect(plan.unitCount).toBe(0)
  })

  it('drops a line whose placed date is invalid rather than inventing a period', () => {
    const plan = planBackfill(
      input({
        lines: [line({ quantity: 6, placedAt: new Date('nonsense') }), line({ quantity: 2 })],
      })
    )

    expect(onlyPart(plan).quantityOrdered).toBe(2)
    expect(onlyPart(plan).buckets).toHaveLength(1)
  })

  it('returns an empty plan for no lines at all', () => {
    expect(planBackfill(input())).toEqual({
      parts: [],
      excluded: [],
      buildCount: 0,
      unitCount: 0,
    })
  })
})

describe('planBackfill determinism', () => {
  it('orders parts ascending by id, whatever order the lines arrive in', () => {
    const plan = planBackfill(
      input({
        lines: [
          line({ partId: HOIST, quantity: 1 }),
          line({ partId: BOLT, quantity: 1 }),
          line({ partId: LIFT, quantity: 1 }),
        ],
      })
    )

    expect(plan.parts.map((p) => p.partId)).toEqual([HOIST, LIFT])
    expect(plan.excluded.map((p) => p.partId)).toEqual([BOLT])
  })

  it('orders buckets chronologically, whatever order the lines arrive in', () => {
    const chronological = monthlyLines([1, 2, 3, 4, 5])
    const shuffled = [
      chronological[3],
      chronological[0],
      chronological[4],
      chronological[2],
      chronological[1],
    ].filter((entry): entry is BackfillDemandLine => entry !== undefined)

    const plan = planBackfill(input({ lines: shuffled }))

    expect(onlyPart(plan).buckets.map((b) => b.periodKey)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ])
    expect(
      onlyPart(plan).buckets.every(
        (bucket, index, all) =>
          index === 0 || (all[index - 1]?.periodStart.getTime() ?? 0) < bucket.periodStart.getTime()
      )
    ).toBe(true)
  })

  it('produces an identical plan from the same input in a different order', () => {
    const lines = [
      ...monthlyLines([10, 20, 30]),
      ...monthlyLines([5, 15], HOIST),
      line({ partId: BOLT, quantity: 2 }),
    ]
    const world = { quantitiesOnHand: new Map([[LIFT, 12]]), coverage: [coverage({ quantity: 7 })] }

    const first = planBackfill(input({ ...world, lines }))
    const second = planBackfill(input({ ...world, lines: [...lines].reverse() }))

    expect(second).toEqual(first)
  })

  it('totals the plan across every part', () => {
    const plan = planBackfill(
      input({ lines: [...monthlyLines([10, 20]), ...monthlyLines([5, 15], HOIST)] })
    )

    expect(plan.buildCount).toBe(4)
    expect(plan.unitCount).toBe(50)
    expect(plan.buildCount).toBe(plan.parts.reduce((n, part) => n + part.buckets.length, 0))
    expect(plan.unitCount).toBe(plan.parts.reduce((n, part) => n + part.quantityToBuild, 0))
  })
})
