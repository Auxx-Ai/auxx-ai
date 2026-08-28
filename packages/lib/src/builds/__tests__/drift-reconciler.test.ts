// packages/lib/src/builds/__tests__/drift-reconciler.test.ts
//
// Model A+ is defined as much by what it does NOT do as by what it does, and the
// "does not" half is invisible to every other test in this package: a reconciler
// that quietly cancelled a `planned` build would leave `order_build_revision`
// looking perfectly correct. These pin the restraint, the feature gate and the
// coalescing.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithDirtyParents } from '../../reconcilers/dirty-parents'

const h = vi.hoisted(() => ({
  loadAutoBuildSettings: vi.fn(),
  loadAutoBuildOrders: vi.fn(),
  bySystemAttributes: vi.fn(),
  getCachedEntityDefId: vi.fn(),
  setValuesForEntity: vi.fn(),
  rows: vi.fn(),
  createBuild: vi.fn(),
  cancelBuild: vi.fn(),
}))

vi.mock('../auto-build-settings', () => ({ loadAutoBuildSettings: h.loadAutoBuildSettings }))
vi.mock('../auto-build-queries', () => ({ loadAutoBuildOrders: h.loadAutoBuildOrders }))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  getCachedEntityDefId: h.getCachedEntityDefId,
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
// The two writers this must never reach. Spied, not stubbed away, so a call
// would be recorded rather than silently succeeding.
vi.mock('../build-mutations', () => ({
  createBuild: h.createBuild,
  cancelBuild: h.cancelBuild,
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

const ORG = 'org_1'
const ORDER_DEF = 'def_order'
const REVISION_FIELD = 'f-order-build-revision'
const LINE_ORDER_FIELD = 'f-line-order'

/** What was written to which order, on the last stamp. */
function stamped(): Array<{ recordId: string; value: unknown }> {
  return h.setValuesForEntity.mock.calls.map((call) => {
    const arg = call[0] as { recordId: string; values: Array<{ value: unknown }> }
    return { recordId: arg.recordId, value: arg.values[0]?.value }
  })
}

beforeAll(() => {
  registerOrderDriftReconcilers()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.loadAutoBuildSettings.mockResolvedValue({
    enabled: true,
    enabledAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'planned',
    stockRule: 'out_of_stock_only',
  })
  h.loadAutoBuildOrders.mockResolvedValue([
    {
      orderId: 'ord-1',
      placedAt: new Date(),
      cancelledAt: null,
      lines: [{ partId: 'p', quantity: 3 }],
    },
  ])
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
})

describe('it mutates no build, ever', () => {
  it('stamps the ORDER and calls neither createBuild nor cancelBuild', async () => {
    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    expect(stamped()).toHaveLength(1)
    expect(stamped()[0]?.recordId).toContain('ord-1')
    // The whole point of Model A+ over Model B (plan 13 §3): the product
    // decision stays open because nothing was decided on anyone's behalf.
    expect(h.createBuild).not.toHaveBeenCalled()
    expect(h.cancelBuild).not.toHaveBeenCalled()
  })

  it('writes exactly one field, and it is the revision', async () => {
    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    const call = h.setValuesForEntity.mock.calls[0]?.[0] as { values: Array<{ fieldId: string }> }
    expect(call.values).toHaveLength(1)
    expect(call.values[0]?.fieldId).toBe(REVISION_FIELD)
  })
})

describe('the feature gate', () => {
  it('stamps nothing when auto-build is switched off', async () => {
    h.loadAutoBuildSettings.mockResolvedValue({
      enabled: false,
      enabledAt: null,
      status: 'planned',
      stockRule: 'out_of_stock_only',
    })

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    // Nothing can drift from a build that will never be raised, so a stamp here
    // is a field write bought for nothing on every order edit in every org that
    // does not manufacture. It also settles the seed lane: the setting is off by
    // default, so a seeded demo org stamps nothing.
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
    expect(h.loadAutoBuildOrders).not.toHaveBeenCalled()
  })

  it('stamps an order placed BEFORE the enablement window — a position on plan 13 Q11', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      {
        orderId: 'ord-old',
        placedAt: new Date('2020-01-01T00:00:00.000Z'),
        cancelledAt: null,
        lines: [{ partId: 'p', quantity: 1 }],
      },
    ])

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-old')
    })

    // AB8's window exists so switching auto-build on does not RAISE builds for
    // the backlog. This raises nothing, and honouring the window here would
    // leave every pre-enablement order permanently unable to show drift — the
    // exact defect 13 §0 is about. Revisit before phase 5 turns `apply` on.
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('stamps nothing when the org has not run migration 111', async () => {
    h.bySystemAttributes.mockResolvedValue({ order_build_revision: null })

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('the no-op guard', () => {
  it('skips the write when the stored fingerprint already matches', async () => {
    // Stamp once to learn the hash this demand produces...
    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })
    const fingerprint = stamped()[0]?.value
    vi.clearAllMocks()
    beforeEachState()

    // ...then hand it back as what is already stored.
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: fingerprint },
    ])

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('writes when the stored fingerprint is stale', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'a-stale-hash' },
    ])

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})

describe('coalescing', () => {
  it('stamps once however many lines of one order moved', async () => {
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
  })

  it('marks rather than acting when a scope is open', async () => {
    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
      // Still inside the write — the drain has not run.
      expect(h.setValuesForEntity).not.toHaveBeenCalled()
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('stamps inline when no write method opened a scope', async () => {
    await markOrStampOrder(ORG, 'ord-1')
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('exposes distinct keys for the order and line doors', () => {
    expect(ORDER_DRIFT_ORDER).not.toBe(ORDER_DRIFT_LINE)
  })
})

describe('failure isolation', () => {
  it('does not throw out of the hook when the stamp write fails', async () => {
    h.setValuesForEntity.mockRejectedValue(new Error('write failed'))

    await expect(
      runWithDirtyParents(ORG, 'usr_1', async () => {
        await markOrStampOrder(ORG, 'ord-1')
      })
    ).resolves.toBeUndefined()
  })

  it('stamps the rest of the batch when one order fails', async () => {
    h.loadAutoBuildOrders.mockResolvedValue([
      {
        orderId: 'ord-1',
        placedAt: new Date(),
        cancelledAt: null,
        lines: [{ partId: 'p', quantity: 1 }],
      },
      {
        orderId: 'ord-2',
        placedAt: new Date(),
        cancelledAt: null,
        lines: [{ partId: 'q', quantity: 2 }],
      },
    ])
    h.setValuesForEntity.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)

    await runWithDirtyParents(ORG, 'usr_1', async () => {
      await markOrStampOrder(ORG, 'ord-1')
      await markOrStampOrder(ORG, 'ord-2')
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(2)
  })
})

/** Re-apply the defaults `beforeEach` sets, after an in-test `clearAllMocks`. */
function beforeEachState() {
  h.loadAutoBuildSettings.mockResolvedValue({
    enabled: true,
    enabledAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'planned',
    stockRule: 'out_of_stock_only',
  })
  h.loadAutoBuildOrders.mockResolvedValue([
    {
      orderId: 'ord-1',
      placedAt: new Date(),
      cancelledAt: null,
      lines: [{ partId: 'p', quantity: 3 }],
    },
  ])
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
}
