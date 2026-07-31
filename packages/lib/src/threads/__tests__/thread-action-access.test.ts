// packages/lib/src/threads/__tests__/thread-action-access.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInstanceGrants } from '../../permissions/visibility/context'
import { SYSTEM_VISIBILITY } from '../../permissions/visibility/context'
import type { Lens } from '../../permissions/visibility/lens'

/**
 * Plan 40 §5.5 / §12 — the extracted per-thread write gate, and the ordering
 * property that makes it un-escapable.
 *
 * `assertCanActOnThreads` used to be a private method on
 * `ThreadMutationService`. Plan 40 §5.5 needs the SAME predicate on the generic
 * field-value write path (`fieldValue.set` on a thread host), and the plan is
 * explicit that it must be SHARED rather than re-implemented — the
 * `workflow-run-stop-access.ts` precedent. This file pins both halves:
 *
 *  1. the extracted function's own behaviour, and
 *  2. that `ThreadMutationService` really delegates to it — every service case
 *     below goes red if the delegation is replaced by a local copy that answers
 *     differently, and the whole file goes red if the throw is removed.
 *
 * The lens itself (`getThreadLensBatch`) is question 4 and out of scope here; it
 * is stubbed so the cases can name a lens directly.
 */

const { lensFixture, getThreadLensBatch } = vi.hoisted(() => {
  const lensFixture: { lenses: Record<string, string> } = { lenses: {} }
  return {
    lensFixture,
    getThreadLensBatch: vi.fn(
      async (_db: unknown, _org: string, _viewer: unknown, ids: string[]) => {
        const map = new Map<string, string>()
        // Absent ids resolve to `none`, exactly as the real batch does for an id
        // that does not exist in this org (invisible ≍ nonexistent).
        for (const id of ids) map.set(id, lensFixture.lenses[id] ?? 'none')
        return map
      }
    ),
  }
})

vi.mock('../../permissions/visibility/thread-lens', () => ({
  getThreadLensBatch,
  getThreadLens: vi.fn(),
}))

// The mutation service's write-side collaborators. None of them may be reached
// by a denied call — that is the assertion in every denial case.
const { publisher, realtime, fieldValues, orgCache } = vi.hoisted(() => ({
  publisher: { publish: vi.fn(async () => undefined) },
  realtime: {
    publishThreadUpdated: vi.fn(async () => undefined),
    publishThreadDeleted: vi.fn(async () => undefined),
    getRealtimeService: vi.fn(() => ({})),
  },
  fieldValues: { setValueWithBuiltIn: vi.fn(async () => undefined) },
  orgCache: {
    get: vi.fn(async () => []),
    from: vi.fn(() => ({ bySystemAttribute: async () => null })),
  },
}))

vi.mock('../../events/publisher', () => ({ publisher }))
vi.mock('../../realtime', () => realtime)
vi.mock('../../field-values', () => ({
  FieldValueService: class {
    setValueWithBuiltIn = fieldValues.setValueWithBuiltIn
    addRelationValuesBulk = vi.fn(async () => ({ inserted: 0, skipped: 0 }))
    removeRelationValuesBulk = vi.fn(async () => ({ removed: 0 }))
  },
}))
vi.mock('../../cache', () => ({ getOrgCache: () => orgCache }))

const { assertCanActOnThreads } = await import('../thread-action-access')
const { ThreadMutationService } = await import('../thread-mutation.service')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const THREAD_A = 'thr_cuid00000000000000000a'
const THREAD_B = 'thr_cuid00000000000000000b'

/** A plain member viewer — no admin short-circuit, no grants of its own. */
function viewer(): UserInstanceGrants {
  return {
    userId: USER_ID,
    // `OrganizationRole` is OWNER | ADMIN | USER — 'USER' is the plain-member rank.
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    // Empty = fail-closed: no def is ticket-like, so nothing derives.
    defEntityTypes: {},
  }
}

/**
 * A db handle that RECORDS any write attempt. Nothing below is allowed to touch
 * it on a denied path — "it threw" is a weaker claim than "it threw before
 * composing a write".
 */
function recordingDb() {
  const writes: string[] = []
  const chain: any = new Proxy(
    {},
    {
      get: () => () => chain,
    }
  )
  return {
    writes,
    db: {
      update: (..._a: unknown[]) => {
        writes.push('update')
        return chain
      },
      insert: (..._a: unknown[]) => {
        writes.push('insert')
        return chain
      },
      delete: (..._a: unknown[]) => {
        writes.push('delete')
        return chain
      },
      select: () => chain,
      query: {},
      transaction: async (cb: (t: unknown) => Promise<unknown>) => {
        writes.push('transaction')
        return cb(chain)
      },
    } as never,
  }
}

beforeEach(() => {
  // `mockReset()`, not `mockClear()` — a `mockResolvedValueOnce` queue survives
  // `mockClear` and shifts every later value, which is how a mutated source line
  // looks caught when it is not.
  getThreadLensBatch.mockReset()
  getThreadLensBatch.mockImplementation(async (_db, _org, _viewer, ids: string[]) => {
    const map = new Map<string, Lens>()
    for (const id of ids) map.set(id, (lensFixture.lenses[id] ?? 'none') as Lens)
    return map
  })
  lensFixture.lenses = {}
  for (const fn of Object.values(realtime)) fn.mockClear()
  publisher.publish.mockClear()
  fieldValues.setValueWithBuiltIn.mockClear()
})

describe('assertCanActOnThreads — the extracted gate', () => {
  it('permits a thread at `full` lens', async () => {
    lensFixture.lenses = { [THREAD_A]: 'read' }
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, viewer(), [THREAD_A])
    ).resolves.toBeUndefined()
  })

  it.each([
    'metadata',
    'identity',
    'none',
  ])('refuses a thread at `%s` lens', async (lens: string) => {
    lensFixture.lenses = { [THREAD_A]: lens }
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, viewer(), [THREAD_A])
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
  })

  it('refuses an id that does not exist — indistinguishable from invisible', async () => {
    // No lens entry at all. A different answer here would turn the gate into an
    // existence oracle for other orgs' threads.
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, viewer(), ['thr_someoneelses'])
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
  })

  it('rejects a PARTIALLY visible batch outright — no silent partial apply', async () => {
    lensFixture.lenses = { [THREAD_A]: 'read', [THREAD_B]: 'metadata' }
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, viewer(), [THREAD_A, THREAD_B])
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
  })

  it('permits a fully visible batch', async () => {
    lensFixture.lenses = { [THREAD_A]: 'read', [THREAD_B]: 'read' }
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, viewer(), [THREAD_A, THREAD_B])
    ).resolves.toBeUndefined()
  })

  it('SYSTEM skips the lens read entirely — headless mail must keep working', async () => {
    await expect(
      assertCanActOnThreads({} as never, ORG_ID, SYSTEM_VISIBILITY, [THREAD_A])
    ).resolves.toBeUndefined()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })

  it('an empty id list is a no-op, not a query', async () => {
    await expect(assertCanActOnThreads({} as never, ORG_ID, viewer(), [])).resolves.toBeUndefined()
    expect(getThreadLensBatch).not.toHaveBeenCalled()
  })
})

describe('ThreadMutationService delegates to the shared gate', () => {
  const recordIdOf = (id: string) => `thread:${id}` as never

  it('update is refused at `metadata`, and composes NO write', async () => {
    lensFixture.lenses = { [THREAD_A]: 'metadata' }
    const { db, writes } = recordingDb()
    const service = new ThreadMutationService(ORG_ID, db, undefined, USER_ID, viewer())
    await expect(
      service.update(recordIdOf(THREAD_A), { status: 'ARCHIVED' })
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
    expect(writes).toEqual([])
    expect(getThreadLensBatch).toHaveBeenCalledTimes(1)
  })

  /**
   * **No self-escalation** (plan 40 §1.4 / §12, and the ordering §2 lists as
   * untouchable). Assignment confers `full` lens (`effective-lens.ts`), so a
   * viewer at `metadata` who could set `assigneeId` to themselves would hand
   * themselves the very lens the gate is checking for. The only thing standing
   * between those two facts is that `assertCanActOnThreads` runs FIRST — before
   * the payload is even inspected. Move it below the update composition and this
   * case goes green while the product is broken.
   */
  it('a member at `metadata` cannot self-assign — the gate precedes the payload', async () => {
    lensFixture.lenses = { [THREAD_A]: 'metadata' }
    const { db, writes } = recordingDb()
    const service = new ThreadMutationService(ORG_ID, db, undefined, USER_ID, viewer())
    await expect(
      service.update(recordIdOf(THREAD_A), { assigneeId: `user:${USER_ID}` as never })
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
    expect(writes).toEqual([])
    expect(realtime.publishThreadUpdated).not.toHaveBeenCalled()
  })

  it('bulk update rejects the whole set when ONE thread is sub-`full`', async () => {
    lensFixture.lenses = { [THREAD_A]: 'read', [THREAD_B]: 'identity' }
    const { db, writes } = recordingDb()
    const service = new ThreadMutationService(ORG_ID, db, undefined, USER_ID, viewer())
    await expect(
      service.updateBulk([recordIdOf(THREAD_A), recordIdOf(THREAD_B)], { status: 'ARCHIVED' })
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
    expect(writes).toEqual([])
  })

  it('tagThreadsBulk — the bulk toolbar’s path — takes the same gate', async () => {
    // The §5.5 pairing: this is the surface that WORKED while the Tags field
    // 403'd. Both now resolve to this one predicate.
    lensFixture.lenses = { [THREAD_A]: 'identity' }
    const { db } = recordingDb()
    const service = new ThreadMutationService(ORG_ID, db, undefined, USER_ID, viewer())
    await expect(
      service.tagThreadsBulk([recordIdOf(THREAD_A)], ['tag:t1' as never], 'add')
    ).rejects.toMatchObject({ name: 'ForbiddenError', statusCode: 403 })
  })

  it('the gate is the SHARED function — identical lens read, identical arguments', async () => {
    // Pins the delegation itself rather than only its verdict: the service must
    // hand the SAME (db, org, viewer, ids) tuple to the SAME lens batch the
    // exported helper does. A local re-implementation that drifted — a different
    // viewer, a per-inbox pre-filter, an `isAdmin` short-circuit — changes this
    // call shape even when the yes/no answer happens to agree.
    lensFixture.lenses = { [THREAD_A]: 'metadata' }
    const { db } = recordingDb()

    await expect(assertCanActOnThreads(db, ORG_ID, viewer(), [THREAD_A])).rejects.toMatchObject({
      name: 'ForbiddenError',
    })
    const direct = getThreadLensBatch.mock.calls.at(-1)

    const service = new ThreadMutationService(ORG_ID, db, undefined, USER_ID, viewer())
    await expect(
      service.update(recordIdOf(THREAD_A), { status: 'ARCHIVED' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    const viaService = getThreadLensBatch.mock.calls.at(-1)

    expect(viaService).toEqual(direct)
  })
})
