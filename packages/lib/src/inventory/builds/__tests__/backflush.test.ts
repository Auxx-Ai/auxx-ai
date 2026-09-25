// packages/lib/src/inventory/builds/__tests__/backflush.test.ts
//
// Backflush (111 D23/D24): the replay `qoh(day) < 0 → one build of the shortfall`, parents
// before the children they consume, dated the end of the local day, rolled first, idempotent.
//
// The ledger is an in-memory list of dated movements. The `completeBuild` double appends the
// produce and consume legs a real completion writes, so the parent-before-child property is
// exercised through the same dated read the run uses, not asserted by inspection.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { SubpartEdge } from '../../costing/standard-cost-roll'

const ORG = 'org_1'
const USER = 'user_1'
const LIFT = 'part_lift'
const MOTOR = 'part_motor'
const BOLT = 'part_bolt'
const COIL = 'part_coil'
const TZ = 'America/New_York'
/** 2026-09-23 23:59:59.999 in New York. */
const END_0923 = new Date('2026-09-24T03:59:59.999Z')
const END_0924 = new Date('2026-09-25T03:59:59.999Z')
const NOW = new Date('2026-09-26T12:00:00.000Z')

interface Movement {
  partId: string
  quantity: number
  at: Date
}

const h = vi.hoisted(() => ({
  timeZone: 'America/New_York' as string | null,
  ledger: [] as Movement[],
  subparts: [] as { parentPartId: string; childPartId: string; quantity: number }[],
  partKinds: new Map<string, string>(),
  standardCosts: new Map<string, number>(),
  standardCostSources: new Map<string, string>(),
  archived: new Set<string>(),
  calls: [] as string[],
  createCalls: [] as Record<string, unknown>[],
  completeCalls: [] as Record<string, unknown>[],
  rollCalls: [] as Record<string, unknown>[],
  completeRefusals: new Map<string, Error>(),
  rollRefusal: null as Error | null,
  numbering: 0,
  nextBuild: 0,
  buildParts: new Map<string, string>(),
}))

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async () => h.timeZone),
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    get: async (_org: string, key: string) => (key === 'systemUser' ? 'user_system' : null),
    from: () => ({
      bySystemAttributes: async () => ({ build_batch_run: { id: 'f_batch_run' } }),
    }),
  }),
}))

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: {
    create: vi.fn(async () => {
      h.numbering += 1
      return { recordNumber: `BR-${h.numbering}`, sequenceNumber: h.numbering }
    }),
  },
}))

vi.mock('../../costing/dated-reads', () => ({
  readPartNetThrough: vi.fn(async (_org: string, partIds: readonly string[], through: Date) => {
    const net = new Map<string, number>(partIds.map((id) => [id, 0]))
    for (const row of h.ledger) {
      if (row.at.getTime() <= through.getTime() && net.has(row.partId)) {
        net.set(row.partId, (net.get(row.partId) ?? 0) + row.quantity)
      }
    }
    return net
  }),
}))

vi.mock('../../costing/standard-cost-queries', () => ({
  loadStandardCostWriteContext: vi.fn(async () => ({
    allPartIds: new Set([...h.partKinds.keys()].filter((id) => !h.archived.has(id))),
    partKinds: h.partKinds,
    standardCosts: h.standardCosts,
    standardCostSources: h.standardCostSources,
  })),
}))

vi.mock('../../costing/cost-calculator', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadOrgPricingData: vi.fn(async () => ({ vendorPrices: [], subparts: h.subparts })),
}))

vi.mock('../../costing/standard-cost', () => ({
  rollStandardCost: vi.fn(async (_db: unknown, _org: string, _user: string, input: unknown) => {
    h.rollCalls.push(input as Record<string, unknown>)
    h.calls.push(`roll:${(input as { partIds: string[] }).partIds.join(',')}`)
    if (h.rollRefusal) return err(h.rollRefusal)
    return ok({ writtenPartIds: (input as { partIds: string[] }).partIds })
  }),
}))

vi.mock('../build-queries', () => ({
  readPartNames: vi.fn(
    async (_db: unknown, _org: string, ids: string[]) =>
      new Map(ids.map((id) => [id, id.replace('part_', '').toUpperCase()]))
  ),
}))

vi.mock('../build-mutations', () => ({
  createBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: Record<string, unknown>) => {
      h.createCalls.push(input)
      h.nextBuild += 1
      const buildId = `bld_${h.nextBuild}`
      h.buildParts.set(buildId, String(input.partId))
      h.calls.push(`create:${String(input.partId)}`)
      return ok({ buildId, partId: input.partId, status: 'planned' })
    }
  ),
  startBuild: vi.fn(async (_db: unknown, _org: string, _user: string, input: { buildId: string }) =>
    ok({ buildId: input.buildId, status: 'in_progress' })
  ),
}))

vi.mock('../complete-build', () => ({
  completeBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: Record<string, unknown>) => {
      h.completeCalls.push(input)
      const buildId = String(input.buildId)
      const partId = h.buildParts.get(buildId) ?? ''
      h.calls.push(`complete:${partId}`)
      const refusal = h.completeRefusals.get(partId)
      if (refusal) return err(refusal)
      // The legs a real completion writes, dated the build's accounting date.
      const quantity = Number(input.quantityProduced)
      const at = input.completedAt as Date
      h.ledger.push({ partId, quantity, at })
      for (const edge of h.subparts.filter((s) => s.parentPartId === partId)) {
        h.ledger.push({ partId: edge.childPartId, quantity: -quantity * edge.quantity, at })
      }
      return ok({ buildId, movementIds: ['mv'] })
    }
  ),
}))

import { backflushBuilds } from '../backflush'
import { listBackflushDays, orderParentsFirst, walkBackflushDay } from '../backflush-planner'
import { previewBackflush } from '../backflush-preview'

const db = {} as never

/** A sale: `quantity` units out of `partId` at 14:00 New York on `day`. */
function sale(partId: string, quantity: number, day: string) {
  h.ledger.push({ partId, quantity: -quantity, at: new Date(`${day}T18:00:00.000Z`) })
}

/** LIFT ← 1 MOTOR + 2 BOLT; MOTOR ← 1 COIL. Lift and motor are made; bolt and coil are bought. */
function liftBom() {
  h.subparts = [
    { parentPartId: LIFT, childPartId: MOTOR, quantity: 1 },
    { parentPartId: LIFT, childPartId: BOLT, quantity: 2 },
    { parentPartId: MOTOR, childPartId: COIL, quantity: 1 },
  ]
  h.partKinds = new Map([
    [LIFT, 'finished_good'],
    [MOTOR, 'subassembly'],
    [BOLT, 'component'],
    [COIL, 'component'],
  ])
}

const range = {
  from: '2026-09-23',
  to: '2026-09-23',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.timeZone = TZ
  h.ledger = []
  h.calls = []
  h.createCalls = []
  h.completeCalls = []
  h.rollCalls = []
  h.completeRefusals = new Map()
  h.rollRefusal = null
  h.numbering = 0
  h.nextBuild = 0
  h.buildParts = new Map()
  h.archived = new Set()
  h.standardCosts = new Map()
  h.standardCostSources = new Map()
  liftBom()
})

async function run(over: Partial<{ from: string; to: string }> = {}) {
  const result = await backflushBuilds(db, ORG, { ...range, ...over, actorUserId: USER, now: NOW })
  if (result.isErr()) throw result.error
  return result.value
}

describe('forty sales on a day', () => {
  it('become one completed build of 40, dated the end of that local day, source backflush', async () => {
    sale(LIFT, 40, '2026-09-23')
    const summary = await run()

    expect(summary.written.map((b) => [b.partId, b.quantity, b.day])).toEqual([
      [LIFT, 40, '2026-09-23'],
      [MOTOR, 40, '2026-09-23'],
    ])
    expect(h.createCalls[0]).toMatchObject({
      partId: LIFT,
      quantityPlanned: 40,
      source: 'backflush',
      batchRun: 1,
      notes: 'Backflush for 2026-09-23',
    })
    expect(h.completeCalls[0]).toMatchObject({ quantityProduced: 40, completedAt: END_0923 })
    // One run number for the whole call: what `undoBatchRun` keys on.
    expect(summary.batchRun).toBe(1)
    expect(h.createCalls.every((c) => c.batchRun === 1)).toBe(true)
  })

  it('processes the parent before the child it consumes, and leaves a bought part negative', async () => {
    sale(LIFT, 5, '2026-09-23')
    const summary = await run()

    // The motor was at zero until the lift build consumed five; the coil and bolt stay negative.
    expect(h.calls.filter((c) => c.startsWith('complete:'))).toEqual([
      `complete:${LIFT}`,
      `complete:${MOTOR}`,
    ])
    expect(summary.written.map((b) => b.partId)).toEqual([LIFT, MOTOR])
    const net = (partId: string) =>
      h.ledger.filter((m) => m.partId === partId).reduce((s, m) => s + m.quantity, 0)
    expect(net(BOLT)).toBe(-10)
    expect(net(COIL)).toBe(-5)
    expect(net(LIFT)).toBe(0)
    expect(net(MOTOR)).toBe(0)
  })

  it('is idempotent: a second run over the same day writes nothing and burns no run number', async () => {
    sale(LIFT, 5, '2026-09-23')
    await run()
    const again = await run()

    expect(again.written).toEqual([])
    expect(again.batchRun).toBeNull()
    expect(again.skipped).toBe(2)
    expect(h.numbering).toBe(1)
  })

  it('writes nothing when on hand ended the day at or above zero', async () => {
    h.ledger.push({ partId: LIFT, quantity: 10, at: new Date('2026-09-20T00:00:00.000Z') })
    sale(LIFT, 4, '2026-09-23')
    const summary = await run()
    expect(summary.written).toEqual([])
    expect(summary.skipped).toBe(2)
    expect(h.createCalls).toEqual([])
  })

  it('only counts movements dated on or before the end of the day', async () => {
    sale(LIFT, 3, '2026-09-23')
    sale(LIFT, 100, '2026-09-24')
    const summary = await run()
    expect(summary.written.find((b) => b.partId === LIFT)?.quantity).toBe(3)
  })
})

describe('the roll before the first build (Q20)', () => {
  it('rolls a provisional part once per run, before its first build, and not again on day two', async () => {
    h.standardCosts = new Map([
      [LIFT, 1200],
      [MOTOR, 300],
    ])
    h.standardCostSources = new Map([
      [LIFT, 'provisional'],
      [MOTOR, 'provisional'],
    ])
    sale(LIFT, 2, '2026-09-23')
    sale(LIFT, 3, '2026-09-24')
    const summary = await run({ to: '2026-09-24' })

    expect(summary.written).toHaveLength(4)
    expect(summary.rolled).toEqual([LIFT, MOTOR])
    expect(h.rollCalls).toEqual([
      { partIds: [LIFT], effectiveAt: NOW },
      { partIds: [MOTOR], effectiveAt: NOW },
    ])
    expect(h.calls.slice(0, 4)).toEqual([
      `roll:${LIFT}`,
      `create:${LIFT}`,
      `complete:${LIFT}`,
      `roll:${MOTOR}`,
    ])
  })

  it('leaves a confirmed standard alone and rolls a part with no standard at all', async () => {
    h.standardCosts = new Map([[LIFT, 1200]])
    h.standardCostSources = new Map([[LIFT, 'confirmed']])
    sale(LIFT, 1, '2026-09-23')
    const summary = await run()
    expect(summary.rolled).toEqual([MOTOR])
  })

  it('a refused roll is not fatal: the build still goes through', async () => {
    h.rollRefusal = new UnprocessableEntityError('no cost on the coil')
    sale(LIFT, 1, '2026-09-23')
    const summary = await run()
    expect(summary.written.map((b) => b.partId)).toEqual([LIFT, MOTOR])
    expect(summary.rolled).toEqual([])
  })
})

describe('never throws', () => {
  it('records a refused completion as leftInProgress and does not consume its children', async () => {
    h.completeRefusals.set(LIFT, new UnprocessableEntityError('period locked'))
    sale(LIFT, 5, '2026-09-23')
    const summary = await run()

    expect(summary.leftInProgress).toEqual([
      expect.objectContaining({ partId: LIFT, buildId: 'bld_1', reason: 'period locked' }),
    ])
    // The lift never completed, so the motor was never consumed and is not built.
    expect(summary.written).toEqual([])
    expect(h.createCalls).toHaveLength(1)
  })

  it('records a day whose read failed and continues with the next', async () => {
    const { readPartNetThrough } = await import('../../costing/dated-reads')
    vi.mocked(readPartNetThrough).mockRejectedValueOnce(new Error('ledger unavailable'))
    sale(LIFT, 1, '2026-09-24')
    const summary = await run({ to: '2026-09-24' })
    expect(summary.failedDays).toEqual([{ day: '2026-09-23', reason: 'ledger unavailable' }])
    expect(summary.written.map((b) => b.day)).toEqual(['2026-09-24', '2026-09-24'])
  })

  it('refuses a range that ends before it starts, writing nothing', async () => {
    const result = await backflushBuilds(db, ORG, {
      from: '2026-09-24',
      to: '2026-09-23',
      now: NOW,
    })
    expect(result.isErr()).toBe(true)
    expect(h.createCalls).toEqual([])
  })

  it('never walks a day whose end is still in the future', async () => {
    sale(LIFT, 1, '2026-09-23')
    const summary = await run({ to: '2026-09-30' })
    expect(summary.days).toEqual(['2026-09-23', '2026-09-24', '2026-09-25'])
  })

  it('falls back to the system user when no actor is given', async () => {
    sale(LIFT, 1, '2026-09-23')
    const result = await backflushBuilds(db, ORG, { ...range, now: NOW })
    expect(result.isOk()).toBe(true)
    const { createBuild } = await import('../build-mutations')
    expect(vi.mocked(createBuild).mock.calls[0]?.[2]).toBe('user_system')
  })
})

describe('the preview (D24)', () => {
  it('lists exactly the builds the run then writes, across days, without writing', async () => {
    sale(LIFT, 2, '2026-09-23')
    sale(LIFT, 3, '2026-09-24')
    const to = '2026-09-24'

    const preview = await previewBackflush(db, ORG, { ...range, to, now: NOW })
    if (preview.isErr()) throw preview.error
    expect(h.createCalls).toEqual([])
    expect(preview.value.buildCount).toBe(4)
    expect(preview.value.unitCount).toBe(10)
    expect(preview.value.builds.map((b) => [b.partId, b.day, b.quantity])).toEqual([
      [LIFT, '2026-09-23', 2],
      [MOTOR, '2026-09-23', 2],
      [LIFT, '2026-09-24', 3],
      [MOTOR, '2026-09-24', 3],
    ])
    expect(preview.value.builds[2]?.completedAt).toEqual(END_0924)

    const summary = await run({ to })
    expect(summary.written.map((b) => [b.partId, b.day, b.quantity])).toEqual(
      preview.value.builds.map((b) => [b.partId, b.day, b.quantity])
    )
  })
})

describe('the planner, pure', () => {
  const graph: ReadonlyMap<string, SubpartEdge[]> = new Map([
    [
      LIFT,
      [
        { childId: MOTOR, qty: 1 },
        { childId: BOLT, qty: 2 },
      ],
    ],
    [MOTOR, [{ childId: COIL, qty: 1 }]],
  ])

  it('orders every candidate before the candidates below it', () => {
    expect(orderParentsFirst(new Set([MOTOR, LIFT]), graph)).toEqual([LIFT, MOTOR])
  })

  it('survives a cycle', () => {
    const cyclic = new Map([...graph, [COIL, [{ childId: LIFT, qty: 1 }]]])
    expect(orderParentsFirst(new Set([LIFT, MOTOR, COIL]), cyclic)).toHaveLength(3)
  })

  it('lists inclusive local days in the book zone, dropping days whose end is after now', () => {
    const days = listBackflushDays(
      { from: '2026-09-23', to: '2026-09-26' },
      TZ,
      new Date('2026-09-26T03:00:00.000Z')
    )
    expect(days.map((d) => d.day)).toEqual(['2026-09-23', '2026-09-24'])
    expect(days[0]?.completedAt).toEqual(END_0923)
  })

  it('walks a day with simulated consumption when act reports success only', async () => {
    const g = {
      order: [LIFT, MOTOR],
      subparts: graph,
      names: new Map(),
      standardCosts: new Map(),
      standardCostSources: new Map(),
    }
    const day = { day: '2026-09-23', completedAt: END_0923 }
    const built: string[] = []
    const delta = new Map<string, number>()
    const skipped = await walkBackflushDay(g, day, new Map([[LIFT, -4]]), delta, async (b) => {
      built.push(`${b.partId}:${b.quantity}`)
      return b.partId === LIFT
    })
    expect(built).toEqual([`${LIFT}:4`, `${MOTOR}:4`])
    expect(skipped).toBe(0)
    // The motor's build was not completed, so the coil is not consumed in the simulation.
    expect(delta.get(COIL)).toBeUndefined()
    expect(delta.get(BOLT)).toBe(-8)
  })
})
