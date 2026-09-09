// packages/lib/src/builds/__tests__/build-mutations.test.ts
//
// What `createBuild` STAMPS, and what it refuses to stamp.
//
// The lifecycle writes have their coverage elsewhere (`build-event.test.ts` owns
// the movement side, `build-status-guard-wiring.int.test.ts` the guard). What
// this file owns is the three write-once fields a batch build carries:
// `build_period_start`, `build_period_end` and `build_batch_run`.
//
// 🛑 **This is the only thing protecting them.** All three are `updatable:
// false`, which reads like a schema guarantee and is not one:
// `field-hooks/register-hooks.ts:523` states the write path NEVER reads
// `capabilities.updatable`, so the flag is documentation plus a UI and connector
// gate (plans/money/tasks/45 §10.5). What actually holds the invariant is that
// `createBuild` is the only writer and stamps them only on a `batch` build, so a
// test is the belt with no brace behind it.
//
// ⚠️ `src/test/setup.ts` mocks `@auxx/database` wholesale, so the db stand-in
// below only has to answer the one existence probe `createBuild` makes.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type { BuildRecord, CreateBuildInput } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const PART = 'part_lift'
const BUILD_DEF = 'def_build'

const h = vi.hoisted(() => ({
  /** systemAttribute -> provisioned. A missing key models an unmigrated org. */
  fields: new Set<string>(),
  /** entityType -> def id. */
  defs: new Map<string, string>(),
  /** partId -> stored `part_kind`. */
  kinds: new Map<string, string>(),
  /** Whether the part exists in this org. */
  partExists: true,
  /** Direct subparts of the part being built. Empty models no bill of materials. */
  subparts: [] as { childId: string; qty: number }[],
  /** Every `UnifiedCrudHandler.create`, as the value map it was handed. */
  created: [] as Record<string, unknown>[],
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, h.fields.has(attr) ? { id: `fld_${attr}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../bom/subpart-graph', () => ({
  loadDirectSubparts: vi.fn(async () => h.subparts),
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async create(_defId: string, values: Record<string, unknown>) {
      h.created.push(values)
      return { instance: { id: 'bld_1' } }
    }
  },
}))

// `readPartKinds` and `getBuild` are reads with their own suites; the def and
// field resolution is the real one, over `h.fields` above.
vi.mock('../build-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../build-queries')>()
  return {
    ...actual,
    readPartKinds: vi.fn(async () => h.kinds),
    getBuild: vi.fn(async (_db: unknown, _org: string, buildId: string) => ok(raised(buildId))),
  }
})

import { createBuild } from '../build-mutations'

/** The one existence probe `assertPartExists` makes, and nothing else. */
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (h.partExists ? [{ id: PART }] : []),
      }),
    }),
  }),
} as never

function raised(buildId: string): BuildRecord {
  return {
    buildId,
    recordId: `${BUILD_DEF}:${buildId}`,
    number: null,
    partId: PART,
    status: 'planned',
    quantityPlanned: 10,
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
    orderId: null,
    source: 'batch',
    reversalOfBuildId: null,
    orderRevision: null,
    batchRun: null,
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
  } as BuildRecord
}

/** One batch build over January, with the run number the dialog allocated. */
function batchInput(over: Partial<CreateBuildInput> = {}): CreateBuildInput {
  return {
    partId: PART,
    quantityPlanned: 10,
    source: 'batch',
    period: {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-02-01T00:00:00.000Z'),
    },
    batchRun: 7,
    ...over,
  }
}

beforeEach(() => {
  h.fields = new Set([
    'build_status',
    'build_part',
    'build_period_start',
    'build_period_end',
    'build_batch_run',
  ])
  h.defs = new Map([
    ['build', BUILD_DEF],
    ['part', 'def_part'],
    ['order', 'def_order'],
  ])
  h.kinds = new Map([[PART, 'subassembly']])
  h.partExists = true
  h.subparts = [{ childId: 'part_motor', qty: 2 }]
  h.created = []
})

// ─── §3: the run number a batch build carries ──────────────────────────

describe('🛑 build_batch_run is written here or never', () => {
  it('stamps the run number the caller allocated', async () => {
    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isOk()).toBe(true)
    expect(h.created[0]).toMatchObject({
      build_source: 'batch',
      build_batch_run: 7,
      build_period_start: '2026-01-01T00:00:00.000Z',
      build_period_end: '2026-02-01T00:00:00.000Z',
    })
  })

  // ⚠️ Same rule as the demand period: an order-raised build answers to one
  // order and a hand-raised one to nobody, so neither belongs to a run, and a
  // stray number on one would put it inside `undoBatchRun`'s blast radius.
  it('ignores it on a hand-raised build', async () => {
    await createBuild(db, ORG, USER, batchInput({ source: 'manual', period: undefined }))
    expect(h.created[0]).not.toHaveProperty('build_batch_run')
  })

  it('ignores it on an order-raised build', async () => {
    await createBuild(db, ORG, USER, batchInput({ source: 'order', period: undefined }))
    expect(h.created[0]).not.toHaveProperty('build_batch_run')
  })

  it('writes nothing when the caller allocated no run', async () => {
    await createBuild(db, ORG, USER, batchInput({ batchRun: undefined }))
    expect(h.created[0]).not.toHaveProperty('build_batch_run')
    // The period is unaffected: the two are independent stamps.
    expect(h.created[0]).toHaveProperty('build_period_start')
  })

  // 🛑 An org short of entity migration 141 must still be able to backfill. It
  // gets un-numbered builds, which costs it undo and costs the netting read
  // nothing, and a 500 here would cost it the whole feature.
  it('raises the build anyway when the field is not provisioned', async () => {
    h.fields.delete('build_batch_run')

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isOk()).toBe(true)
    expect(h.created[0]).not.toHaveProperty('build_batch_run')
    expect(h.created[0]).toMatchObject({ build_source: 'batch' })
  })
})

// ─── §6.2: the demand period, unchanged by the above ───────────────────

describe('the demand period a batch build claims', () => {
  it('is skipped when the two fields are not provisioned', async () => {
    h.fields.delete('build_period_end')

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isOk()).toBe(true)
    expect(h.created[0]).not.toHaveProperty('build_period_start')
    expect(h.created[0]).not.toHaveProperty('build_period_end')
    // The run number is independent and still lands.
    expect(h.created[0]).toMatchObject({ build_batch_run: 7 })
  })

  it('refuses a period that ends before it starts, writing nothing', async () => {
    const result = await createBuild(
      db,
      ORG,
      USER,
      batchInput({
        period: {
          start: new Date('2026-02-01T00:00:00.000Z'),
          end: new Date('2026-01-01T00:00:00.000Z'),
        },
      })
    )

    expect(result.isErr()).toBe(true)
    expect(h.created).toHaveLength(0)
  })
})

// ─── The refusals that must keep working ────────────────────────────────

describe('a batch build is still a build', () => {
  it('refuses a purchased part', async () => {
    h.kinds = new Map([[PART, 'component']])

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.created).toHaveLength(0)
  })

  it('refuses a part with no bill of materials', async () => {
    h.subparts = []

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isErr()).toBe(true)
    expect(h.created).toHaveLength(0)
  })
})
