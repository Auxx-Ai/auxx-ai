// packages/lib/src/builds/__tests__/reverse-build-batch-run.test.ts
//
// 🛑 THE invariant of `plans/money/tasks/45-batch-only-builds.md` section 4.1:
// **a reversing build must NOT inherit `build_batch_run`.**
//
// `reverse-build.ts`'s `reversalBuildValues` copies `build_source` onto the
// reversal, so a reversal of a batch build is itself `source: 'batch'`. That is
// correct and deliberate, and it is also exactly the shape that invites somebody
// copying the sibling field sitting beside it. If the run number were copied,
// run N would contain its own undo, and a second `undoBatchRun(N)` would try to
// reverse the reversals: `reverseBuild` refuses a reversal-of-a-reversal, so the
// visible symptom would not be a wrong number but a run that can never be
// cleanly undone twice.
//
// 45 section 10.5 is why this file exists rather than a schema flag:
// `build_batch_run` is declared `updatable: false`, and the write path never
// reads `capabilities.updatable` (`field-hooks/register-hooks.ts`). So this test
// is the ONLY protection the rule has, not a belt beside a brace.
//
// ⚠️ `reverse-build.ts` is NOT edited by this test. The current code is already
// correct; this pins it.
//
// Harness copied from `build-event.test.ts`: the org cache, the CRUD handler,
// the quantity-on-hand batch and realtime are doubles, and a db stand-in routes
// the reads by table identity plus whether the query joined. `src/test/setup.ts`
// mocks `@auxx/database` wholesale, so no assertion here can name a column and
// the double ignores every `WHERE`.

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const USER = 'user_1'
const BUILD = 'bld_1'
const PART_LIFT = 'part_lift'
const PART_ASM = 'part_asm'
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')
const BATCH_RUN = 7

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

const h = vi.hoisted(() => ({
  instanceRows: [] as { id: string; createdAt: Date; displayName: string | null }[],
  movementInstances: [] as { id: string }[],
  valueRows: [] as {
    entityId: string
    fieldId: string
    valueText: string | null
    valueNumber: number | null
    valueDate: string | null
    optionId: string | null
    relatedEntityId: string | null
  }[],
  reversalRows: [] as { id: string }[],
  materialised: new Set<string>(),
  defs: new Map<string, string>(),
  created: [] as { defId: string; id: string; values: Record<string, unknown> }[],
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

vi.mock('../../bom/qoh', () => ({
  batchRecalculateQoH: vi.fn(async () => {}),
  recalculatePartQoH: vi.fn(async () => {}),
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: vi.fn(async () => {}),
  publishRecordsChanged: vi.fn(async () => {}),
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(defId: string, values: Record<string, unknown>) {
      h.nextId += 1
      const id = defId === h.defs.get('build') ? `bld_new_${h.nextId}` : `mv_new_${h.nextId}`
      h.created.push({ defId, id, values })
      return { instance: { id }, recordId: `${defId}:${id}`, values }
    }
    async update(recordId: string, values: Record<string, unknown>) {
      return { id: recordId, values }
    }
  },
}))

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
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as never

// ─── Fixtures ───────────────────────────────────────────────────────────

/**
 * Every build attribute the org has materialised.
 *
 * 🛑 The three `updatable: false` batch fields are HERE deliberately: a fixture
 * that left them unmaterialised would make this test pass for the wrong reason,
 * because `reversalBuildValues` can only copy a field the read produced.
 */
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
  'build_period_start',
  'build_period_end',
  'build_batch_run',
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

/** A completed build that batch run 7 raised, covering January. */
function batchBuildRows(): ValueRow[] {
  return [
    value(BUILD, 'build_status', { optionId: 'completed' }),
    value(BUILD, 'build_part', { relatedEntityId: PART_LIFT }),
    value(BUILD, 'build_quantity_planned', { valueNumber: 10 }),
    value(BUILD, 'build_quantity_produced', { valueNumber: 10 }),
    value(BUILD, 'build_material_cost', { valueNumber: 87864 }),
    value(BUILD, 'build_produced_value', { valueNumber: 80220 }),
    value(BUILD, 'build_completed_at', { valueDate: '2026-01-31T23:59:59.999Z' }),
    value(BUILD, 'build_source', { optionId: 'batch' }),
    value(BUILD, 'build_period_start', { valueDate: '2026-01-01T00:00:00.000Z' }),
    value(BUILD, 'build_period_end', { valueDate: '2026-02-01T00:00:00.000Z' }),
    value(BUILD, 'build_batch_run', { valueNumber: BATCH_RUN }),
  ]
}

/** The two movements the completion wrote, with their frozen costs. */
function movementRows(): ValueRow[] {
  return [
    value('mv_1', 'stock_movement_part', { relatedEntityId: PART_ASM }),
    value('mv_1', 'stock_movement_type', { optionId: 'build_consume' }),
    value('mv_1', 'stock_movement_quantity', { valueNumber: -20 }),
    value('mv_1', 'stock_movement_unit_cost', { valueNumber: 3661 }),
    value('mv_1', 'stock_movement_extended_cost', { valueNumber: -73220 }),
    value('mv_1', 'stock_movement_cost_basis', { optionId: 'standard' }),
    value('mv_2', 'stock_movement_part', { relatedEntityId: PART_LIFT }),
    value('mv_2', 'stock_movement_type', { optionId: 'build_produce' }),
    value('mv_2', 'stock_movement_quantity', { valueNumber: 10 }),
    value('mv_2', 'stock_movement_unit_cost', { valueNumber: 8022 }),
    value('mv_2', 'stock_movement_extended_cost', { valueNumber: 80220 }),
    value('mv_2', 'stock_movement_cost_basis', { optionId: 'standard' }),
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.materialised = new Set([...BUILD_ATTRS, ...MOVEMENT_ATTRS])
  h.defs = new Map([
    ['build', 'def_build'],
    ['part', 'def_part'],
    ['stock_movement', 'def_mv'],
  ])
  // The build row FIRST: the double ignores `WHERE`, and every detail read takes
  // `[instance]`, so position is what identifies it.
  h.instanceRows = [
    { id: BUILD, createdAt: CREATED_AT, displayName: null },
    { id: PART_LIFT, createdAt: CREATED_AT, displayName: 'Auxx Lift 400lbs 4x8' },
  ]
  h.movementInstances = [{ id: 'mv_1' }, { id: 'mv_2' }]
  h.reversalRows = []
  h.valueRows = [...batchBuildRows(), ...movementRows()]
  h.created = []
  h.nextId = 0
})

/** The one `build` the CRUD double was asked to create: the reversal. */
async function reverseAndReadTheNewBuild(): Promise<Record<string, unknown>> {
  const result = await reverseBuild(db, ORG, USER, { buildId: BUILD })
  expect(result.isOk()).toBe(true)
  const builds = h.created.filter((row) => row.defId === 'def_build')
  expect(builds).toHaveLength(1)
  return builds[0]!.values
}

describe('reverseBuild and build_batch_run', () => {
  it('does NOT copy the run number onto the reversal', async () => {
    const reversal = await reverseAndReadTheNewBuild()

    // The whole point. A reversal carrying run 7 would put run 7's own undo
    // inside run 7.
    expect(reversal).not.toHaveProperty('build_batch_run')
    expect(Object.keys(reversal).filter((key) => key.includes('batch'))).toEqual([])
  })

  it('DOES copy the source, which is what makes the omission deliberate', async () => {
    // `reverse-build.ts:309`. This assertion is here so the test above cannot
    // pass vacuously: if the fixture's batch fields never reached
    // `reversalBuildValues` at all, this would fail too.
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal.build_source).toBe('batch')
    expect(reversal.build_reversal_of).toBe('def_build:bld_1')
  })

  it('does not copy the demand period either', async () => {
    // 45 section 10.7: the missing period copy looks like an oversight and
    // somebody will "fix" it. It is what keeps the netting read from seeing a
    // reversal as coverage for the month it undoes.
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal).not.toHaveProperty('build_period_start')
    expect(reversal).not.toHaveProperty('build_period_end')
  })

  it('leaves the reversal invisible to a second undo of the same run', async () => {
    // The property stated the way the feature depends on it: the reversal
    // carries no run number, so `readBatchRunBuilds(7)` cannot select it and a
    // second `undoBatchRun(7)` has nothing new to reverse.
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal.build_batch_run).toBeUndefined()
    expect(reversal.build_status).toBe('completed')
  })
})
