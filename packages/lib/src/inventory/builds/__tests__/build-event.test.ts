// packages/lib/src/inventory/builds/__tests__/build-event.test.ts
//
// The build event: what `createBuild` does NOT write, what `completeBuild` writes and at what
// cost, what `reverseBuild` carries back, and the lifecycle checks every writer makes. The build
// table primitives, the movement seam and the standard-cost read are doubles; the part reads run
// against a db stand-in routed by table identity (`src/test/setup.ts` mocks `@auxx/database`, so
// no WHERE is evaluated).

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../../errors'
import type { BuildPatch, NewBuild } from '../build-writes'
import type { BuildRecord } from '../types'
import { buildRecord } from './support/build-record'

const ORG = 'org_1'
const USER = 'user_1'
const BUILD = 'bld_1'
const PART_LIFT = 'part_lift'
const PART_ASM = 'part_asm'
const PART_MOTOR = 'part_motor'
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')

const h = vi.hoisted(() => ({
  /** `.from(EntityInstance)`: the parts, for the existence probe and the names. */
  instanceRows: [] as { id: string; createdAt: Date; displayName: string | null }[],
  /** `.from(FieldValue)`: the `part_kind` rows. */
  kindRows: [] as { entityId: string; optionId: string }[],
  /** What `readMovementsByBuilds` returns: the build's own movements. */
  buildMovements: [] as Record<string, unknown>[],
  /** Every `StockMovement` row the seam double was asked to insert, in write order. */
  movementRows: [] as Record<string, unknown>[],
  /** Every `touched` handed to `settleStockMovements`. */
  settleCalls: [] as Array<{ partIds: string[]; buildIds: string[] }>,
  /** The `Build` table. */
  builds: new Map<string, BuildRecord>(),
  /** Whether a reversal already points at the build (`hasBuildReversal`). */
  alreadyReversed: false,
  /** partId -> frozen standard cost, minor units. Absent = never rolled. */
  standards: new Map<string, number>(),
  /** The produced part's two per-part rates, per unit, minor units. */
  rates: { laborCostPerUnit: null as number | null, overheadCostPerUnit: null as number | null },
  /** parentPartId -> direct children, the real depth-1 semantics over a fixture. */
  bom: new Map<string, { childId: string; qty: number }[]>(),
  inserted: [] as NewBuild[],
  patches: [] as { buildId: string; patch: BuildPatch }[],
  /** Interleaved trace: what ran, and on which side of the commit. */
  trace: [] as string[],
  /** Build ids of every `build:changed` publish, in order. */
  published: [] as string[][],
  getDeductionTargets: vi.fn(),
  loadSubpartGraph: vi.fn(),
  nextId: 0,
  postSpy: vi.fn(async (..._args: unknown[]) => null as unknown),
  upsertWorkItem: vi.fn(async () => ({ isOk: () => true })),
}))

vi.mock('../../../accounting/work-items/write', () => ({
  upsertWorkItem: h.upsertWorkItem,
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => `def_${entityType}`),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, { id: `fld_${attr}`, type: 'SINGLE_SELECT' }])
        ),
    }),
  }),
}))

vi.mock('../../bom/subpart-graph', () => ({
  // The REAL depth-1 semantics over the fixture: if the code walked a level deeper it would get
  // an answer, and the motor would appear in the ledger.
  loadDirectSubparts: vi.fn(async (_db: unknown, _org: string, partId: string) => {
    h.trace.push(`loadDirectSubparts:${partId}`)
    return h.bom.get(partId) ?? []
  }),
  loadSubpartGraph: h.loadSubpartGraph,
  getDeductionTargets: h.getDeductionTargets,
}))

vi.mock('../../costing/standard-cost-queries', () => ({
  readStandardCost: vi.fn(async (_db: unknown, _org: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, { partId: string; standardCost: number }>()
    for (const partId of partIds) {
      const standardCost = h.standards.get(partId)
      if (standardCost != null) map.set(partId, { partId, standardCost })
    }
    return ok(map)
  }),
  loadPartAbsorptionRates: vi.fn(async () => h.rates),
}))

vi.mock('../../movements/write-movements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../movements/write-movements')>()
  const { toStockMovementRow } = await import('../../movements/row')
  const { ok } = await import('neverthrow')
  return {
    ...actual,
    writeStockMovements: vi.fn(
      async (
        ctx: { organizationId: string; userId: string },
        inputs: Parameters<typeof toStockMovementRow>[1][]
      ) => {
        const rows = inputs.map((input) => {
          h.nextId += 1
          const meta = {
            id: `mv_new_${h.nextId}`,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            createdAt: CREATED_AT,
          }
          const row = toStockMovementRow(meta, input)
          h.movementRows.push(row as Record<string, unknown>)
          h.trace.push(`create:${row.type}`)
          return row
        })
        return ok({
          records: rows.map((row, i) => ({
            id: row.id!,
            partInstanceId: row.partId,
            quantity: row.quantity,
            unitCost: inputs[i]!.unitCost,
            extendedCost: row.extendedCostMinor ?? null,
            glRole: row.glRole ?? null,
            occurredAt: inputs[i]!.occurredAt,
          })),
          touched: actual.touchedBy(rows),
        })
      }
    ),
    settleStockMovements: vi.fn(
      async (_org: string, touched: { partIds: string[]; buildIds: string[] }) => {
        h.trace.push('settle')
        h.settleCalls.push(touched)
      }
    ),
  }
})

vi.mock('../../movements/reads', () => ({
  readMovementsByBuilds: vi.fn(async () => h.buildMovements),
}))

vi.mock('../build-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../build-queries')>()
  const { NotFoundError } = await import('../../../errors')
  const { ok } = await import('neverthrow')
  const lock = async (_tx: unknown, _org: string, buildId: string) => {
    const build = h.builds.get(buildId)
    if (!build) throw new NotFoundError(`Build ${buildId} not found`)
    return build
  }
  return {
    ...actual,
    lockBuild: vi.fn(lock),
    readBuild: vi.fn(async (_db: unknown, _org: string, id: string) => h.builds.get(id)),
    getBuild: vi.fn(async (_db: unknown, _org: string, id: string) => ok(h.builds.get(id) ?? null)),
    hasBuildReversal: vi.fn(async () => h.alreadyReversed),
  }
})

vi.mock('../build-writes', async () => {
  const { buildRecord } = await import('./support/build-record')
  const insert = (build: NewBuild): BuildRecord => {
    h.nextId += 1
    const record = buildRecord({
      ...(build as Partial<BuildRecord>),
      buildId: build.id ?? `bld_new_${h.nextId}`,
      number: `B-${h.nextId}`,
    })
    h.inserted.push(build)
    h.builds.set(record.buildId, record)
    h.trace.push('create:build')
    return record
  }
  return {
    insertBuild: vi.fn(async (_db: unknown, _org: string, _user: unknown, build: NewBuild) =>
      insert(build)
    ),
    insertBuilds: vi.fn(async (_db: unknown, _org: string, _user: unknown, builds: NewBuild[]) =>
      builds.map(insert)
    ),
    updateBuild: vi.fn(async (_tx: unknown, _org: string, buildId: string, patch: BuildPatch) => {
      const next = { ...h.builds.get(buildId)!, ...(patch as Partial<BuildRecord>) }
      h.patches.push({ buildId, patch })
      h.builds.set(buildId, next)
      h.trace.push('update')
      return next
    }),
  }
})

vi.mock('../build-realtime', () => ({
  publishBuildsChanged: vi.fn(async (_org: string, builds: BuildRecord[]) => {
    h.trace.push('publish-build')
    h.published.push(builds.map((build) => build.buildId))
  }),
}))

import {
  amendPlannedBuildQuantity,
  cancelBuild,
  createBuild,
  startBuild,
  updateBuildNotes,
} from '../build-mutations'
import { completeBuild } from '../complete-build'
import { reverseBuild } from '../reverse-build'

// ─── The db double ──────────────────────────────────────────────────────

interface RowsChain extends PromiseLike<unknown[]> {
  limit(): RowsChain
  offset(): RowsChain
  orderBy(): RowsChain
  for(): RowsChain
}

function rowsPromise(rows: unknown[]): RowsChain {
  return Object.assign(Promise.resolve(rows), {
    limit: () => rowsPromise(rows),
    offset: () => rowsPromise(rows),
    orderBy: () => rowsPromise(rows),
    for: () => rowsPromise(rows),
  })
}

function makeChain() {
  const state = { table: null as unknown }
  const chain: Record<string, unknown> = {
    from: (table: unknown) => {
      state.table = table
      return chain
    },
    innerJoin: () => chain,
    leftJoin: () => chain,
    $dynamic: () => chain,
    where: () => rowsPromise(state.table === schema.EntityInstance ? h.instanceRows : h.kindRows),
  }
  return chain
}

const db = {
  select: () => makeChain(),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    h.trace.push('begin')
    const result = await fn(db)
    // Everything after this point in the trace ran AFTER the commit.
    h.trace.push('commit')
    return result
  },
} as never

// ─── Fixtures ───────────────────────────────────────────────────────────

/** The SAME build after the completion in the scrap test: 10 good, 2 scrapped. */
function completedBuild(over: Partial<BuildRecord> = {}): BuildRecord {
  return buildRecord({
    buildId: BUILD,
    partId: PART_LIFT,
    status: 'completed',
    source: 'batch',
    batchRun: 7,
    quantityProduced: 10,
    quantityScrapped: 2,
    materialCost: 87864,
    laborCost: 6000,
    overheadCost: 2400,
    producedValue: 80220,
    varianceAmount: 16044,
    completedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...over,
  })
}

/** The two movements that completion wrote, with their FROZEN costs. */
function completedMovementRows(): Record<string, unknown>[] {
  return [
    {
      id: 'mv_1',
      partId: PART_ASM,
      type: 'build_consume',
      quantity: -24,
      unitCostMinor: 3661,
      extendedCostMinor: -87864,
      glRole: 'inventory_raw_materials',
      qtyPerUnit: 2,
      costBasis: 'standard',
    },
    {
      id: 'mv_2',
      partId: PART_LIFT,
      type: 'build_produce',
      quantity: 10,
      unitCostMinor: 8022,
      extendedCostMinor: 80220,
      glRole: 'inventory_finished_goods',
      qtyPerUnit: null,
      costBasis: 'standard',
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.instanceRows = [
    { id: PART_LIFT, createdAt: CREATED_AT, displayName: 'Auxx Lift 400lbs 4x8' },
    { id: PART_ASM, createdAt: CREATED_AT, displayName: '400Lbs motor Assembly' },
    { id: PART_MOTOR, createdAt: CREATED_AT, displayName: 'Motor' },
  ]
  h.kindRows = [
    { entityId: PART_LIFT, optionId: 'finished_good' },
    { entityId: PART_ASM, optionId: 'subassembly' },
    { entityId: PART_MOTOR, optionId: 'component' },
  ]
  h.builds = new Map([[BUILD, buildRecord({ buildId: BUILD, partId: PART_LIFT })]])
  h.alreadyReversed = false
  h.buildMovements = []
  h.movementRows = []
  h.settleCalls = []
  // 2 assemblies per lift; 1 motor per assembly. The motor is one level too deep (B4).
  h.bom = new Map([
    [PART_LIFT, [{ childId: PART_ASM, qty: 2 }]],
    [PART_ASM, [{ childId: PART_MOTOR, qty: 1 }]],
  ])
  h.standards = new Map([
    [PART_ASM, 3661],
    [PART_LIFT, 8022],
    [PART_MOTOR, 2010],
  ])
  h.rates = { laborCostPerUnit: 500, overheadCostPerUnit: 200 }
  h.inserted = []
  h.patches = []
  h.trace = []
  h.published = []
  h.nextId = 0
})

function setStatus(status: BuildRecord['status']): void {
  h.builds.set(BUILD, { ...h.builds.get(BUILD)!, status })
}

/** Every `StockMovement` row the seam double was asked to insert. */
function movementWrites(): Record<string, unknown>[] {
  return h.movementRows
}

/** The ids of every movement written, in write order. */
function movementIdsWritten(): string[] {
  return h.movementRows.map((row) => row.id as string)
}

async function expectErr(promise: Promise<{ isErr(): boolean; _unsafeUnwrapErr(): Error }>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

// ─── createBuild ────────────────────────────────────────────────────────

describe('createBuild', () => {
  it('writes ZERO stock movements — the safety property every later phase rests on (B2)', async () => {
    const result = await createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 10 })

    expect(result.isOk()).toBe(true)
    expect(movementWrites()).toEqual([])
    expect(h.inserted).toEqual([
      {
        partId: PART_LIFT,
        status: 'planned',
        source: 'manual',
        quantityPlanned: 10,
        notes: null,
      },
    ])
    expect(h.published).toEqual([[result._unsafeUnwrap().buildId]])
  })

  it('stamps the order and the fingerprint it was handed on an order-raised build', async () => {
    await createBuild(db, ORG, USER, {
      partId: PART_LIFT,
      quantityPlanned: 2,
      orderId: 'ord_1',
      source: 'order',
      orderRevision: 'rev_1',
    })
    expect(h.inserted[0]).toMatchObject({ orderId: 'ord_1', orderRevision: 'rev_1' })
  })

  it('never stamps a revision on a build a person raised against an order', async () => {
    await createBuild(db, ORG, USER, {
      partId: PART_LIFT,
      quantityPlanned: 2,
      orderId: 'ord_1',
      orderRevision: 'rev_1',
    })
    expect(h.inserted[0]).toMatchObject({ orderId: 'ord_1', source: 'manual' })
    expect(h.inserted[0]).not.toHaveProperty('orderRevision')
  })

  it('refuses a component — a purchased part is not assembled', async () => {
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_MOTOR, quantityPlanned: 1 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('part kind')
    expect(h.inserted).toEqual([])
  })

  it('refuses a part that does not exist', async () => {
    h.instanceRows = []
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 1 })
    )
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.inserted).toEqual([])
  })

  it('refuses a part with no bill of materials — a build would consume nothing', async () => {
    h.bom.set(PART_LIFT, [])
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 10 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('bill of materials')
    expect(h.inserted).toEqual([])
  })

  it('refuses a run that plans to produce nothing', async () => {
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 0 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.inserted).toEqual([])
  })
})

// ─── The lifecycle transitions ──────────────────────────────────────────

describe('startBuild and cancelBuild', () => {
  it('starts a planned build and stamps startedAt, then announces it after the commit', async () => {
    const startedAt = new Date('2026-08-03T00:00:00.000Z')
    const result = await startBuild(db, ORG, USER, { buildId: BUILD, startedAt })

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'in_progress', startedAt })
    expect(h.patches).toEqual([{ buildId: BUILD, patch: { status: 'in_progress', startedAt } }])
    expect(h.trace.indexOf('publish-build')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  it.each([
    'in_progress',
    'completed',
    'canceled',
  ] as const)('refuses to start a %s build', async (status) => {
    setStatus(status)
    const error = await expectErr(startBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.patches).toEqual([])
    expect(h.published).toEqual([])
  })

  it('cancels an in-progress build and appends the reason to the notes', async () => {
    h.builds.set(BUILD, { ...h.builds.get(BUILD)!, status: 'in_progress', notes: 'rush' })
    const result = await cancelBuild(db, ORG, USER, { buildId: BUILD, reason: 'order cancelled' })

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'canceled',
      notes: 'rush\norder cancelled',
    })
    expect(movementWrites()).toEqual([])
  })

  it.each(['completed', 'canceled'] as const)('refuses to cancel a %s build', async (status) => {
    setStatus(status)
    const error = await expectErr(cancelBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.patches).toEqual([])
  })

  it('refuses a build that does not exist', async () => {
    const error = await expectErr(startBuild(db, ORG, USER, { buildId: 'bld_missing' }))
    expect(error).toBeInstanceOf(NotFoundError)
  })
})

describe('updateBuildNotes', () => {
  it('edits the notes of a completed build, and writes nothing else', async () => {
    h.builds.set(BUILD, completedBuild())
    const result = await updateBuildNotes(db, ORG, { buildId: BUILD, notes: 'checked' })

    expect(result._unsafeUnwrap()).toMatchObject({ notes: 'checked', status: 'completed' })
    expect(h.patches).toEqual([{ buildId: BUILD, patch: { notes: 'checked' } }])
  })

  it('stores blank notes as null', async () => {
    await updateBuildNotes(db, ORG, { buildId: BUILD, notes: '  ' })
    expect(h.patches[0]?.patch).toEqual({ notes: null })
  })
})

// ─── amendPlannedBuildQuantity ──────────────────────────────────────────

describe('amendPlannedBuildQuantity', () => {
  it('amends a planned build and re-stamps the order revision in the SAME update', async () => {
    const result = await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 25,
      orderRevision: 'rev_after',
    })

    expect(result.isOk()).toBe(true)
    expect(h.patches).toEqual([
      { buildId: BUILD, patch: { quantityPlanned: 25, orderRevision: 'rev_after' } },
    ])
    expect(movementWrites()).toEqual([])
    expect(h.inserted).toEqual([])
  })

  it('writes only the quantity when no revision is given', async () => {
    await amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 3 })
    expect(h.patches[0]?.patch).toEqual({ quantityPlanned: 3 })
  })

  it('clears the stamp back to unknown when the caller passes null explicitly', async () => {
    await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 4,
      orderRevision: null,
    })
    expect(h.patches[0]?.patch).toEqual({ quantityPlanned: 4, orderRevision: null })
  })

  it.each([
    'in_progress',
    'completed',
    'canceled',
  ] as const)('refuses a %s build', async (status) => {
    setStatus(status)
    const error = await expectErr(
      amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.patches).toEqual([])
  })

  it('leaves an in-progress build cancellable — the asymmetry plan 13 §1.5 asks for', async () => {
    setStatus('in_progress')
    const cancelled = await cancelBuild(db, ORG, USER, { buildId: BUILD })
    expect(cancelled.isOk()).toBe(true)
  })

  it('refuses a quantity that plans to produce nothing — the same words as createBuild', async () => {
    for (const quantityPlanned of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await expectErr(
        amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned })
      )
      expect(error, String(quantityPlanned)).toBeInstanceOf(BadRequestError)
      expect(error.message).toBe('A build must plan to produce at least one unit')
    }
    expect(h.patches).toEqual([])
  })
})

// ─── completeBuild ──────────────────────────────────────────────────────

describe('completeBuild', () => {
  it('consumes the DIRECT subparts only — a subassembly is consumed as itself (B4)', async () => {
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(result.isOk()).toBe(true)

    const consumes = movementWrites().filter((values) => values.type === 'build_consume')
    expect(consumes).toHaveLength(1)
    expect(consumes[0]?.partId).toBe(PART_ASM)
    // The motor sits one level below the assembly and must never appear: the
    // assembly carries its own on-hand balance and its own standard, so
    // exploding through it would consume the same material twice.
    expect(JSON.stringify(movementWrites())).not.toContain(PART_MOTOR)
    // And the multi-level walk was not even reached for.
    expect(h.getDeductionTargets).not.toHaveBeenCalled()
    expect(h.loadSubpartGraph).not.toHaveBeenCalled()
    expect(h.trace.filter((entry) => entry.startsWith('loadDirectSubparts'))).toEqual([
      `loadDirectSubparts:${PART_LIFT}`,
    ])
  })

  it('nets to zero variance when nothing is scrapped and the standard agrees with the BOM', async () => {
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()

    // 2 assemblies per lift x 10 lifts = 20, at 3661 each.
    expect(value.materialCost).toBe(73220)
    expect(value.laborCost).toBe(5000)
    expect(value.overheadCost).toBe(2000)
    expect(value.producedValue).toBe(80220)
    expect(value.varianceAmount).toBe(0)
  })

  it('scrap consumes material, produces no movement, and lands in the variance (B7)', async () => {
    const result = await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      quantityScrapped: 2,
    })
    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()

    // 12 units STARTED consume material: 2 x 12 = 24 assemblies.
    expect(value.materialCost).toBe(87864)
    expect(value.laborCost).toBe(6000)
    expect(value.overheadCost).toBe(2400)
    // Only the 10 SURVIVORS are valued into stock.
    expect(value.producedValue).toBe(80220)
    // 87864 + 6000 + 2400 - 80220 = 16044, which is exactly 2 x 8022: the
    // scrapped units' whole standard cost, to account 5090.
    expect(value.varianceAmount).toBe(16044)
    expect(value.varianceAmount).toBe(2 * 8022)

    const produces = movementWrites().filter((values) => values.type === 'build_produce')
    expect(produces).toHaveLength(1)
    // Not 12. Scrapped units produce nothing.
    expect(produces[0]?.quantity).toBe(10)
  })

  it('posts the build entry once, inside the completion', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(h.postSpy).toHaveBeenCalledTimes(1)
    expect(h.trace.indexOf('commit')).toBeGreaterThan(h.trace.indexOf('create:build_produce'))
    expect(h.upsertWorkItem).not.toHaveBeenCalled()
  })

  // 111 Q18: quantity never waits on cost. The uncosted leg is written with no
  // cost; the whole entry waits, because the build id can be claimed once.
  it('writes an uncosted component leg PENDING, stamps no cost, posts nothing and parks the build', async () => {
    h.standards.delete(PART_ASM)
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const value = result._unsafeUnwrap()

    const [consume, produce] = movementWrites()
    expect(consume).toMatchObject({
      type: 'build_consume',
      quantity: -20,
      costBasis: 'pending',
      glRole: 'inventory_raw_materials',
      unitCostMinor: null,
      extendedCostMinor: null,
    })
    // The priced leg is still priced: only the entry waits.
    expect(produce).toMatchObject({
      type: 'build_produce',
      unitCostMinor: 8022,
      costBasis: 'standard',
    })
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.patches[0]?.patch).toMatchObject({
      status: 'completed',
      materialCost: null,
      producedValue: null,
      varianceAmount: null,
    })
    expect(value).toMatchObject({
      materialCost: null,
      producedValue: null,
      varianceAmount: null,
      pendingPartIds: [PART_ASM],
    })
    expect(h.upsertWorkItem).toHaveBeenCalledWith(db, ORG, {
      sourceKind: 'build',
      sourceId: BUILD,
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: PART_ASM,
      detail: {
        partIds: [PART_ASM],
        pendingMovementIds: [movementIdsWritten()[0]],
        partName: '400Lbs motor Assembly',
      },
    })
    // The commit still happened, and QoH still settles for every part.
    expect(h.trace).toContain('commit')
    expect([...h.settleCalls[0]!.partIds].sort()).toEqual([PART_ASM, PART_LIFT].sort())
  })

  it('writes the PRODUCE leg pending when the produced part has no standard, and posts nothing', async () => {
    h.standards.delete(PART_LIFT)
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(result._unsafeUnwrap().pendingPartIds).toEqual([PART_LIFT])

    const [consume, produce] = movementWrites()
    expect(consume).toMatchObject({ unitCostMinor: 3661, costBasis: 'standard' })
    expect(produce).toMatchObject({
      quantity: 10,
      costBasis: 'pending',
      unitCostMinor: null,
      extendedCostMinor: null,
    })
    expect(h.postSpy).not.toHaveBeenCalled()
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      ORG,
      expect.objectContaining({
        sourceKind: 'build',
        sourceId: BUILD,
        stage: 'price',
        externalRef: PART_LIFT,
      })
    )
  })

  it('refuses a SECOND completion — one completion per build (B8)', async () => {
    h.builds.set(BUILD, completedBuild())
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect(movementWrites()).toEqual([])
    expect(h.patches).toEqual([])
  })

  it('sets adjustSubparts: false on every row it writes', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      quantityScrapped: 2,
    })
    const rows = movementWrites()
    expect(rows.length).toBeGreaterThan(0)
    for (const values of rows) {
      expect(values.adjustSubparts).toBe(false)
    }
  })

  it('settles the movements ONCE, batched, and only after the commit', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })

    expect(h.settleCalls).toHaveLength(1)
    // The produced part and every consumed part, deduplicated.
    expect([...h.settleCalls[0]!.partIds].sort()).toEqual([PART_ASM, PART_LIFT].sort())
    expect(h.settleCalls[0]!.buildIds).toEqual([BUILD])
    // Ordering, not just presence: a recalc inside the transaction would re-SUM
    // a ledger that does not yet contain the rows above.
    expect(h.trace.indexOf('commit')).toBeGreaterThan(-1)
    expect(h.trace.indexOf('settle')).toBeGreaterThan(h.trace.indexOf('commit'))
    for (const entry of h.trace.filter((step) => step.startsWith('create:'))) {
      expect(h.trace.indexOf(entry)).toBeLessThan(h.trace.indexOf('commit'))
    }
  })

  it('announces the completed build once, after the commit', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })

    expect(h.published).toEqual([[BUILD]])
    expect(h.trace.indexOf('publish-build')).toBeGreaterThan(h.trace.indexOf('commit'))
    expect(h.builds.get(BUILD)?.status).toBe('completed')
  })

  it('freezes the standard onto every row, with the extended cost signed like the quantity', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const [consume, produce] = movementWrites()

    expect(consume).toMatchObject({
      type: 'build_consume',
      quantity: -20,
      unitCostMinor: 3661,
      extendedCostMinor: -73220,
      // A subassembly's stock sits in Raw Materials, not Finished Goods.
      glRole: 'inventory_raw_materials',
      costBasis: 'standard',
      // The as-built BOM snapshot.
      qtyPerUnit: 2,
      buildId: BUILD,
    })
    expect(produce).toMatchObject({
      type: 'build_produce',
      quantity: 10,
      unitCostMinor: 8022,
      extendedCostMinor: 80220,
      glRole: 'inventory_finished_goods',
      buildId: BUILD,
    })
    // NULL on the produce row, never a zero.
    expect(produce?.qtyPerUnit).toBeNull()
  })

  it('stamps the build with the five costs and the completed status', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      quantityScrapped: 2,
    })
    expect(h.patches).toHaveLength(1)
    expect(h.patches[0]?.patch).toMatchObject({
      status: 'completed',
      quantityProduced: 10,
      quantityScrapped: 2,
      materialCost: 87864,
      laborCost: 6000,
      overheadCost: 2400,
      producedValue: 80220,
      varianceAmount: 16044,
    })
  })

  it('takes a per-component override without losing the as-built BOM snapshot', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      componentOverrides: [{ partId: PART_ASM, quantityConsumed: 21 }],
    })
    const [consume] = movementWrites()
    expect(consume?.quantity).toBe(-21)
    // The floor used one more than the bill of materials called for. The bill
    // still called for 2 per unit, and the snapshot says so.
    expect(consume?.qtyPerUnit).toBe(2)
  })

  it('marks an OFF-BOM substitution with a null qtyPerUnit rather than a zero', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      componentOverrides: [{ partId: PART_MOTOR, quantityConsumed: 5 }],
    })
    const substitution = movementWrites().find((values) => values.partId === PART_MOTOR)
    expect(substitution?.quantity).toBe(-5)
    expect(substitution?.qtyPerUnit).toBeNull()
    // A component's stock sits in Raw Materials.
    expect(substitution?.glRole).toBe('inventory_raw_materials')
  })

  it('absorbs nothing when no rate is declared, and keeps the variance honest', async () => {
    h.rates = { laborCostPerUnit: null, overheadCostPerUnit: null }
    // A standard with no conversion cost: material only.
    h.standards.set(PART_LIFT, 7322)
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const value = result._unsafeUnwrap()

    expect(value.laborCost).toBe(0)
    expect(value.overheadCost).toBe(0)
    expect(value.materialCost).toBe(73220)
    expect(value.producedValue).toBe(73220)
    expect(value.varianceAmount).toBe(0)
  })

  it('completes at a $0 standard rather than refusing it (103 §5a)', async () => {
    h.rates = { laborCostPerUnit: null, overheadCostPerUnit: null }
    h.standards.set(PART_ASM, 0)
    h.standards.set(PART_LIFT, 0)
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const value = result._unsafeUnwrap()

    expect(value.materialCost).toBe(0)
    expect(value.producedValue).toBe(0)
    expect(value.varianceAmount).toBe(0)
    const consumes = movementWrites().filter((values) => values.type === 'build_consume')
    expect(consumes[0]?.unitCostMinor).toBe(0)
  })

  it('refuses a completion that produces nothing', async () => {
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 0 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.patches).toEqual([])
  })
})

// ─── reverseBuild ───────────────────────────────────────────────────────

describe('reverseBuild', () => {
  beforeEach(() => {
    h.builds.set(BUILD, completedBuild())
    h.buildMovements = completedMovementRows()
  })

  it("carries the ORIGINAL's frozen costs, not today's", async () => {
    // The standard has moved since. A reversal that re-priced would net the pair
    // to a non-zero amount of inventory value out of nothing.
    h.standards.set(PART_ASM, 9999)
    h.standards.set(PART_LIFT, 12345)

    const result = await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(result.isOk()).toBe(true)

    const rows = movementWrites()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      type: 'build_consume',
      quantity: 24,
      unitCostMinor: 3661,
      extendedCostMinor: 87864,
      glRole: 'inventory_raw_materials',
      qtyPerUnit: 2,
      costBasis: 'standard',
      reversesMovementId: 'mv_1',
      adjustSubparts: false,
    })
    expect(rows[1]).toMatchObject({
      type: 'build_produce',
      quantity: -10,
      unitCostMinor: 8022,
      extendedCostMinor: -80220,
      reversesMovementId: 'mv_2',
    })
    expect(JSON.stringify(rows)).not.toContain('9999')
    expect(JSON.stringify(rows)).not.toContain('12345')
  })

  it('writes a second build carrying the negated quantities and costs', async () => {
    await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(h.inserted).toEqual([
      {
        partId: PART_LIFT,
        status: 'completed',
        source: 'batch',
        reversalOfBuildId: BUILD,
        quantityPlanned: null,
        quantityProduced: -10,
        quantityScrapped: -2,
        materialCost: -87864,
        laborCost: -6000,
        overheadCost: -2400,
        producedValue: -80220,
        varianceAmount: -16044,
        completedAt: expect.any(Date),
        orderId: null,
        notes: null,
      },
    ])
    // Inserted before its movements: the unique index refuses a racing second reversal first.
    expect(h.trace.indexOf('create:build')).toBeLessThan(h.trace.indexOf('create:build_consume'))
    // Every reversing movement belongs to the NEW build, which is what
    // `reverseMovement` could not express.
    for (const values of movementWrites()) {
      expect(values.buildId).toBe('bld_new_1')
    }
  })

  it('settles the movements once, after the commit', async () => {
    await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(h.settleCalls).toHaveLength(1)
    expect([...h.settleCalls[0]!.partIds].sort()).toEqual([PART_ASM, PART_LIFT].sort())
    expect(h.trace.indexOf('settle')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  // 111 Q18: a pending leg has no cost to carry and is undone as a pending leg;
  // the pricer fills the pair together when the standard lands.
  it('undoes a PENDING build into pending legs, with no cost', async () => {
    const [consumeLeg, produceLeg] = completedMovementRows()
    h.buildMovements = [
      { ...consumeLeg, unitCostMinor: null, extendedCostMinor: null, costBasis: 'pending' },
      produceLeg!,
    ]
    const result = await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(result.isOk()).toBe(true)

    const [consume, produce] = movementWrites()
    expect(consume).toMatchObject({
      type: 'build_consume',
      quantity: 24,
      costBasis: 'pending',
      reversesMovementId: 'mv_1',
      unitCostMinor: null,
      extendedCostMinor: null,
    })
    expect(produce).toMatchObject({ unitCostMinor: 8022, extendedCostMinor: -80220 })
  })

  it('still refuses to undo a build whose leg has no cost and is not pending', async () => {
    const [consumeLeg, produceLeg] = completedMovementRows()
    h.buildMovements = [{ ...consumeLeg, unitCostMinor: null }, produceLeg!]
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(movementWrites()).toEqual([])
  })

  it('announces the reversing build, after the commit', async () => {
    await reverseBuild(db, ORG, USER, { buildId: BUILD })

    expect(h.published).toEqual([['bld_new_1']])
    expect(h.trace.indexOf('publish-build')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  it('refuses a build that is already reversed — a second negation is invisible', async () => {
    h.alreadyReversed = true
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.inserted).toEqual([])
  })

  it('refuses to reverse a reversal — the correction of an over-correction is a fresh build', async () => {
    h.builds.set(BUILD, completedBuild({ reversalOfBuildId: 'bld_original' }))
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.inserted).toEqual([])
  })

  it('refuses a build that was never completed — cancel it instead', async () => {
    h.builds.set(BUILD, buildRecord({ buildId: BUILD }))
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.inserted).toEqual([])
  })
})

// The posting seam has its own test (`postings/__tests__/post-inventory-movement.test.ts`);
// this file is about the movements. `vi.mock` is hoisted, so placement is free.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  postInventoryMovementInTx: (...args: unknown[]) => h.postSpy(...args),
  exportInventoryMovement: async () => null,
  inventoryTxnDate: (day: Date) => day.toISOString().slice(0, 10),
  reverseInventoryMovementPosting: async () => null,
  reversePostingForMovement: async () => null,
  linkMovementsToPosting: async () => undefined,
}))
