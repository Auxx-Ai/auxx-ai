// packages/lib/src/builds/__tests__/build-event.test.ts
//
// The build event: what `createBuild` does NOT write, what `completeBuild`
// writes and at what cost, and what `reverseBuild` carries back.
//
// Harness style follows `receiving/__tests__/reverse-movement.test.ts` — the org
// cache, the CRUD handler, the quantity-on-hand batch and the standard-cost read
// are doubles, and a db stand-in routes the reads by table identity plus whether
// the query joined. Nothing here needs a database.
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so `schema.Foo` is a
// memoized `{}` and its COLUMNS are `undefined`. Table identity therefore works
// (`.from(schema.FieldValue)` is comparable by reference) but no assertion can
// name a column, and the double ignores every `WHERE` — so a fixture must be
// narrow enough that "the rows this table would return" is unambiguous.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../errors'

const ORG = 'org_1'
const USER = 'user_1'
const BUILD = 'bld_1'
const PART_LIFT = 'part_lift'
const PART_ASM = 'part_asm'
const PART_MOTOR = 'part_motor'
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')

/** One stored `FieldValue`, in the widest projection any read here selects. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueDate: string | null
  optionId: string | null
  relatedEntityId: string | null
}

/** One created record, as the CRUD double reports it back. */
interface CreatedRecord {
  defId: string
  /** The id the double minted — what a realtime frame must carry, bare. */
  id: string
  values: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  /** `.from(EntityInstance)` with no join. */
  instanceRows: [] as { id: string; createdAt: Date; displayName: string | null }[],
  /** `.from(EntityInstance).innerJoin(...)` — the build's own movements. */
  movementInstances: [] as { id: string }[],
  /** `.from(FieldValue)` with no join. One combined list; every reader buckets it. */
  valueRows: [] as ValueRow[],
  /** `.from(FieldValue).innerJoin(EntityInstance)` — the already-reversed probe. */
  reversalRows: [] as { id: string }[],
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** entityType -> def id; a missing key models a def the org does not have. */
  defs: new Map<string, string>(),
  /** partId -> frozen standard cost, minor units. Absent = never rolled. */
  standards: new Map<string, number>(),
  /** The two `manufacturing.*` rates, per unit, minor units. */
  rates: { laborCostPerUnit: null as number | null, overheadCostPerUnit: null as number | null },
  /** parentPartId -> direct children, the real depth-1 semantics over a fixture. */
  bom: new Map<string, { childId: string; qty: number }[]>(),
  created: [] as CreatedRecord[],
  updated: [] as { recordId: string; values: Record<string, unknown> }[],
  /** Options every `UnifiedCrudHandler` was constructed with, in order. */
  constructions: [] as (Record<string, unknown> | undefined)[],
  recalcCalls: [] as string[][],
  /** Interleaved trace: what ran, and on which side of the commit. */
  trace: [] as string[],
  publishedEntries: [] as unknown[],
  /** Every tier-2 `records:changed` frame `publishQuietBuildWrites` emitted. */
  movementFrames: [] as Array<{ entityDefinitionId: string; entries: Array<{ recordId: string }> }>,
  getDeductionTargets: vi.fn(),
  loadSubpartGraph: vi.fn(),
  nextId: 0,
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  requireCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => {
    const id = h.defs.get(entityType)
    if (!id) throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
    return id
  }),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, h.materialised.has(attr) ? { id: `fld_${attr}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../bom/subpart-graph', () => ({
  // The REAL depth-1 semantics over the fixture: asked for the lift it returns
  // the assembly, asked for the assembly it would return the motor. That is what
  // makes the direct-only assertion mean something — if the code walked a level
  // deeper it would get an answer, and the motor would appear in the ledger.
  loadDirectSubparts: vi.fn(async (_db: unknown, _org: string, partId: string) => {
    h.trace.push(`loadDirectSubparts:${partId}`)
    return h.bom.get(partId) ?? []
  }),
  loadSubpartGraph: h.loadSubpartGraph,
  getDeductionTargets: h.getDeductionTargets,
}))

vi.mock('../standard-cost-queries', () => ({
  readStandardCost: vi.fn(async (_db: unknown, _org: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, { partId: string; standardCost: number }>()
    for (const partId of partIds) {
      const standardCost = h.standards.get(partId)
      if (standardCost != null) map.set(partId, { partId, standardCost })
    }
    return ok(map)
  }),
  loadAbsorptionRates: vi.fn(async () => h.rates),
}))

vi.mock('../../bom/qoh', () => ({
  batchRecalculateQoH: vi.fn(async (_org: string, partIds: string[]) => {
    h.trace.push('recalc')
    h.recalcCalls.push(partIds)
  }),
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: vi.fn(async (_svc: unknown, _org: string, entries: unknown[]) => {
    h.trace.push('publish')
    h.publishedEntries.push(...entries)
  }),
  publishRecordsChanged: vi.fn(
    async (
      _svc: unknown,
      _org: string,
      args: { entityDefinitionId: string; entries: Array<{ recordId: string }> }
    ) => {
      h.trace.push('publish-movements')
      h.movementFrames.push(args)
    }
  ),
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    constructor(
      _org: string,
      _user: string,
      _db: unknown,
      _socketId: unknown,
      options?: Record<string, unknown>
    ) {
      h.constructions.push(options)
    }
    async create(defId: string, values: Record<string, unknown>) {
      h.nextId += 1
      const id = defId === h.defs.get('build') ? `bld_new_${h.nextId}` : `mv_new_${h.nextId}`
      h.created.push({ defId, id, values })
      h.trace.push(`create:${String(values.stock_movement_type ?? 'build')}`)
      return { instance: { id }, recordId: `${defId}:${id}`, values }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      h.updated.push({ recordId, values })
      h.trace.push('update')
      return { id: recordId }
    }
  },
}))

import { amendPlannedBuildQuantity, cancelBuild, createBuild, startBuild } from '../build-mutations'
import { completeBuild } from '../complete-build'
import { reverseBuild } from '../reverse-build'

// ─── The db double ──────────────────────────────────────────────────────

/**
 * A real Promise carrying the terminal chain methods, so `await` works anywhere
 * along the chain. Deliberately a Promise with properties attached rather than a
 * hand-rolled thenable: an object with its own `then` is a trap the moment
 * anything else awaits it.
 */
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
  const state = { table: null as unknown, joined: false }
  const rows = () => {
    if (state.table === schema.EntityInstance) {
      return state.joined ? h.movementInstances : h.instanceRows
    }
    return state.joined ? h.reversalRows : h.valueRows
  }
  const chain: Record<string, unknown> = {
    from: (table: unknown) => {
      state.table = table
      return chain
    },
    innerJoin: () => {
      state.joined = true
      return chain
    },
    leftJoin: () => chain,
    $dynamic: () => chain,
    where: () => rowsPromise(rows()),
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

const BUILD_ATTRS = [
  'build_number',
  'build_part',
  'build_status',
  'build_quantity_planned',
  'build_quantity_produced',
  'build_quantity_scrapped',
  'build_started_at',
  'build_completed_at',
  'build_material_cost',
  'build_labor_cost',
  'build_overhead_cost',
  'build_produced_value',
  'build_variance_amount',
  'build_posted_at',
  'build_notes',
  'build_order',
  'build_source',
  'build_reversal_of',
  'build_order_revision',
]

const MOVEMENT_ATTRS = [
  'stock_movement_build',
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_qty_per_unit',
  'stock_movement_cost_basis',
]

function value(entityId: string, attr: string, over: Partial<ValueRow>): ValueRow {
  return {
    entityId,
    fieldId: `fld_${attr}`,
    valueText: null,
    valueNumber: null,
    valueDate: null,
    optionId: null,
    relatedEntityId: null,
    ...over,
  }
}

/** The part classifications every fixture shares. */
function partKindRows(): ValueRow[] {
  return [
    value(PART_LIFT, 'part_kind', { optionId: 'finished_good' }),
    value(PART_ASM, 'part_kind', { optionId: 'subassembly' }),
    value(PART_MOTOR, 'part_kind', { optionId: 'component' }),
  ]
}

/** A `planned` build of 10 lifts. */
function plannedBuildRows(): ValueRow[] {
  return [
    value(BUILD, 'build_status', { optionId: 'planned' }),
    value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
    value(BUILD, 'build_quantity_planned', { valueNumber: 10 }),
  ]
}

/**
 * The SAME build after the completion in `completes a run with scrap` — 10 good,
 * 2 scrapped, at the numbers that test asserts.
 */
function completedBuildRows(): ValueRow[] {
  return [
    value(BUILD, 'build_status', { optionId: 'completed' }),
    value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
    value(BUILD, 'build_quantity_planned', { valueNumber: 10 }),
    value(BUILD, 'build_quantity_produced', { valueNumber: 10 }),
    value(BUILD, 'build_quantity_scrapped', { valueNumber: 2 }),
    value(BUILD, 'build_material_cost', { valueNumber: 87864 }),
    value(BUILD, 'build_labor_cost', { valueNumber: 6000 }),
    value(BUILD, 'build_overhead_cost', { valueNumber: 2400 }),
    value(BUILD, 'build_produced_value', { valueNumber: 80220 }),
    value(BUILD, 'build_variance_amount', { valueNumber: 16044 }),
    value(BUILD, 'build_completed_at', { valueDate: '2026-08-02T00:00:00.000Z' }),
  ]
}

/** The two movements that completion wrote, with their FROZEN costs. */
function completedMovementRows(): ValueRow[] {
  return [
    value('mv_1', 'stock_movement_part', { relatedEntityId: PART_ASM }),
    value('mv_1', 'stock_movement_type', { optionId: 'build_consume' }),
    value('mv_1', 'stock_movement_quantity', { valueNumber: -24 }),
    value('mv_1', 'stock_movement_unit_cost', { valueNumber: 3661 }),
    value('mv_1', 'stock_movement_extended_cost', { valueNumber: -87864 }),
    value('mv_1', 'stock_movement_gl_account', { valueText: 'inventory_raw_materials' }),
    value('mv_1', 'stock_movement_qty_per_unit', { valueNumber: 2 }),
    value('mv_1', 'stock_movement_cost_basis', { optionId: 'standard' }),
    value('mv_2', 'stock_movement_part', { relatedEntityId: PART_LIFT }),
    value('mv_2', 'stock_movement_type', { optionId: 'build_produce' }),
    value('mv_2', 'stock_movement_quantity', { valueNumber: 10 }),
    value('mv_2', 'stock_movement_unit_cost', { valueNumber: 8022 }),
    value('mv_2', 'stock_movement_extended_cost', { valueNumber: 80220 }),
    value('mv_2', 'stock_movement_gl_account', { valueText: 'inventory_finished_goods' }),
    value('mv_2', 'stock_movement_cost_basis', { optionId: 'standard' }),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set([...BUILD_ATTRS, ...MOVEMENT_ATTRS, 'part_kind'])
  h.defs = new Map([
    ['build', 'def_build'],
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
    ['order', 'def_order'],
  ])
  // The build row FIRST: the double ignores `WHERE`, and every detail read takes
  // `[instance]`, so position is what identifies it.
  h.instanceRows = [
    { id: BUILD, createdAt: CREATED_AT, displayName: null },
    { id: PART_LIFT, createdAt: CREATED_AT, displayName: 'Auxx Lift 400lbs 4x8' },
    { id: PART_ASM, createdAt: CREATED_AT, displayName: '400Lbs motor Assembly' },
  ]
  h.movementInstances = []
  h.reversalRows = []
  h.valueRows = [...plannedBuildRows(), ...partKindRows()]
  // 2 assemblies per lift; 1 motor per assembly. The motor is one level too deep
  // for a build to touch (B4).
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
  h.created = []
  h.updated = []
  h.constructions = []
  h.recalcCalls = []
  h.trace = []
  h.publishedEntries = []
  h.movementFrames = []
  h.nextId = 0
})

/** Every `stock_movement` the CRUD double was asked to create. */
function movementWrites(): Record<string, unknown>[] {
  return h.created.filter((row) => row.defId === 'def_mv').map((row) => row.values)
}

/** The ids of every `stock_movement` written, in write order. */
function movementIdsWritten(): string[] {
  return h.created.filter((row) => row.defId === 'def_mv').map((row) => row.id)
}

/** Every `build` the CRUD double was asked to create. */
function buildWrites(): Record<string, unknown>[] {
  return h.created.filter((row) => row.defId === 'def_build').map((row) => row.values)
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
    expect(buildWrites()).toHaveLength(1)
    expect(buildWrites()[0]).toMatchObject({
      build_status: 'planned',
      build_quantity_planned: 10,
      build_part: 'def_part:part_lift',
      build_source: 'manual',
    })
  })

  it('refuses a component — a purchased part is not assembled', async () => {
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_MOTOR, quantityPlanned: 1 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    // The kind check runs BEFORE the bill-of-materials check, and the motor has
    // one — so this must fail on the classification, not on the BOM.
    expect(error.message).toContain('part kind')
    expect(h.created).toEqual([])
  })

  it('refuses a part with no bill of materials — a build would consume nothing', async () => {
    h.bom.set(PART_LIFT, [])
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 10 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('bill of materials')
    expect(h.created).toEqual([])
  })

  it('refuses a run that plans to produce nothing', async () => {
    const error = await expectErr(
      createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 0 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.created).toEqual([])
  })
})

// ─── amendPlannedBuildQuantity ──────────────────────────────────────────

/**
 * The writer plan 13's Model B reconciler converges an order-raised build with
 * (plans/products/13-order-build-reconciliation.md §1.5, §5).
 *
 * 🛑 Two properties are what this suite is for: it writes NO movements, like
 * everything else in `build-mutations.ts` (B2); and it accepts `planned` ONLY,
 * which is deliberately narrower than `cancelBuild` — an `in_progress` build has
 * written nothing either, but material may already be cut against the quantity
 * somebody was told to build (§1.0(a)).
 */
describe('amendPlannedBuildQuantity', () => {
  /** The one build update the CRUD double was asked to perform. */
  function amendment(): Record<string, unknown> | undefined {
    return h.updated[0]?.values
  }

  it('amends a planned build and re-stamps the order revision in the SAME update', async () => {
    const result = await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 25,
      orderRevision: 'rev_after',
    })

    expect(result.isOk()).toBe(true)
    // 🛑 One update, not two. A reader between two writes would see a build that
    // disagrees with its own drift fingerprint.
    expect(h.updated).toHaveLength(1)
    expect(amendment()).toEqual({
      build_quantity_planned: 25,
      build_order_revision: 'rev_after',
    })
    // B2 — nothing here reaches the ledger.
    expect(movementWrites()).toEqual([])
    expect(h.created).toEqual([])
  })

  it('writes only the quantity when no revision is given', async () => {
    const result = await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 3,
    })

    expect(result.isOk()).toBe(true)
    expect(amendment()).toEqual({ build_quantity_planned: 3 })
    expect(amendment()).not.toHaveProperty('build_order_revision')
  })

  it('clears the stamp back to unknown when the caller passes null explicitly', async () => {
    // `hasDrifted` reads a missing stamp as *unknown*, never as *drifted*, so a
    // reconciler that converged the build but could not compute the order's new
    // fingerprint says so rather than leaving a stamp that now reports drift
    // which has just been resolved.
    const result = await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 4,
      orderRevision: null,
    })

    expect(result.isOk()).toBe(true)
    expect(amendment()).toEqual({ build_quantity_planned: 4, build_order_revision: null })
  })

  it('leaves the revision alone on an org that has not materialised the field', async () => {
    h.materialised.delete('build_order_revision')

    const result = await amendPlannedBuildQuantity(db, ORG, USER, {
      buildId: BUILD,
      quantityPlanned: 7,
      orderRevision: 'rev_after',
    })

    expect(result.isOk()).toBe(true)
    expect(amendment()).toEqual({ build_quantity_planned: 7 })
  })

  it('🛑 REFUSES an in_progress build — cancellable, never silently amendable', async () => {
    h.valueRows = [
      value(BUILD, 'build_status', { optionId: 'in_progress' }),
      value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
      value(BUILD, 'build_quantity_planned', { valueNumber: 10 }),
      ...partKindRows(),
    ]

    const error = await expectErr(
      amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(h.updated).toEqual([])
    // And the same build is still cancellable — that is the asymmetry §1.5 asks for.
    const cancelled = await cancelBuild(db, ORG, USER, { buildId: BUILD })
    expect(cancelled.isOk()).toBe(true)
  })

  it('refuses a completed build — B6/B8, it is reversed, never edited', async () => {
    h.valueRows = [...completedBuildRows(), ...partKindRows()]

    const error = await expectErr(
      amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(h.updated).toEqual([])
  })

  it('refuses a canceled build — terminal', async () => {
    h.valueRows = [
      value(BUILD, 'build_status', { optionId: 'canceled' }),
      value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
      ...partKindRows(),
    ]

    const error = await expectErr(
      amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(h.updated).toEqual([])
  })

  it('refuses a build whose status is missing entirely', async () => {
    // A row nobody can state the lifecycle of is never defaulted to `planned`
    // on a path that writes (`resolveBuildStatus`).
    h.valueRows = [
      value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
      value(BUILD, 'build_quantity_planned', { valueNumber: 10 }),
      ...partKindRows(),
    ]

    const error = await expectErr(
      amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(h.updated).toEqual([])
  })

  it('refuses a quantity that plans to produce nothing — the same words as createBuild', async () => {
    for (const quantityPlanned of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await expectErr(
        amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned })
      )
      expect(error, String(quantityPlanned)).toBeInstanceOf(BadRequestError)
      expect(error.message).toBe('A build must plan to produce at least one unit')
    }
    expect(h.updated).toEqual([])
  })

  it('takes the DEFAULT lane — a planned build writes no ledger and must stay realtime', async () => {
    // Only `completeBuild` / `reverseBuild` take `buildWriteSession()`
    // (`write-lane.ts`); silencing an amendment would cost the build list its
    // realtime update for no benefit.
    await amendPlannedBuildQuantity(db, ORG, USER, { buildId: BUILD, quantityPlanned: 25 })

    expect(h.constructions).toHaveLength(1)
    expect(h.constructions[0]?.session).toBeUndefined()
  })
})

// ─── completeBuild ──────────────────────────────────────────────────────

describe('completeBuild', () => {
  it('consumes the DIRECT subparts only — a subassembly is consumed as itself (B4)', async () => {
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(result.isOk()).toBe(true)

    const consumes = movementWrites().filter(
      (values) => values.stock_movement_type === 'build_consume'
    )
    expect(consumes).toHaveLength(1)
    expect(consumes[0]?.stock_movement_part).toBe('def_part:part_asm')
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

    const produces = movementWrites().filter(
      (values) => values.stock_movement_type === 'build_produce'
    )
    expect(produces).toHaveLength(1)
    // Not 12. Scrapped units produce nothing.
    expect(produces[0]?.stock_movement_quantity).toBe(10)
  })

  it('aborts when a component has no standard cost — never posts a zero', async () => {
    h.standards.delete(PART_ASM)
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('zero cost')
    expect(h.created).toEqual([])
    expect(h.updated).toEqual([])
  })

  it('aborts when the PRODUCED part has no standard cost', async () => {
    h.standards.delete(PART_LIFT)
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.created).toEqual([])
  })

  it('refuses a SECOND completion — one completion per build (B8)', async () => {
    h.valueRows = [...completedBuildRows(), ...partKindRows()]
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.created).toEqual([])
    expect(h.updated).toEqual([])
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
      expect(values.stock_movement_adjust_subparts).toBe(false)
    }
  })

  it('recalculates quantity on hand ONCE, batched, and only after the commit', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })

    expect(h.recalcCalls).toHaveLength(1)
    // The produced part and every consumed part, deduplicated. Under the quiet
    // lane this call is the ONLY thing that recalculates them.
    expect([...h.recalcCalls[0]!].sort()).toEqual([PART_ASM, PART_LIFT].sort())
    // Ordering, not just presence: a recalc inside the transaction would re-SUM
    // a ledger that does not yet contain the rows above.
    expect(h.trace.indexOf('commit')).toBeGreaterThan(-1)
    expect(h.trace.indexOf('recalc')).toBeGreaterThan(h.trace.indexOf('commit'))
    for (const entry of h.trace.filter((step) => step.startsWith('create:'))) {
      expect(h.trace.indexOf(entry)).toBeLessThan(h.trace.indexOf('commit'))
    }
  })

  it('announces the movements with ONE tier-2 frame, after the commit', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })

    // ONE frame: a completion writes movements only — its build row already
    // exists, and `publishBuildUpdate` carries that row's changed values.
    expect(h.movementFrames).toHaveLength(1)
    const frame = h.movementFrames[0]!
    // The `stock_movement` def, NOT `build`: the ledger card lists movements, so
    // a frame addressed to the build def is delivered to the wrong query.
    expect(frame.entityDefinitionId).toBe('def_mv')
    // BARE instance ids (`RecordChangedEntry.recordId`), never composite ones.
    expect(frame.entries.map((entry) => entry.recordId)).toEqual(movementIdsWritten())
    for (const entry of frame.entries) expect(entry.recordId).not.toContain(':')
    // After the commit, like every other post-commit door here — the rows have
    // to be readable by the refetch the frame provokes.
    expect(h.trace.indexOf('publish-movements')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  it('writes the ledger on the quiet lane, and never with the deprecated skipEvents alias', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })

    const ledgerHandlers = h.constructions.filter((options) => options?.session)
    expect(ledgerHandlers).toHaveLength(1)
    const session = ledgerHandlers[0]?.session as {
      mode?: { kind: string }
      origin: { kind: string }
    }
    expect(session.mode?.kind).toBe('quiet')
    // `automation`, not `seed`: a build completion is production automation, and
    // a seed reason string would be a lie.
    expect(session.origin.kind).toBe('automation')
    for (const values of movementWrites()) {
      expect(values).not.toHaveProperty('skipEvents')
    }
  })

  it('freezes the standard onto every row, with the extended cost signed like the quantity', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const [consume, produce] = movementWrites()

    expect(consume).toMatchObject({
      stock_movement_type: 'build_consume',
      stock_movement_quantity: -20,
      stock_movement_unit_cost: 3661,
      stock_movement_extended_cost: -73220,
      // A subassembly's stock sits in Raw Materials, not Finished Goods.
      stock_movement_gl_account: 'inventory_raw_materials',
      stock_movement_cost_basis: 'standard',
      // The as-built BOM snapshot.
      stock_movement_qty_per_unit: 2,
      stock_movement_build: 'def_build:bld_1',
    })
    expect(produce).toMatchObject({
      stock_movement_type: 'build_produce',
      stock_movement_quantity: 10,
      stock_movement_unit_cost: 8022,
      stock_movement_extended_cost: 80220,
      stock_movement_gl_account: 'inventory_finished_goods',
      stock_movement_build: 'def_build:bld_1',
    })
    // NULL on the produce row, never a zero.
    expect(produce).not.toHaveProperty('stock_movement_qty_per_unit')
  })

  it('stamps the build with the five costs and the completed status', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      quantityScrapped: 2,
    })
    expect(h.updated).toHaveLength(1)
    expect(h.updated[0]?.values).toMatchObject({
      build_status: 'completed',
      build_quantity_produced: 10,
      build_quantity_scrapped: 2,
      build_material_cost: 87864,
      build_labor_cost: 6000,
      build_overhead_cost: 2400,
      build_produced_value: 80220,
      build_variance_amount: 16044,
    })
  })

  it('takes a per-component override without losing the as-built BOM snapshot', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      componentOverrides: [{ partId: PART_ASM, quantityConsumed: 21 }],
    })
    const [consume] = movementWrites()
    expect(consume?.stock_movement_quantity).toBe(-21)
    // The floor used one more than the bill of materials called for. The bill
    // still called for 2 per unit, and the snapshot says so.
    expect(consume?.stock_movement_qty_per_unit).toBe(2)
  })

  it('marks an OFF-BOM substitution with a null qtyPerUnit rather than a zero', async () => {
    await completeBuild(db, ORG, USER, {
      buildId: BUILD,
      quantityProduced: 10,
      componentOverrides: [{ partId: PART_MOTOR, quantityConsumed: 5 }],
    })
    const substitution = movementWrites().find(
      (values) => values.stock_movement_part === 'def_part:part_motor'
    )
    expect(substitution?.stock_movement_quantity).toBe(-5)
    expect(substitution).not.toHaveProperty('stock_movement_qty_per_unit')
    // A component's stock sits in Raw Materials.
    expect(substitution?.stock_movement_gl_account).toBe('inventory_raw_materials')
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

  it('refuses a completion that produces nothing', async () => {
    const error = await expectErr(
      completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 0 })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.created).toEqual([])
  })
})

// ─── reverseBuild ───────────────────────────────────────────────────────

describe('reverseBuild', () => {
  beforeEach(() => {
    h.valueRows = [...completedBuildRows(), ...completedMovementRows(), ...partKindRows()]
    h.movementInstances = [{ id: 'mv_1' }, { id: 'mv_2' }]
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
      stock_movement_type: 'build_consume',
      stock_movement_quantity: 24,
      stock_movement_unit_cost: 3661,
      stock_movement_extended_cost: 87864,
      stock_movement_gl_account: 'inventory_raw_materials',
      stock_movement_qty_per_unit: 2,
      stock_movement_cost_basis: 'standard',
      stock_movement_reverses_movement: 'def_mv:mv_1',
      stock_movement_adjust_subparts: false,
    })
    expect(rows[1]).toMatchObject({
      stock_movement_type: 'build_produce',
      stock_movement_quantity: -10,
      stock_movement_unit_cost: 8022,
      stock_movement_extended_cost: -80220,
      stock_movement_reverses_movement: 'def_mv:mv_2',
    })
    expect(JSON.stringify(rows)).not.toContain('9999')
    expect(JSON.stringify(rows)).not.toContain('12345')
  })

  it('writes a second build carrying the negated quantities and costs', async () => {
    await reverseBuild(db, ORG, USER, { buildId: BUILD })
    const [reversal] = buildWrites()
    expect(reversal).toMatchObject({
      build_status: 'completed',
      build_reversal_of: 'def_build:bld_1',
      build_part: 'def_part:part_lift',
      build_quantity_produced: -10,
      build_quantity_scrapped: -2,
      build_material_cost: -87864,
      build_labor_cost: -6000,
      build_overhead_cost: -2400,
      build_produced_value: -80220,
      build_variance_amount: -16044,
    })
    // Every reversing movement belongs to the NEW build, which is what
    // `reverseMovement` could not express.
    for (const values of movementWrites()) {
      expect(values.stock_movement_build).toBe('def_build:bld_new_1')
    }
  })

  it('recalculates quantity on hand once, after the commit', async () => {
    await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(h.recalcCalls).toHaveLength(1)
    expect([...h.recalcCalls[0]!].sort()).toEqual([PART_ASM, PART_LIFT].sort())
    expect(h.trace.indexOf('recalc')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  it('announces BOTH defs — the reversing movements and the new build row', async () => {
    // A reversal writes on two defs and both are silent. The movements feed the
    // reversing build's own ledger; the `build` row is a CREATE that no open
    // builds list would otherwise learn about (`completeBuild` never needs this
    // — its build row already exists).
    await reverseBuild(db, ORG, USER, { buildId: BUILD })

    expect(h.movementFrames).toHaveLength(2)
    const byDef = Object.fromEntries(
      h.movementFrames.map((frame) => [frame.entityDefinitionId, frame.entries])
    )
    expect(Object.keys(byDef).sort()).toEqual(['def_build', 'def_mv'])
    expect(byDef.def_mv?.map((entry) => entry.recordId)).toEqual(movementIdsWritten())
    // The REVERSING build, not the one being reversed — that is the row the
    // list is missing.
    expect(byDef.def_build?.map((entry) => entry.recordId)).toEqual(['bld_new_1'])
    for (const entry of [...(byDef.def_mv ?? []), ...(byDef.def_build ?? [])]) {
      expect(entry.recordId).not.toContain(':')
    }
    expect(h.trace.indexOf('publish-movements')).toBeGreaterThan(h.trace.indexOf('commit'))
  })

  it('refuses a build that is already reversed — a second negation is invisible', async () => {
    h.reversalRows = [{ id: 'bld_rev' }]
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.created).toEqual([])
  })

  it('refuses to reverse a reversal — the correction of an over-correction is a fresh build', async () => {
    h.valueRows = [
      ...completedBuildRows(),
      value(BUILD, 'build_reversal_of', { relatedEntityId: 'bld_original' }),
      ...completedMovementRows(),
      ...partKindRows(),
    ]
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.created).toEqual([])
  })

  it('refuses a build that was never completed — cancel it instead', async () => {
    h.valueRows = [...plannedBuildRows(), ...partKindRows()]
    const error = await expectErr(reverseBuild(db, ORG, USER, { buildId: BUILD }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(h.created).toEqual([])
  })
})

// ─── the build_status lifecycle wall ────────────────────────────────────

/**
 * 🛑 `field-hooks/pre/build-status-guard.ts` refuses a manual write of `in_progress`,
 * `completed` or `canceled`. `fireFieldPreHooks` short-circuits on
 * `ctx.bypassFieldGuards.has(systemAttribute)` BEFORE that handler runs, and
 * `UnifiedCrudHandler` forwards the set it was constructed with to the `FieldValueService`
 * it owns — so these assertions are the only thing standing between the guard and Start /
 * Complete / Cancel / Reverse silently ceasing to work
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4: half of this fix is
 * worse than none).
 *
 * Nothing in this file's doubles enforces the guard, which is precisely why the bypass has
 * to be asserted rather than inferred from a green test.
 */
describe('every sanctioned build_status writer carries its bypass', () => {
  /** The bypass set of the handler that performed the Nth construction. */
  function bypasses(index = 0): string[] {
    const options = h.constructions[index]
    const set = options?.bypassFieldGuards as ReadonlySet<string> | undefined
    return set ? [...set] : []
  }

  it('createBuild bypasses, even though planned is not guarded', async () => {
    // The exemption belongs to the WRITER, not to today's value set — widening the guard
    // later must not break the action that raises a build.
    await createBuild(db, ORG, USER, { partId: PART_LIFT, quantityPlanned: 10 })
    expect(bypasses()).toEqual(['build_status'])
  })

  it('startBuild bypasses — it writes the guarded in_progress', async () => {
    const result = await startBuild(db, ORG, USER, { buildId: BUILD })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toMatchObject({ build_status: 'in_progress' })
    expect(bypasses()).toEqual(['build_status'])
  })

  it('cancelBuild bypasses — it writes the guarded canceled', async () => {
    const result = await cancelBuild(db, ORG, USER, { buildId: BUILD })
    expect(result.isOk()).toBe(true)
    expect(h.updated[0]?.values).toMatchObject({ build_status: 'canceled' })
    expect(bypasses()).toEqual(['build_status'])
  })

  it('completeBuild bypasses — without it the ledger writer is refused by its own wall', async () => {
    const result = await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    expect(result.isOk()).toBe(true)
    expect(bypasses()).toEqual(['build_status'])
  })

  it('reverseBuild bypasses — the reversing build is CREATED at completed', async () => {
    // 🛑 The field chain has no `operation === 'create'` exemption, so a create carrying a
    // guarded value is refused exactly like an update. B6's only correction for a posted run
    // depends on this.
    h.valueRows = [...completedBuildRows(), ...completedMovementRows(), ...partKindRows()]
    h.movementInstances = [{ id: 'mv_1' }, { id: 'mv_2' }]

    const result = await reverseBuild(db, ORG, USER, { buildId: BUILD })
    expect(result.isOk()).toBe(true)
    expect(buildWrites()[0]).toMatchObject({ build_status: 'completed' })
    expect(bypasses()).toEqual(['build_status'])
  })

  // 🛑 ONE element. `completeBuild` and `reverseBuild` write their stock movements through
  // the SAME handler and so inherit this set; a second attribute would silently disarm a
  // guard on the movement rows and nothing would say so — the same narrowness that keeps
  // `markQuoteSent`'s mirror write safe (21 §7.1).
  it('names build_status and nothing else, on every handler it constructs', async () => {
    h.valueRows = [...completedBuildRows(), ...completedMovementRows(), ...partKindRows()]
    h.movementInstances = [{ id: 'mv_1' }, { id: 'mv_2' }]
    await reverseBuild(db, ORG, USER, { buildId: BUILD })

    expect(h.constructions.length).toBeGreaterThan(0)
    for (const options of h.constructions) {
      const set = options?.bypassFieldGuards as ReadonlySet<string> | undefined
      expect(set).toBeDefined()
      expect(set?.size).toBe(1)
      expect(set?.has('build_status')).toBe(true)
      expect(set?.has('stock_movement_type')).toBe(false)
      expect(set?.has('stock_movement_unit_cost')).toBe(false)
    }
  })

  it('keeps the quiet lane and the bypass on the same handler', async () => {
    await completeBuild(db, ORG, USER, { buildId: BUILD, quantityProduced: 10 })
    const ledgerHandlers = h.constructions.filter((options) => options?.session)
    expect(ledgerHandlers).toHaveLength(1)
    expect([...(ledgerHandlers[0]?.bypassFieldGuards as ReadonlySet<string>)]).toEqual([
      'build_status',
    ])
  })
})
