// packages/lib/src/builds/__tests__/drift-queries.test.ts
//
// The read side. Its one dangerous answer is a false positive: report drift for
// a build that never claimed to follow an order and every historical build lights
// up at once, which teaches people to ignore the signal — the opposite of what
// Model A+ is for.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildRecord } from '../types'

const h = vi.hoisted(() => ({ bySystemAttributes: vi.fn(), rows: vi.fn() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return { schema, database: { select: () => ({ from: () => ({ where: () => h.rows() }) }) } }
})

import { readBuildDrift } from '../drift-queries'

const ORG = 'org_1'
const REVISION_FIELD = 'f-order-build-revision'

function build(overrides: Partial<BuildRecord> & { buildId: string }): BuildRecord {
  return {
    recordId: `def_build:${overrides.buildId}`,
    number: null,
    partId: 'p',
    status: 'planned',
    quantityPlanned: 1,
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
    orderRevision: 'hash-at-raise',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({ order_build_revision: { id: REVISION_FIELD } })
  h.rows.mockResolvedValue([])
})

describe('readBuildDrift', () => {
  it('reports drift when the order has moved on', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'hash-now' },
    ])

    const out = await readBuildDrift(undefined as never, ORG, [build({ buildId: 'b-1' })])

    expect(out.get('b-1')?.drifted).toBe(true)
  })

  it('reports no drift when the order still matches', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'hash-at-raise' },
    ])

    const out = await readBuildDrift(undefined as never, ORG, [build({ buildId: 'b-1' })])

    expect(out.get('b-1')?.drifted).toBe(false)
  })

  it('works identically for in_progress and completed — that is why it beat a status field', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'hash-now' },
    ])

    const out = await readBuildDrift(undefined as never, ORG, [
      build({ buildId: 'b-planned', status: 'planned' }),
      build({ buildId: 'b-running', status: 'in_progress' }),
      build({ buildId: 'b-done', status: 'completed' }),
    ])

    // Plan 13 §1.5 forbids automation from AMENDING an in_progress or completed
    // build. Nothing forbids being honest about one.
    for (const id of ['b-planned', 'b-running', 'b-done']) {
      expect(out.get(id)?.drifted).toBe(true)
    }
  })

  it('never calls a hand-raised build drifted', async () => {
    h.rows.mockResolvedValue([
      { entityId: 'ord-1', fieldId: REVISION_FIELD, valueText: 'hash-now' },
    ])

    const out = await readBuildDrift(undefined as never, ORG, [
      build({ buildId: 'b-manual', source: 'manual', orderRevision: null }),
    ])

    expect(out.get('b-manual')?.drifted).toBe(false)
  })

  it('never calls a build with no order drifted', async () => {
    const out = await readBuildDrift(undefined as never, ORG, [
      build({ buildId: 'b-loose', orderId: null, orderRevision: null }),
    ])

    expect(out.get('b-loose')?.drifted).toBe(false)
    // Nothing comparable, so nothing queried.
    expect(h.rows).not.toHaveBeenCalled()
  })

  it('never calls a build drifted when the order carries no fingerprint yet', async () => {
    h.rows.mockResolvedValue([])

    const out = await readBuildDrift(undefined as never, ORG, [build({ buildId: 'b-1' })])

    expect(out.get('b-1')?.drifted).toBe(false)
  })

  it('returns an entry for every build handed in, drifted or not', async () => {
    const out = await readBuildDrift(undefined as never, ORG, [
      build({ buildId: 'b-1' }),
      build({ buildId: 'b-2', orderId: null, orderRevision: null }),
    ])

    expect([...out.keys()].sort()).toEqual(['b-1', 'b-2'])
  })

  it('reads every order in ONE query', async () => {
    await readBuildDrift(undefined as never, ORG, [
      build({ buildId: 'b-1', orderId: 'ord-1' }),
      build({ buildId: 'b-2', orderId: 'ord-2' }),
      build({ buildId: 'b-3', orderId: 'ord-3' }),
    ])

    expect(h.rows).toHaveBeenCalledTimes(1)
  })

  it('answers an empty batch without touching the cache or the database', async () => {
    const out = await readBuildDrift(undefined as never, ORG, [])
    expect(out.size).toBe(0)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('reports no drift when the org has not run migration 111', async () => {
    h.bySystemAttributes.mockResolvedValue({ order_build_revision: null })

    const out = await readBuildDrift(undefined as never, ORG, [build({ buildId: 'b-1' })])

    expect(out.get('b-1')?.drifted).toBe(false)
  })
})
