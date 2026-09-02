// packages/lib/src/resources/crud/__tests__/write-session.test.ts
//
// Phase 3 slice (a) of plans/events/03-write-context-and-batch-lane-plan.md:
// WriteSession core plumbing, behavior-preserving.
//
// - S1: session resolution at handler construction (explicit → ambient →
//   default interactive) and ALS inheritance across a hook-style re-entry
//   (a handler constructed INSIDE a wrapped write inherits the session).
// - sessionLane: interactive/api/automation → 'inline', sync/seed → 'silent'.
// - S3: the derived `publishEvents` at the mutation seam — the deprecated
//   `skipEvents: true` alias still suppresses, an interactive session still
//   publishes, and a silent-lane (seed) session suppresses without the alias.
//
// @auxx/database is globally mocked in src/test/setup.ts; the mutation-seam
// tests mock the same seams `archive-duplicate-pair-cleanup.test.ts` does
// (spread-preserving where the module has more exports).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: h.deleteOpenPairsForRecord,
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: h.enqueueDuplicateScan,
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))

import type { ManifestCollector } from '../../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../unified-handler'
import { archiveEntity, type MutationContext } from '../unified-handler-mutations'
import { interactiveSession, seedSession, sessionLane, type WriteSession } from '../write-origin'
import { getAmbientWriteSession, runWithWriteSession } from '../write-session-als'

/** The session a handler resolved, read through its (public) field-value ctx. */
function sessionOf(handler: UnifiedCrudHandler): WriteSession | undefined {
  return handler.fieldValueService.ctx.session
}

beforeEach(() => vi.clearAllMocks())

describe('S1 — session resolution at handler construction', () => {
  it('defaults to an interactive session built from the constructor userId + socketId', () => {
    const handler = new UnifiedCrudHandler('org_1', 'user_1', {} as never, 'sock_1')
    expect(sessionOf(handler)).toEqual({
      origin: { kind: 'interactive', userId: 'user_1', socketId: 'sock_1' },
      depth: 0,
    })
  })

  it('an explicit session option wins over the ambient one', () => {
    const explicit = seedSession('explicit-wins')
    const handler = runWithWriteSession(
      seedSession('ambient-loses'),
      () => new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, { session: explicit })
    )
    expect(sessionOf(handler)).toBe(explicit)
  })

  it('a handler constructed inside runWithWriteSession inherits the ambient session', () => {
    const ambient = seedSession('x')
    const handler = runWithWriteSession(
      ambient,
      () => new UnifiedCrudHandler('org_1', 'user_1', {} as never)
    )
    expect(sessionOf(handler)).toBe(ambient)
  })

  it('hook re-entry: a handler constructed DURING a wrapped write inherits the outer session', async () => {
    const outerSession = seedSession('outer')
    const outer = new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, {
      session: outerSession,
    })

    let ambientDuringWrite: WriteSession | undefined
    let innerSession: WriteSession | undefined
    // findByField runs inside findOrCreate's session wrap — the same position
    // a field hook is in when it constructs its own handler mid-write.
    vi.spyOn(outer, 'findByField').mockImplementation(async () => {
      ambientDuringWrite = getAmbientWriteSession()
      const inner = new UnifiedCrudHandler('org_1', 'system_user', {} as never)
      innerSession = sessionOf(inner)
      return { id: 'existing' } as never
    })

    await outer.findOrCreate('contact', { primary_email: 'a@b.co' })

    expect(ambientDuringWrite).toBe(outerSession)
    expect(innerSession).toBe(outerSession)
  })
})

describe('sessionLane', () => {
  const collector = {} as ManifestCollector

  it('interactive, api and automation take the inline lane', () => {
    expect(sessionLane(interactiveSession('user_1'))).toBe('inline')
    expect(sessionLane({ origin: { kind: 'api', userId: 'user_1' }, depth: 0 })).toBe('inline')
    expect(
      sessionLane({
        origin: { kind: 'automation', actor: 'system_user', cause: { type: 'rule', id: 'r1' } },
        depth: 0,
      })
    ).toBe('inline')
  })

  it('sync and seed take the silent lane (matches skipEvents semantics until Phase 4)', () => {
    expect(
      sessionLane({
        origin: { kind: 'sync', source: 'connector', ref: 'run_1', collector },
        depth: 0,
      })
    ).toBe('silent')
    expect(sessionLane(seedSession('reshape'))).toBe('silent')
  })
})

describe('S3 — derived publishEvents at the mutation seam', () => {
  function ctx(session: WriteSession): MutationContext {
    return {
      db: {} as never,
      organizationId: 'org_1',
      userId: 'user_1',
      session,
      fieldValueService: {} as never,
      resolveEntityDefinition: async () => ({
        id: 'def_1',
        entityType: 'contact',
        apiSlug: 'contacts',
      }),
      getFields: async () => [],
      runPreHooks: async (_o, _d, values) => values,
      validateUniqueFields: async () => {},
      setFieldValues: async () => ({ failures: [], changed: true, changes: [], instance: null }),
    }
  }

  it('an interactive session publishes the archive fan-out', async () => {
    await archiveEntity(ctx(interactiveSession('user_1')), 'def_1:inst_1' as never)
    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('the deprecated skipEvents: true alias still suppresses, even on an interactive session', async () => {
    await archiveEntity(ctx(interactiveSession('user_1')), 'def_1:inst_1' as never, {
      skipEvents: true,
    })
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('a silent-lane (seed) session suppresses without the alias', async () => {
    await archiveEntity(ctx(seedSession('reshape')), 'def_1:inst_1' as never)
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
    // Data hygiene stays outside the event gate.
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledTimes(1)
  })
})
