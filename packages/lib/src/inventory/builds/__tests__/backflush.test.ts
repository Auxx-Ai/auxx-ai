// packages/lib/src/inventory/builds/__tests__/backflush.test.ts
//
// Backflush (111 D23/D24): the replay `qoh(day) < 0 → one build of the shortfall`, parents
// before the children they consume, dated the end of the local day, idempotent, never rolling a
// standard (plans/mrp/09 §12.2 D-SC7).
//
// The ledger is an in-memory list of dated movements. The `recordCompletedBuild(s)` doubles append
// the produce and consume legs a real completion writes, so the parent-before-child property is
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
  archived: new Set<string>(),
  calls: [] as string[],
  completeCalls: [] as Record<string, unknown>[],
  rollCalls: [] as Record<string, unknown>[],
  completeRefusals: new Map<string, Error>(),
  batches: [] as string[][],
  refuseDay: null as string | null,
  numbering: 0,
  nextBuild: 0,
  reads: 0,
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
  readPartNetThroughEach: vi.fn(
    async (_org: string, partIds: readonly string[], throughs: readonly Date[]) => {
      h.reads += 1
      return throughs.map((through) => {
        const net = new Map<string, number>(partIds.map((id) => [id, 0]))
        for (const row of h.ledger) {
          if (row.at.getTime() <= through.getTime() && net.has(row.partId)) {
            net.set(row.partId, (net.get(row.partId) ?? 0) + row.quantity)
          }
        }
        return net
      })
    }
  ),
}))

vi.mock('../../costing/standard-cost-queries', () => ({
  loadStandardCostWriteContext: vi.fn(async () => ({
    allPartIds: new Set([...h.partKinds.keys()].filter((id) => !h.archived.has(id))),
    partKinds: h.partKinds,
  })),
}))

vi.mock('../../costing/cost-calculator', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadOrgPricingData: vi.fn(async () => ({ vendorPrices: [], subparts: h.subparts })),
}))

vi.mock('../../costing/standard-cost', () => ({
  rollStandardCost: vi.fn(async (_db: unknown, _org: string, _user: string, input: unknown) => {
    h.rollCalls.push(input as Record<string, unknown>)
    return ok({ writtenPartIds: (input as { partIds: string[] }).partIds })
  }),
}))

vi.mock('../build-queries', () => ({
  readPartNames: vi.fn(
    async (_db: unknown, _org: string, ids: string[]) =>
      new Map(ids.map((id) => [id, id.replace('part_', '').toUpperCase()]))
  ),
}))

vi.mock('../build-mutations', () => ({ createBuild: vi.fn() }))

/** The legs a real completion writes, dated the build's accounting date; returns the build id. */
function writeBuild(input: Record<string, unknown>): string {
  h.completeCalls.push(input)
  const partId = String(input.partId)
  h.nextBuild += 1
  const quantity = Number(input.quantity)
  const at = input.completedAt as Date
  h.ledger.push({ partId, quantity, at })
  for (const edge of h.subparts.filter((s) => s.parentPartId === partId)) {
    h.ledger.push({ partId: edge.childPartId, quantity: -quantity * edge.quantity, at })
  }
  return `bld_${h.nextBuild}`
}

function refusalFor(input: Record<string, unknown>): Error | undefined {
  const byDay = h.refuseDay && String(input.notes).endsWith(h.refuseDay)
  return (
    h.completeRefusals.get(String(input.partId)) ?? (byDay ? new Error('day closed') : undefined)
  )
}

vi.mock('../complete-build', () => ({
  recordCompletedBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: Record<string, unknown>) => {
      const partId = String(input.partId)
      h.calls.push(`complete:${partId}`)
      // A refused completion rolls its whole build back: nothing is written.
      const refusal = refusalFor(input)
      if (refusal) {
        h.completeCalls.push(input)
        return err(refusal)
      }
      return ok({ buildId: writeBuild(input), movementIds: ['mv'] })
    }
  ),
}))

vi.mock('../record-completed-builds', () => ({
  recordCompletedBuilds: vi.fn(
    async (_db: unknown, _org: string, _user: string, inputs: Record<string, unknown>[]) => {
      h.batches.push(inputs.map((input) => String(input.partId)))
      // One refused build rolls the whole batch back.
      if (inputs.some((input) => refusalFor(input))) {
        return err(new UnprocessableEntityError('a build in the batch was refused'))
      }
      return ok(
        inputs.map((input) => {
          h.calls.push(`complete:${String(input.partId)}`)
          return { buildId: writeBuild(input), movementIds: ['mv'] }
        })
      )
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
  h.completeCalls = []
  h.rollCalls = []
  h.completeRefusals = new Map()
  h.batches = []
  h.refuseDay = null
  h.numbering = 0
  h.nextBuild = 0
  h.reads = 0
  h.archived = new Set()
  liftBom()
})

async function run(over: Partial<{ from: string; to: string; sliceDays: number }> = {}) {
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
    expect(h.completeCalls[0]).toMatchObject({
      partId: LIFT,
      quantity: 40,
      source: 'backflush',
      batchRun: 1,
      notes: 'Backflush for 2026-09-23',
      completedAt: END_0923,
    })
    // One run number for the whole call: what `undoBatchRun` keys on.
    expect(summary.batchRun).toBe(1)
    expect(h.completeCalls.every((c) => c.batchRun === 1)).toBe(true)
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
    expect(h.completeCalls).toEqual([])
  })

  it('only counts movements dated on or before the end of the day', async () => {
    sale(LIFT, 3, '2026-09-23')
    sale(LIFT, 100, '2026-09-24')
    const summary = await run()
    expect(summary.written.find((b) => b.partId === LIFT)?.quantity).toBe(3)
  })
})

describe('standard costs', () => {
  it('never rolls a standard, even for a part with none', async () => {
    sale(LIFT, 2, '2026-09-23')
    const summary = await run()
    expect(summary.written.map((b) => b.partId)).toEqual([LIFT, MOTOR])
    expect(h.rollCalls).toEqual([])
  })
})

describe('never throws', () => {
  it('records a refused completion as failed and does not consume its children', async () => {
    h.completeRefusals.set(LIFT, new UnprocessableEntityError('period locked'))
    sale(LIFT, 5, '2026-09-23')
    const summary = await run()

    expect(summary.failed).toEqual([
      expect.objectContaining({ partId: LIFT, reason: 'period locked' }),
    ])
    // The lift never completed, so the motor was never consumed and is not built.
    expect(summary.written).toEqual([])
    expect(h.completeCalls).toHaveLength(1)
  })

  it('records a day whose read failed and continues with the next', async () => {
    const { readPartNetThroughEach } = await import('../../costing/dated-reads')
    vi.mocked(readPartNetThroughEach).mockRejectedValueOnce(new Error('ledger unavailable'))
    sale(LIFT, 1, '2026-09-24')
    const summary = await run({ to: '2026-09-24', sliceDays: 1 })
    expect(summary.failedDays).toEqual([{ day: '2026-09-23', reason: 'ledger unavailable' }])
    expect(summary.written.map((b) => b.day)).toEqual(['2026-09-24', '2026-09-24'])
  })

  it('fails every day of a slice whose one read failed', async () => {
    const { readPartNetThroughEach } = await import('../../costing/dated-reads')
    vi.mocked(readPartNetThroughEach).mockRejectedValueOnce(new Error('ledger unavailable'))
    sale(LIFT, 1, '2026-09-24')
    const summary = await run({ to: '2026-09-24' })
    expect(summary.failedDays.map((d) => d.day)).toEqual(['2026-09-23', '2026-09-24'])
    expect(summary.written).toEqual([])
  })

  it('refuses a range that ends before it starts, writing nothing', async () => {
    const result = await backflushBuilds(db, ORG, {
      from: '2026-09-24',
      to: '2026-09-23',
      now: NOW,
    })
    expect(result.isErr()).toBe(true)
    expect(h.completeCalls).toEqual([])
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
    const { recordCompletedBuilds } = await import('../record-completed-builds')
    expect(vi.mocked(recordCompletedBuilds).mock.calls[0]?.[2]).toBe('user_system')
  })
})

describe('batched slices (plans/mrp/12 §2)', () => {
  const week = { from: '2026-09-17', to: '2026-09-23' }

  it('writes a slice as one batch, in walk order', async () => {
    sale(LIFT, 2, '2026-09-17')
    sale(LIFT, 3, '2026-09-19')
    const summary = await run({ ...week, sliceDays: 7 })
    expect(h.batches).toEqual([[LIFT, MOTOR, LIFT, MOTOR]])
    expect(summary.written.map((b) => [b.partId, b.day])).toEqual([
      [LIFT, '2026-09-17'],
      [MOTOR, '2026-09-17'],
      [LIFT, '2026-09-19'],
      [MOTOR, '2026-09-19'],
    ])
  })

  it('cuts a slice into batches of whole days', async () => {
    sale(LIFT, 2, '2026-09-17')
    sale(LIFT, 3, '2026-09-19')
    sale(MOTOR, 1, '2026-09-20')
    const summary = await backflushBuilds(db, ORG, {
      ...week,
      actorUserId: USER,
      now: NOW,
      sliceDays: 7,
      batchBuilds: 2,
    })
    expect(summary.isOk()).toBe(true)
    expect(h.batches).toEqual([[LIFT, MOTOR], [LIFT, MOTOR], [MOTOR]])
  })

  it('a refused batch is walked again build by build: the refusal fails alone, the rest land', async () => {
    sale(MOTOR, 4, '2026-09-18')
    sale(LIFT, 2, '2026-09-23')
    h.completeRefusals.set(LIFT, new UnprocessableEntityError('period locked'))
    const summary = await run({ ...week, sliceDays: 7 })

    expect(h.batches).toEqual([[MOTOR, LIFT, MOTOR]])
    expect(summary.failed).toEqual([
      expect.objectContaining({ partId: LIFT, day: '2026-09-23', reason: 'period locked' }),
    ])
    // Build by build, the unbuilt lift consumes no motor: only the motor's own sale is built.
    expect(summary.written.map((b) => [b.partId, b.day, b.quantity])).toEqual([
      [MOTOR, '2026-09-18', 4],
    ])
    // The qoh >= 0 checks a walk build by build makes, counted once despite the second walk.
    expect(summary.skipped).toBe(12)
  })

  it('keeps the batches before a refused one and re-walks only from its day', async () => {
    sale(LIFT, 2, '2026-09-17')
    sale(LIFT, 3, '2026-09-19')
    h.refuseDay = '2026-09-19'
    const summary = await backflushBuilds(db, ORG, {
      ...week,
      actorUserId: USER,
      now: NOW,
      sliceDays: 7,
      batchBuilds: 1,
    })
    if (summary.isErr()) throw summary.error
    expect(h.batches).toEqual([
      [LIFT, MOTOR],
      [LIFT, MOTOR],
    ])
    // What one completion per build writes: the 19th's lift fails, the 20th builds its shortfall.
    expect(summary.value.written.map((b) => [b.partId, b.day, b.quantity])).toEqual([
      [LIFT, '2026-09-17', 2],
      [MOTOR, '2026-09-17', 2],
      [LIFT, '2026-09-20', 3],
      [MOTOR, '2026-09-20', 3],
    ])
    expect(summary.value.failed.map((b) => [b.partId, b.day])).toEqual([[LIFT, '2026-09-19']])
  })
})

describe('one ledger read per slice (plans/mrp/11 §3)', () => {
  function salesOverAWeek() {
    sale(LIFT, 2, '2026-09-17')
    sale(MOTOR, 1, '2026-09-18')
    sale(LIFT, 3, '2026-09-19')
    h.ledger.push({ partId: MOTOR, quantity: 4, at: new Date('2026-09-20T18:00:00.000Z') })
    sale(LIFT, 5, '2026-09-21')
    sale(MOTOR, 6, '2026-09-23')
  }
  const week = { from: '2026-09-17', to: '2026-09-23' }

  it('writes exactly the builds one read per day would, with one read per slice', async () => {
    salesOverAWeek()
    const perDay = await run({ ...week, sliceDays: 1 })
    expect(h.reads).toBe(7)
    const perDayBuilds = perDay.written.map((b) => [b.partId, b.day, b.quantity])
    expect(perDayBuilds.length).toBeGreaterThan(3)

    // The same ledger again, walked in slices of three days: 3 reads.
    h.ledger = []
    h.reads = 0
    salesOverAWeek()
    const sliced = await run({ ...week, sliceDays: 3 })
    expect(h.reads).toBe(3)
    expect(sliced.written.map((b) => [b.partId, b.day, b.quantity])).toEqual(perDayBuilds)
  })

  it('a slice of a run reuses its batch number', async () => {
    sale(LIFT, 1, '2026-09-23')
    const result = await backflushBuilds(db, ORG, {
      ...range,
      actorUserId: USER,
      now: NOW,
      run: { batchRun: 7 },
    })
    if (result.isErr()) throw result.error
    expect(result.value.batchRun).toBe(7)
    expect(h.numbering).toBe(0)
    expect(h.completeCalls.every((c) => c.batchRun === 7)).toBe(true)
  })
})

describe('the preview (D24)', () => {
  it('lists exactly the builds the run then writes, across days, without writing', async () => {
    sale(LIFT, 2, '2026-09-23')
    sale(LIFT, 3, '2026-09-24')
    const to = '2026-09-24'

    const preview = await previewBackflush(db, ORG, { ...range, to, now: NOW })
    if (preview.isErr()) throw preview.error
    expect(h.completeCalls).toEqual([])
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
