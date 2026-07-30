// apps/web/src/server/api/routers/segment-instance-access.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { schema } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 24 §A.2.1 / §A.4 — the one genuine **privilege hole** this plan closed:
 * `segment.ts` used to be all `protectedProcedure` with no capability asserts, so
 * a datasets-`view` (or datasets-None) member who knew segment ids could read and
 * rewrite dataset content end-to-end. PR #1338 switched every procedure to
 * `capabilityProcedure` + `assertEditInstance` / `assertViewInstance` on the
 * segment's grandparent dataset.
 *
 * These are behavioral tests, not restatements: the router module is imported for
 * real and driven through a tRPC caller, and `ctx.capabilities` is a **real**
 * {@link CapabilitySet} (the assert methods are the shipped ones). Deleting an
 * assert from any procedure makes the matching "denies …" case fail, because the
 * mocked `SegmentService` would then be reached.
 *
 * Mocked, and why:
 *  - `~/server/api/trpc` — the real module pulls auth/db/redis/rate-limiter at
 *    import time. The stand-in is a plain tRPC instance whose `capabilityProcedure`
 *    passes the test ctx through untouched. A downgrade back to
 *    `protectedProcedure` is caught by the structural block at the bottom (and by
 *    the mock not exporting one at all).
 *  - `@auxx/lib/datasets` — `SegmentService` is the side effect under observation:
 *    "was the write reached?" is the whole assertion.
 */

const { segmentService } = vi.hoisted(() => ({
  segmentService: {
    updateContent: vi.fn(async () => ({ id: 'seg_1' })),
    toggleEnabled: vi.fn(async () => ({ id: 'seg_1' })),
    delete: vi.fn(async () => undefined),
    batchOperation: vi.fn(async () => ({ updated: 1 })),
    getById: vi.fn(async () => ({ id: 'seg_1' })),
    listByDocument: vi.fn(async () => ({ segments: [], totalCount: 0, hasMore: false, page: 1 })),
    reindex: vi.fn(async () => undefined),
  },
}))

vi.mock('@auxx/lib/datasets', () => ({
  SegmentService: class {
    updateContent = segmentService.updateContent
    toggleEnabled = segmentService.toggleEnabled
    delete = segmentService.delete
    batchOperation = segmentService.batchOperation
    getById = segmentService.getById
    listByDocument = segmentService.listByDocument
    reindex = segmentService.reindex
  },
}))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, capabilityProcedure: t.procedure }
})

// Deep path on purpose: `@auxx/lib/permissions`' barrel reaches redis/db at import
// time (get-capabilities, record-view-scope, overage-*) and hangs under vitest,
// and `CapabilitySet` is not on the client-safe subpath. Test files are excluded
// from apps/web's tsconfig, so this stays a test-only affordance.
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { segmentRouter } = await import('./segment')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const DATASET_ID = 'dset_cuid00000000000000000000'
const OTHER_DATASET_ID = 'dset_othercuid000000000000000'
const SEGMENT_ID = 'seg_cuid0000000000000000000'
const DOCUMENT_ID = 'doc_cuid0000000000000000000'

/**
 * A real `CapabilitySet` for a MEMBER holding `permission` on {@link DATASET_ID}
 * (an explicit `ResourceAccess` instance row, which is what the share dialog
 * writes). `undefined` = the datasets area is closed for them entirely.
 */
function capabilitiesFor(
  permission: ResourcePermission | undefined,
  overrides: { role?: 'MEMBER' | 'OWNER'; instances?: Record<string, ResourcePermission> } = {}
) {
  const areaLevel =
    permission === undefined || permission === 'none'
      ? Level.None
      : permission === 'read'
        ? Level.Read
        : permission === 'edit'
          ? Level.Edit
          : Level.Full
  const instances =
    overrides.instances ?? (permission === undefined ? {} : { [DATASET_ID]: permission })
  return new CapabilitySet(
    // The area gate has to be open for an instance row to be consulted at all
    // (`effectiveInstanceLevel` short-circuits at area None) — mirror the level.
    new Set(expandLevelsToKeys({ [Area.datasets]: overrides.instances ? Level.Read : areaLevel })),
    {},
    overrides.role ?? 'MEMBER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances))
  )
}

/**
 * Query-builder stand-in that answers by the table the router selected FROM, so
 * the tests also pin *which* parent the gate resolves through: segments join
 * `DocumentSegment` → `Document`, `listByDocument` reads `Document` directly.
 */
function fakeDb(rows: { segments?: { datasetId: string }[]; documents?: { datasetId: string }[] }) {
  const build = () => {
    let table: unknown
    const resolve = () =>
      table === schema.Document ? (rows.documents ?? []) : (rows.segments ?? [])
    // `.where(...)` is both awaitable (selectDistinct) and chainable into
    // `.limit(1)` (single-row lookups), so it returns a real promise carrying an
    // extra method rather than a hand-rolled thenable.
    const where = () => {
      const pending = Promise.resolve(resolve()) as Promise<{ datasetId: string }[]> & {
        limit: () => Promise<{ datasetId: string }[]>
      }
      pending.limit = () => Promise.resolve(resolve())
      return pending
    }
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t
        return chain
      },
      innerJoin: () => chain,
      where,
    }
    return chain
  }
  return { select: build, selectDistinct: build }
}

function caller(
  capabilities: InstanceType<typeof CapabilitySet>,
  db = fakeDb({ segments: [{ datasetId: DATASET_ID }], documents: [{ datasetId: DATASET_ID }] })
) {
  return segmentRouter.createCaller({
    db,
    capabilities,
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
    },
  } as any)
}

/**
 * The capability asserts throw `AuxxError` (never `TRPCError`) — tRPC wraps that
 * as `cause`, and in the app `auxxErrorMiddleware` + `errorFormatter` map it onto
 * the HTTP status asserted here.
 */
const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const NOT_FOUND = { cause: { name: 'NotFoundError', statusCode: 404 } }

/** Every mutating procedure, with the minimum valid input. */
const MUTATIONS = [
  [
    'updateContent',
    (c: ReturnType<typeof caller>) =>
      c.updateContent({ segmentId: SEGMENT_ID, content: 'rewritten' }),
    'updateContent',
  ],
  [
    'toggleEnabled',
    (c: ReturnType<typeof caller>) => c.toggleEnabled({ segmentId: SEGMENT_ID, enabled: false }),
    'toggleEnabled',
  ],
  ['delete', (c: ReturnType<typeof caller>) => c.delete({ segmentId: SEGMENT_ID }), 'delete'],
  [
    'batchUpdate',
    (c: ReturnType<typeof caller>) =>
      c.batchUpdate({ segmentIds: [SEGMENT_ID], operation: 'delete' }),
    'batchOperation',
  ],
  ['reindex', (c: ReturnType<typeof caller>) => c.reindex({ segmentId: SEGMENT_ID }), 'reindex'],
] as const

/** Every read procedure, with the minimum valid input. */
const READS = [
  ['getById', (c: ReturnType<typeof caller>) => c.getById({ segmentId: SEGMENT_ID }), 'getById'],
  [
    'listByDocument',
    (c: ReturnType<typeof caller>) => c.listByDocument({ documentId: DOCUMENT_ID }),
    'listByDocument',
  ],
] as const

beforeEach(() => {
  for (const fn of Object.values(segmentService)) fn.mockClear()
})

describe('segment router — instance `view` cannot mutate (plan 24 §A.4, "the actual hole")', () => {
  it.each(MUTATIONS)('%s is refused for a view-only member', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('read')))).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService[serviceFn]).not.toHaveBeenCalled()
  })

  it.each(MUTATIONS)('%s succeeds at instance edit', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('edit')))).resolves.toBeDefined()
    expect(segmentService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it.each(MUTATIONS)('%s is refused with no instance access at all', async (_n, call, fn) => {
    await expect(call(caller(capabilitiesFor(undefined)))).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService[fn]).not.toHaveBeenCalled()
  })

  it.each(
    MUTATIONS
  )('%s is refused for an explicit `none` restriction row', async (_n, call, fn) => {
    await expect(
      call(caller(capabilitiesFor(undefined, { instances: { [DATASET_ID]: 'none' } })))
    ).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService[fn]).not.toHaveBeenCalled()
  })
})

describe('segment router — reads are open at instance `view`', () => {
  it.each(READS)('%s succeeds at instance view', async (_name, call, serviceFn) => {
    await expect(call(caller(capabilitiesFor('read')))).resolves.toBeDefined()
    expect(segmentService[serviceFn]).toHaveBeenCalledTimes(1)
  })

  it.each(READS)('%s is refused with no instance access at all', async (_n, call, fn) => {
    await expect(call(caller(capabilitiesFor(undefined)))).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService[fn]).not.toHaveBeenCalled()
  })

  it.each(READS)('%s is refused for an explicit `none` restriction row', async (_n, call, fn) => {
    await expect(
      call(caller(capabilitiesFor(undefined, { instances: { [DATASET_ID]: 'none' } })))
    ).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService[fn]).not.toHaveBeenCalled()
  })
})

describe('segment router — how the dataset is resolved', () => {
  it('batchUpdate requires edit on EVERY distinct dataset in the batch', async () => {
    const db = fakeDb({
      segments: [{ datasetId: DATASET_ID }, { datasetId: OTHER_DATASET_ID }],
    })
    const capabilities = capabilitiesFor(undefined, {
      // Edit on the first dataset, read-only on the second: a per-batch loop that
      // only checked the first id would let the second dataset's segments be
      // deleted by a viewer.
      instances: {
        [DATASET_ID]: 'edit',
        [OTHER_DATASET_ID]: 'read',
      },
    })

    await expect(
      caller(capabilities, db).batchUpdate({
        segmentIds: [SEGMENT_ID, 'seg_from_other_dataset'],
        operation: 'delete',
      })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService.batchOperation).not.toHaveBeenCalled()
  })

  it('listByDocument gates on the DOCUMENT’s dataset, not the segment join', async () => {
    // The document lives in a dataset restricted away from the caller; the
    // segment join would answer with one they administer. Only the document
    // lookup may decide.
    const db = fakeDb({
      segments: [{ datasetId: DATASET_ID }],
      documents: [{ datasetId: OTHER_DATASET_ID }],
    })
    const capabilities = capabilitiesFor(undefined, {
      instances: {
        [DATASET_ID]: 'admin',
        [OTHER_DATASET_ID]: 'none',
      },
    })

    await expect(
      caller(capabilities, db).listByDocument({ documentId: DOCUMENT_ID })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(segmentService.listByDocument).not.toHaveBeenCalled()
  })

  it('an unknown segment 404s before any capability decision leaks its existence', async () => {
    const db = fakeDb({ segments: [], documents: [] })
    await expect(
      caller(capabilitiesFor('admin'), db).updateContent({
        segmentId: 'seg_missing',
        content: 'x',
      })
    ).rejects.toMatchObject(NOT_FOUND)
    expect(segmentService.updateContent).not.toHaveBeenCalled()
  })

  it('OWNER short-circuits to admin even with no instance row (§A.4 regression)', async () => {
    const owner = capabilitiesFor(undefined, { role: 'OWNER' })
    await expect(
      caller(owner).updateContent({ segmentId: SEGMENT_ID, content: 'x' })
    ).resolves.toBeDefined()
    expect(segmentService.updateContent).toHaveBeenCalledTimes(1)
  })
})

/**
 * The behavioral block above runs against a stubbed `~/server/api/trpc`, so it
 * cannot see a downgrade of the procedure builder itself. Pin that in source —
 * same idiom as `resource-access-plan-gate.test.ts`.
 */
describe('segment router — structural invariants', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/server/api/routers/segment.ts'),
    'utf8'
  )

  const PROCEDURES = [
    'updateContent',
    'toggleEnabled',
    'delete',
    'batchUpdate',
    'getById',
    'listByDocument',
    'reindex',
  ]

  it('every procedure is a capabilityProcedure — no bare protectedProcedure', () => {
    for (const name of PROCEDURES) {
      expect(src, `${name} must build on capabilityProcedure`).toContain(
        `${name}: capabilityProcedure`
      )
    }
    expect(src).not.toContain('protectedProcedure')
    expect(src).not.toContain('publicProcedure')
  })

  it('the procedure list is exhaustive — a new procedure must be gated too', () => {
    const declared = [...src.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): capabilityProcedure/gm)].map(
      (m) => m[1]
    )
    expect(declared.sort()).toEqual([...PROCEDURES].sort())
  })

  it('every procedure body carries an instance assert', () => {
    const asserts = src.match(/ctx\.capabilities\.assert(View|Edit)Instance\('dataset',/g) ?? []
    expect(asserts).toHaveLength(PROCEDURES.length)
  })
})
