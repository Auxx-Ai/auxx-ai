// packages/lib/src/inventory/builds/__tests__/build-mutations.test.ts
//
// What `createBuild` stamps on a batch build, and what it refuses to stamp: the demand period and
// the run number are written at insert or never, and only on the sources that own them.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import type { NewBuild } from '../build-writes'
import type { CreateBuildInput } from '../types'
import { buildRecord } from './support/build-record'

const ORG = 'org_1'
const USER = 'user_1'
const PART = 'part_lift'

const h = vi.hoisted(() => ({
  /** partId -> stored `part_kind`. */
  kinds: new Map<string, string>(),
  /** Direct subparts of the part being built. Empty models no bill of materials. */
  subparts: [] as { childId: string; qty: number }[],
  /** Every `insertBuild`, as the row it was handed. */
  created: [] as NewBuild[],
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async () => 'def_part'),
}))

vi.mock('../../bom/subpart-graph', () => ({
  loadDirectSubparts: vi.fn(async () => h.subparts),
}))

vi.mock('../build-writes', () => ({
  insertBuild: vi.fn(async (_db: unknown, _org: string, _user: string, build: NewBuild) => {
    h.created.push(build)
    return buildRecord(build as never)
  }),
}))

vi.mock('../build-realtime', () => ({ publishBuildsChanged: vi.fn(async () => {}) }))

vi.mock('../build-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../build-queries')>()
  return { ...actual, readPartKinds: vi.fn(async () => h.kinds) }
})

import { createBuild } from '../build-mutations'

/** The one existence probe `assertPartsExist` makes. */
const db = {
  select: () => ({ from: () => ({ where: async () => [{ id: PART }] }) }),
} as never

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
  h.kinds = new Map([[PART, 'subassembly']])
  h.subparts = [{ childId: 'part_motor', qty: 2 }]
  h.created = []
})

// ─── §3: the run number a batch build carries ──────────────────────────

describe('the run number is written here or never', () => {
  it('stamps the run number the caller allocated, and the period', async () => {
    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isOk()).toBe(true)
    expect(h.created[0]).toMatchObject({
      source: 'batch',
      batchRun: 7,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    })
  })

  // A stray number on a build no run owns would put it inside `undoBatchRun`'s blast radius.
  it('ignores it on a hand-raised build', async () => {
    await createBuild(db, ORG, USER, batchInput({ source: 'manual', period: undefined }))
    expect(h.created[0]).not.toHaveProperty('batchRun')
  })

  it('ignores it on an order-raised build', async () => {
    await createBuild(db, ORG, USER, batchInput({ source: 'order', period: undefined }))
    expect(h.created[0]).not.toHaveProperty('batchRun')
  })

  it('stamps it on a backflush build, which claims no period', async () => {
    await createBuild(db, ORG, USER, batchInput({ source: 'backflush' }))
    expect(h.created[0]).toMatchObject({ batchRun: 7 })
    expect(h.created[0]).not.toHaveProperty('periodStart')
  })

  it('writes nothing when the caller allocated no run', async () => {
    await createBuild(db, ORG, USER, batchInput({ batchRun: undefined }))
    expect(h.created[0]).not.toHaveProperty('batchRun')
    expect(h.created[0]).toHaveProperty('periodStart')
  })
})

describe('the demand period a batch build claims', () => {
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

  it('refuses a service with BadRequest (107-D10)', async () => {
    h.kinds = new Map([[PART, 'service']])

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.created).toHaveLength(0)
  })

  it('refuses a part with no bill of materials', async () => {
    h.subparts = []

    const result = await createBuild(db, ORG, USER, batchInput())

    expect(result.isErr()).toBe(true)
    expect(h.created).toHaveLength(0)
  })
})
