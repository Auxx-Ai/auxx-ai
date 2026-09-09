// packages/lib/src/builds/__tests__/backfill-preflight.test.ts
//
// §7.3's gates 2, 3 and 4, unit tested.
//
// 🛑 **This file is the whole reason the preflight moved out of the router**
// (44 §11.3, 45 §12.7). The arithmetic here decides the sentence a person reads
// before appending several hundred rows to an append-only ledger, and while it
// lived in `routers/builds.ts` the only way to exercise it was a tRPC caller.
//
// The two properties that carry the weight:
//
//   1. The explosion is per PART at its whole-range quantity, but the movement
//      count is per BUCKET. Getting that wrong understates the consent by
//      exactly the factor the person is being asked to agree to.
//   2. Gate 4 REPORTS and never refuses. Negative projected on hand is a true
//      statement about a ledger missing its receipts, and refusing on it would
//      make the backfill unusable on the org that needs it most.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackfillPlan } from '../backfill-types'

const ORG = 'org_1'
const LIFT = 'part_lift'
const HOIST = 'part_hoist'
const MOTOR = 'part_motor'
const BOLT = 'part_bolt'

const h = vi.hoisted(() => ({
  /** partId -> the components one unit of it consumes. */
  explosions: new Map<string, { partId: string; quantityConsumed: number }[]>(),
  /** partId -> the parts its explosion reports as having no standard cost. */
  missingStandard: new Map<string, string[]>(),
  /** partIds whose explosion must return an `err`. */
  explodeRefusals: new Map<string, Error>(),
  /** partId -> quantity on hand. */
  onHand: new Map<string, number>(),
  /** partId -> display name. */
  names: new Map<string, string>(),
}))

vi.mock('../build-queries', () => ({
  explodeBuildComponents: vi.fn(
    async (_db: unknown, _org: string, input: { partId: string; quantityProduced: number }) => {
      const refusal = h.explodeRefusals.get(input.partId)
      if (refusal) return err(refusal)
      const perUnit = h.explosions.get(input.partId) ?? []
      return ok({
        components: perUnit.map((line) => ({
          partId: line.partId,
          quantityConsumed: line.quantityConsumed * input.quantityProduced,
        })),
        missingStandardPartIds: h.missingStandard.get(input.partId) ?? [],
      })
    }
  ),
  readPartNames: vi.fn(async (_db: unknown, _org: string, ids: string[]) => {
    const out = new Map<string, string>()
    for (const id of ids) {
      const name = h.names.get(id)
      if (name) out.set(id, name)
    }
    return out
  }),
}))

vi.mock('../auto-build-queries', () => ({
  readPartQuantitiesOnHand: vi.fn(async (_db: unknown, _org: string, ids: string[]) => {
    const out = new Map<string, number>()
    for (const id of ids) out.set(id, h.onHand.get(id) ?? 0)
    return out
  }),
}))

import { computeBackfillPreflight } from '../backfill-preflight'

/** A plan with one part per entry, `buckets` counted rather than described. */
function plan(parts: { partId: string; quantityToBuild: number; buckets: number }[]): BackfillPlan {
  return {
    parts: parts.map((part) => ({
      partId: part.partId,
      quantityToBuild: part.quantityToBuild,
      quantityOrdered: part.quantityToBuild,
      quantityCovered: 0,
      buckets: Array.from({ length: part.buckets }, (_, index) => ({
        bucketId: `${part.partId}:${index}`,
        partId: part.partId,
        periodKey: `2026-0${index + 1}`,
        periodStart: new Date('2026-01-01T00:00:00.000Z'),
        periodEnd: new Date('2026-02-01T00:00:00.000Z'),
        quantityOrdered: 1,
        quantityCovered: 0,
        quantityToBuild: 1,
        orderIds: [],
      })),
    })),
    excluded: [],
    buildCount: parts.reduce((sum, part) => sum + part.buckets, 0),
  } as unknown as BackfillPlan
}

beforeEach(() => {
  vi.clearAllMocks()
  h.explosions.clear()
  h.missingStandard.clear()
  h.explodeRefusals.clear()
  h.onHand.clear()
  h.names.clear()
})

describe('computeBackfillPreflight', () => {
  it('counts one produce plus one consume per component, per BUCKET', async () => {
    // One part, two components, three buckets: 3 * (2 + 1) = 9.
    h.explosions.set(LIFT, [
      { partId: MOTOR, quantityConsumed: 1 },
      { partId: BOLT, quantityConsumed: 4 },
    ])

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([{ partId: LIFT, quantityToBuild: 3, buckets: 3 }])
    )

    expect(result.isOk()).toBe(true)
    const preflight = result._unsafeUnwrap()
    expect(preflight.movementCount).toBe(9)
    expect(preflight.buildCount).toBe(3)
  })

  it('explodes once per part at the WHOLE range quantity, not once per bucket', async () => {
    h.explosions.set(LIFT, [{ partId: MOTOR, quantityConsumed: 2 }])
    const { explodeBuildComponents } = await import('../build-queries')

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([{ partId: LIFT, quantityToBuild: 10, buckets: 4 }])
    )

    // Four buckets, ONE explosion, asked for all ten units at once.
    expect(explodeBuildComponents).toHaveBeenCalledTimes(1)
    expect(explodeBuildComponents).toHaveBeenCalledWith({}, ORG, {
      partId: LIFT,
      quantityProduced: 10,
    })
    expect(result._unsafeUnwrap().projectedOnHand[0]?.consumed).toBe(20)
  })

  it('totals a shared component across every part that consumes it', async () => {
    h.explosions.set(LIFT, [{ partId: BOLT, quantityConsumed: 4 }])
    h.explosions.set(HOIST, [{ partId: BOLT, quantityConsumed: 6 }])
    h.onHand.set(BOLT, 100)

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([
        { partId: LIFT, quantityToBuild: 2, buckets: 1 },
        { partId: HOIST, quantityToBuild: 3, buckets: 1 },
      ])
    )

    const bolt = result._unsafeUnwrap().projectedOnHand.find((row) => row.partId === BOLT)
    expect(bolt).toMatchObject({ onHand: 100, consumed: 26, projected: 74 })
  })

  it('REPORTS a negative projection rather than refusing it (gate 4)', async () => {
    h.explosions.set(LIFT, [{ partId: MOTOR, quantityConsumed: 5 }])
    h.onHand.set(MOTOR, 2)

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([{ partId: LIFT, quantityToBuild: 10, buckets: 1 }])
    )

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().projectedOnHand[0]).toMatchObject({
      partId: MOTOR,
      onHand: 2,
      consumed: 50,
      projected: -48,
    })
  })

  it('sorts the worst projection first', async () => {
    h.explosions.set(LIFT, [
      { partId: MOTOR, quantityConsumed: 1 },
      { partId: BOLT, quantityConsumed: 50 },
    ])
    h.onHand.set(MOTOR, 100)
    h.onHand.set(BOLT, 1)

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([{ partId: LIFT, quantityToBuild: 1, buckets: 1 }])
    )

    expect(result._unsafeUnwrap().projectedOnHand.map((row) => row.partId)).toEqual([BOLT, MOTOR])
  })

  it('collects unpriced parts across every explosion, de-duplicated, with names', async () => {
    h.explosions.set(LIFT, [{ partId: MOTOR, quantityConsumed: 1 }])
    h.explosions.set(HOIST, [{ partId: MOTOR, quantityConsumed: 1 }])
    h.missingStandard.set(LIFT, [MOTOR])
    h.missingStandard.set(HOIST, [MOTOR, BOLT])
    h.names.set(MOTOR, 'Motor assembly')

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([
        { partId: LIFT, quantityToBuild: 1, buckets: 1 },
        { partId: HOIST, quantityToBuild: 1, buckets: 1 },
      ])
    )

    const unpriced = result._unsafeUnwrap().unpricedParts
    expect(unpriced).toHaveLength(2)
    expect(unpriced).toContainEqual({ partId: MOTOR, partName: 'Motor assembly' })
    // No name row, so `null` rather than the raw cuid leaking into the dialog.
    expect(unpriced).toContainEqual({ partId: BOLT, partName: null })
  })

  it('fails as a WHOLE when one part cannot be exploded', async () => {
    // Unlike `executeBackfill`, which isolates per bucket: this writes nothing,
    // and a silently omitted part would under-report the consent being asked for.
    h.explosions.set(LIFT, [{ partId: MOTOR, quantityConsumed: 1 }])
    h.explodeRefusals.set(HOIST, new Error('no bill of materials'))

    const result = await computeBackfillPreflight(
      {} as never,
      ORG,
      plan([
        { partId: LIFT, quantityToBuild: 1, buckets: 1 },
        { partId: HOIST, quantityToBuild: 1, buckets: 1 },
      ])
    )

    expect(result.isErr()).toBe(true)
  })

  it('is empty and does not throw on a plan with no parts', async () => {
    const result = await computeBackfillPreflight({} as never, ORG, plan([]))

    expect(result._unsafeUnwrap()).toMatchObject({
      buildCount: 0,
      movementCount: 0,
      unpricedParts: [],
      projectedOnHand: [],
    })
  })
})
