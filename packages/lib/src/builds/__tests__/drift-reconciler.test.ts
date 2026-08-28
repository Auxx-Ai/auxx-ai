// packages/lib/src/builds/__tests__/drift-reconciler.test.ts
//
// The reconciler is defined as much by what it does NOT do as by what it does,
// and the "does not" half is invisible to every other test in this package: a
// pass that quietly cancelled somebody's own build would leave
// `order_build_revision` looking perfectly correct.
//
// 🛑 This file used to assert "it mutates no build, ever" (Model A+, #1958).
// That assertion is now false ON PURPOSE — plan 13 chose Model B on 2026-08-28
// and events/08 phase 5 turned `apply` on. What is pinned here instead is the
// restraint that REMAINS, which is most of what the old suite was really about:
// manual builds, in-progress builds, completed builds, the no-op guard, the AB8
// window (plan 13 Q11) and the cancelled-order hand-off are all still untouched
// or unwritten, and each has a test below saying so.
//
// The whole stamp -> converge path runs for real here: only the leaves are
// doubled (the reads, the three build mutations, the system user), so the
// assertions below are about what the reconciler actually asks the writers to
// do rather than about an intermediate value.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithDirtyParents } from '../../reconcilers/dirty-parents'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const ORDER_DEF = 'def_order'
const REVISION_FIELD = 'f-order-build-revision'
const LINE_ORDER_FIELD = 'f-line-order'
const SYSTEM_USER = 'user_system'
const LIFT = 'part_lift'
/** After `enabledAt`, so every fixture order is inside the AB8 window by default. */
const PLACED_AT = new Date('2026-08-27T00:00:00.000Z')

const h = vi.hoisted(() => ({
  loadAutoBuildSettings: vi.fn(),
  loadAutoBuildOrders: vi.fn(),
  readPartQuantitiesOnHand: vi.fn(),
  readPartKinds: vi.fn(),
  loadDirectSubparts: vi.fn(),
  readOrderRaisedBuilds: vi.fn(),
  getSystemUserForActions: vi.fn(),
  bySystemAttributes: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  setValuesForEntity: vi.fn(),
  rows: vi.fn(),
  createBuild: vi.fn(),
  cancelBuild: vi.fn(),
  amendPlannedBuildQuantity: vi.fn(),
}))

vi.mock('../auto-build-settings', () => ({ loadAutoBuildSettings: h.loadAutoBuildSettings }))
vi.mock('../auto-build-queries', () => ({
  loadAutoBuildOrders: h.loadAutoBuildOrders,
  readPartQuantitiesOnHand: h.readPartQuantitiesOnHand,
}))
vi.mock('../build-queries', () => ({ readPartKinds: h.readPartKinds }))
vi.mock('../../bom/subpart-graph', () => ({ loadDirectSubparts: h.loadDirectSubparts }))
vi.mock('../reconcile-queries', () => ({ readOrderRaisedBuilds: h.readOrderRaisedBuilds }))
vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: h.getSystemUserForActions },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  getCachedEntityDefId: h.getCachedEntityDefId,
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
// The three build writers. Spied rather than stubbed away, so a call that must
// not happen is RECORDED rather than silently succeeding.
vi.mock('../build-mutations', () => ({
  createBuild: h.createBuild,
  cancelBuild: h.cancelBuild,
  amendPlannedBuildQuantity: h.amendPlannedBuildQuantity,
}))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return {
    schema,
    database: { select: () => ({ from: () => ({ where: () => h.rows() }) }) },
  }
})

import {
  markOrStampOrder,
  markOrStampOrderLine,
  ORDER_DRIFT_LINE,
  ORDER_DRIFT_ORDER,
  registerOrderDriftReconcilers,
} from '../drift-reconciler'

/** What was written to which order, on the last stamp. */
function stamped(): Array<{ recordId: string; value: unknown }> {
  return h.setValuesForEntity.mock.calls.map((call) => {
    const arg = call[0] as { recordId: string; values: Array<{ value: unknown }> }
    return { recordId: arg.recordId, value: arg.values[0]?.value }
  })
}

/** Every build write the pass attempted, whichever mutation performed it. */
function buildWrites(): number {
  return (
    h.createBuild.mock.calls.length +
    h.cancelBuild.mock.calls.length +
    h.amendPlannedBuildQuantity.mock.calls.length
  )
}

let sequence = 0

/** A `planned`, order-raised build of 3 lifts — the shape convergence acts on. */
function build(overrides: Partial<BuildRecord> = {}): BuildRecord {
  sequence += 1
  return {
    buildId: `build_${sequence}`,
    recordId: `def_build:build_${sequence}`,
    number: null,
    partId: LIFT,
    status: 'planned',
    quantityPlanned: 3,
    quantityProduced: null,
    quantityScrapped: null,
    startedAt: null,
    completedAt: null,
    materialCost: null,
    laborCost: null,
    overheadCost: null,
    producedValue: null,
    varianceAmount: null,
    postedAt: null,
    notes: null,
    orderId: 'ord-1',
    source: 'order',
    reversalOfBuildId: null,
    orderRevision: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as BuildRecord
}

beforeAll(() => {
  registerOrderDriftReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  applyDefaults()
})

// ─── what convergence still refuses to touch ────────────────────────────

/**
 * Plan 13 §5's rail set, asserted at the reconciler rather than at the pure
 * layer. `reconcile-policy.test.ts` proves the DECISION; these prove that the
 * decision is the one that reaches the writers.
 */
describe('the restraint that remains', () => {
  it("never touches a `source: 'manual'` build — it raises its own instead", async () => {
    // A person's own build for the same part, against the same order (AB7).
    h.readOrderRaisedBuilds.mockResolvedValue([build({ source: 'manual', quantityPlanned: 99 })])

    await drain('ord-1')

    expect(h.amendPlannedBuildQuantity).not.toHaveBeenCalled()
    expect(h.cancelBuild).not.toHaveBeenCalled()
    // And it does not block the order's own build either — a manual build must
    // never suppress an order's build set forever.
    expect(h.createBuild).toHaveBeenCalledTimes(1)
  })

  it('never amends or cancels an `in_progress` build — material may already be cut', async () => {
    h.readOrderRaisedBuilds.mockResolvedValue([
      build({ status: 'in_progress', quantityPlanned: 1 }),
    ])

    await drain('ord-1')

    // The order says 3 and the build says 1, and it stays saying 1. §1.0(a): an
    // in-progress build is cancellable by the ORDER-CANCELLATION sweep and never
    // silently amendable by this one.
    expect(buildWrites()).toBe(0)
  })

  it('never amends, cancels or deletes a `completed` build (B6/B8)', async () => {
    h.readOrderRaisedBuilds.mockResolvedValue([build({ status: 'completed', quantityPlanned: 1 })])

    await drain('ord-1')

    // A completed build is REVERSED, never edited or deleted — and never by this
    // pass at all: an edited line is not a cancelled order.
    expect(buildWrites()).toBe(0)
  })

  it('writes nothing at all when the fingerprint is unchanged', async () => {
    const fingerprint = await learnFingerprint()
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: fingerprint },
    ])
    // A build that WOULD be raised, to prove the guard and not an empty world.
    h.readOrderRaisedBuilds.mockResolvedValue([])

    await drain('ord-1')

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(buildWrites()).toBe(0)
    // The guard short-circuits before the build read, not after it.
    expect(h.readOrderRaisedBuilds).not.toHaveBeenCalled()
  })

  it('🛑 stamps an order OUTSIDE the enablement window but builds nothing for it (Q11)', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      { orderId: 'ord-old', placedAt: new Date('2020-01-01T00:00:00.000Z'), ...demand() },
    ])

    await drain('ord-old')

    // The split plan 13 Q11 was answered with, in one assertion. STAMPING
    // ignores the window: honouring it would leave every pre-enablement order
    // permanently unable to show drift, which is 13 §0's defect. APPLYING
    // honours it: under Model B a reconcile is a raise door, so an unwindowed
    // apply manufactures against years of back-filled Shopify history.
    expect(stamped()).toHaveLength(1)
    expect(buildWrites()).toBe(0)
  })

  it('leaves a CANCELLED order to `cancelAutoBuildsForOrders`', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      {
        orderId: 'ord-1',
        placedAt: PLACED_AT,
        cancelledAt: new Date('2026-08-28T00:00:00.000Z'),
        lines: [],
      },
    ])
    h.readOrderRaisedBuilds.mockResolvedValue([build()])

    await drain('ord-1')

    // Naive convergence would cancel every planned build here, duplicating a
    // sweep that already does it AND reverses `completed` ones — and which is
    // deliberately not gated on the feature switch. Two writers of one build set
    // is worse than one.
    expect(stamped()).toHaveLength(1)
    expect(buildWrites()).toBe(0)
  })
})

// ─── the stamp itself ───────────────────────────────────────────────────

describe('the stamp', () => {
  it('writes exactly one field on the order, and it is the revision', async () => {
    await drain('ord-1')

    const call = h.setValuesForEntity.mock.calls[0]?.[0] as { values: Array<{ fieldId: string }> }
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    expect(call.values).toHaveLength(1)
    expect(call.values[0]?.fieldId).toBe(REVISION_FIELD)
    expect(stamped()[0]?.recordId).toContain('ord-1')
  })

  it('does not converge when the stamp write failed', async () => {
    h.setValuesForEntity.mockRejectedValue(new Error('write failed'))

    await drain('ord-1')

    // Converging would re-stamp the BUILDS with the new fingerprint while the
    // ORDER still carries the old one, and `hasDrifted` compares exactly those
    // two — so the pass would report drift on the builds it had just converged.
    expect(buildWrites()).toBe(0)
  })
})

// ─── the convergence that now happens ───────────────────────────────────

describe('what it DOES write (Model B)', () => {
  it('raises the first build for an order whose lines arrived after the header', async () => {
    h.readOrderRaisedBuilds.mockResolvedValue([])

    await drain('ord-1')

    // 13 §1.2: every interactive order creates its header before any line
    // exists, so the `created` trigger fires against an empty order and raises
    // nothing. This is the fix, and it is the main win rather than a bonus.
    expect(h.createBuild).toHaveBeenCalledTimes(1)
    expect(h.createBuild.mock.calls[0]?.[3]).toMatchObject({
      partId: LIFT,
      quantityPlanned: 3,
      orderId: 'ord-1',
      source: 'order',
    })
  })

  it('amends a planned build the order has outgrown, re-stamping in the same call', async () => {
    h.readOrderRaisedBuilds.mockResolvedValue([build({ quantityPlanned: 1 })])

    await drain('ord-1')

    const input = h.amendPlannedBuildQuantity.mock.calls[0]?.[3] as {
      quantityPlanned: number
      orderRevision: string
    }
    expect(input.quantityPlanned).toBe(3)
    // The build stops differing from its order at exactly this moment; leaving
    // the old stamp would report drift that has just been resolved.
    expect(input.orderRevision).toBe(stamped()[0]?.value)
    expect(h.createBuild).not.toHaveBeenCalled()
  })

  it('cancels — never deletes — a planned build for a part the order dropped (AB6)', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      { orderId: 'ord-1', placedAt: PLACED_AT, cancelledAt: null, lines: [] },
    ])
    h.readOrderRaisedBuilds.mockResolvedValue([build()])

    await drain('ord-1')

    expect(h.cancelBuild).toHaveBeenCalledTimes(1)
    expect(h.cancelBuild.mock.calls[0]?.[3]).toMatchObject({ reason: 'Order changed' })
  })

  it('writes as a REAL system user, not the empty stamp actor', async () => {
    h.readOrderRaisedBuilds.mockResolvedValue([])

    await drain('ord-1')

    // `SYSTEM_STAMP_USER` is `''` because `order_build_revision` has no
    // interactive writer; the build mutations reach `UnifiedCrudHandler`, which
    // does read its actor.
    expect(h.createBuild.mock.calls[0]?.[2]).toBe(SYSTEM_USER)
  })
})

// ─── the feature gate ───────────────────────────────────────────────────

describe('the feature gate', () => {
  it('stamps nothing and builds nothing when auto-build is switched off', async () => {
    h.loadAutoBuildSettings.mockResolvedValue({
      enabled: false,
      enabledAt: null,
      status: 'planned',
      stockRule: 'out_of_stock_only',
    })

    await drain('ord-1')

    // Nothing can drift from a build that will never be raised. It also settles
    // the seed lane: the setting is off by default, so a seeded demo order
    // stamps nothing and manufactures nothing (plan 13 §5).
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(h.loadAutoBuildOrders).not.toHaveBeenCalled()
    expect(buildWrites()).toBe(0)
  })

  it('stamps nothing when the org has not run migration 111', async () => {
    h.bySystemAttributes.mockResolvedValue({ order_build_revision: null })

    await drain('ord-1')

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(buildWrites()).toBe(0)
  })
})

// ─── the no-op guard ────────────────────────────────────────────────────

describe('the no-op guard', () => {
  it('skips the write when the stored fingerprint already matches', async () => {
    const fingerprint = await learnFingerprint()
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: fingerprint },
    ])

    await drain('ord-1')

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('writes when the stored fingerprint is stale', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'a-stale-hash' },
    ])

    await drain('ord-1')

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})

// ─── coalescing ─────────────────────────────────────────────────────────

describe('coalescing', () => {
  it('reconciles once however many lines of one order moved', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'li-1', fieldId: LINE_ORDER_FIELD, relatedEntityId: 'ord-1' },
      { entityId: 'li-2', fieldId: LINE_ORDER_FIELD, relatedEntityId: 'ord-1' },
    ])

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      for (const line of ['li-1', 'li-2']) {
        await markOrStampOrderLine(ORG, line)
        await markOrStampOrderLine(ORG, line)
      }
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    expect(h.createBuild).toHaveBeenCalledTimes(1)
  })

  it('marks rather than acting when a scope is open', async () => {
    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
      // Still inside the write — the drain has not run.
      expect(h.setValuesForEntity).not.toHaveBeenCalled()
      expect(buildWrites()).toBe(0)
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('reconciles inline when no write method opened a scope', async () => {
    await markOrStampOrder(ORG, 'ord-1')
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('exposes distinct keys for the order and line doors', () => {
    expect(ORDER_DRIFT_ORDER).not.toBe(ORDER_DRIFT_LINE)
  })
})

// ─── failure isolation ──────────────────────────────────────────────────

describe('failure isolation', () => {
  it('does not throw out of the hook when the stamp write fails', async () => {
    h.setValuesForEntity.mockRejectedValue(new Error('write failed'))

    await expect(
      runWithDirtyParents(ORG, 'usr_1', async () => {
        await markOrStampOrder(ORG, 'ord-1')
      })
    ).resolves.toBeUndefined()
  })

  it('does not throw out of the hook when a BUILD write fails', async () => {
    h.createBuild.mockRejectedValue(new Error('the build writer is on fire'))

    await expect(
      runWithDirtyParents(ORG, 'usr_1', async () => {
        await markOrStampOrder(ORG, 'ord-1')
      })
    ).resolves.toBeUndefined()
    // The stamp still landed. Model A+ underneath: the divergence stays visible.
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('reconciles the rest of the batch when one order fails to stamp', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      { orderId: 'ord-1', placedAt: PLACED_AT, ...demand() },
      { orderId: 'ord-2', placedAt: PLACED_AT, ...demand() },
    ])
    h.setValuesForEntity.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
      await markOrStampOrder(ORG, 'ord-2')
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(2)
    // Only the order that stamped converges — see `the stamp` above.
    expect(h.createBuild).toHaveBeenCalledTimes(1)
    expect(h.createBuild.mock.calls[0]?.[3]).toMatchObject({ orderId: 'ord-2' })
  })

  it('builds the rest of the batch when one order fails to converge', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      { orderId: 'ord-1', placedAt: PLACED_AT, ...demand() },
      { orderId: 'ord-2', placedAt: PLACED_AT, ...demand() },
    ])
    h.readOrderRaisedBuilds
      .mockRejectedValueOnce(new Error('the build read is on fire'))
      .mockResolvedValue([])

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
      await markOrStampOrder(ORG, 'ord-2')
    })

    expect(h.createBuild).toHaveBeenCalledTimes(1)
    expect(h.createBuild.mock.calls[0]?.[3]).toMatchObject({ orderId: 'ord-2' })
  })
})

// ─── fixtures ───────────────────────────────────────────────────────────

/** One drain of the order door, with a scope open so the coalescer is exercised. */
async function drain(orderId: string): Promise<void> {
  await runWithDirtyParents(ORG, 'usr_1', async () => {
    await markOrStampOrder(ORG, orderId)
  })
}

/** The demand every fixture order carries: three lifts, not cancelled. */
function demand() {
  return { cancelledAt: null, lines: [{ partId: LIFT, quantity: 3 }] }
}

/**
 * Run once to discover the hash this demand produces, then reset.
 *
 * The fingerprint is a real `stableHash` of real inputs and hard-coding it here
 * would pin an implementation detail of `order-fingerprint.ts` in the wrong file.
 */
async function learnFingerprint(): Promise<unknown> {
  await drain('ord-1')
  const fingerprint = stamped()[0]?.value
  vi.clearAllMocks()
  applyDefaults()
  return fingerprint
}

/** Re-apply the `beforeEach` defaults, after an in-test `clearAllMocks`. */
function applyDefaults() {
  h.loadAutoBuildSettings.mockResolvedValue({
    enabled: true,
    enabledAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'planned',
    stockRule: 'out_of_stock_only',
  })
  h.loadAutoBuildOrders.mockResolvedValue([{ orderId: 'ord-1', placedAt: PLACED_AT, ...demand() }])
  h.bySystemAttributes.mockImplementation(async (attrs: readonly string[]) => {
    const out: Record<string, { id: string } | null> = {}
    for (const attr of attrs) {
      if (attr === 'order_build_revision') out[attr] = { id: REVISION_FIELD }
      else if (attr === 'line_item_order') out[attr] = { id: LINE_ORDER_FIELD }
      else out[attr] = null
    }
    return out
  })
  h.getCachedEntityDefId.mockResolvedValue(ORDER_DEF)
  h.setValuesForEntity.mockResolvedValue(undefined)
  h.rows.mockResolvedValue([])

  // A world where the lift is buildable and nothing is on the shelf, so
  // admission turns entirely on what each test varies.
  h.readPartKinds.mockResolvedValue(new Map([[LIFT, 'finished_good']]))
  h.readPartQuantitiesOnHand.mockResolvedValue(new Map([[LIFT, 0]]))
  h.loadDirectSubparts.mockResolvedValue([{ childId: 'part_motor', qty: 2 }])
  h.readOrderRaisedBuilds.mockResolvedValue([])
  h.getSystemUserForActions.mockResolvedValue(SYSTEM_USER)
  h.createBuild.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    sequence += 1
    return ok({ buildId: `build_new_${sequence}` })
  })
  h.amendPlannedBuildQuantity.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok({ buildId: 'build_amended' })
  })
  h.cancelBuild.mockImplementation(async () => {
    const { ok } = await import('neverthrow')
    return ok({ buildId: 'build_cancelled' })
  })
}
