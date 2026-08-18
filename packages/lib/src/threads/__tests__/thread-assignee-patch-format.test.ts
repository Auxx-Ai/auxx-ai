// packages/lib/src/threads/__tests__/thread-assignee-patch-format.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInstanceGrants } from '../../permissions/visibility/context'

/**
 * Plan 44 §3.4 — the realtime assign patch must carry an `ActorId`.
 *
 * The fetch path (`thread-query.service.ts`) returns
 * `toActorId('user', assigneeId)`, and `ThreadMeta.assigneeId` is typed
 * `ActorId | null` all the way into the store. The realtime publisher shipped
 * `dbUpdates.assigneeId` — the BARE column value — so after a realtime assign
 * the store held a bare id under an `ActorId` field until the next refetch.
 * `parseActorId` is strict and throws, so creating a ticket from that thread
 * failed with `Invalid ActorId: <bare-id>`, and every assignee chip rendered
 * nothing. The sibling `inboxId` line two rows below was already def-resolved;
 * assignee was simply missed.
 *
 * One format on the wire — fixed at the publisher, not by teaching the store to
 * accept both. `update` and `updateBulk` each have their own copy of the line,
 * so both are pinned here.
 */

const { lensFixture, getThreadLensBatch } = vi.hoisted(() => {
  const lensFixture: { lenses: Record<string, string> } = { lenses: {} }
  return {
    lensFixture,
    getThreadLensBatch: vi.fn(async (_db: unknown, _o: string, _v: unknown, ids: string[]) => {
      const map = new Map<string, string>()
      for (const id of ids) map.set(id, lensFixture.lenses[id] ?? 'none')
      return map
    }),
  }
})

vi.mock('../../permissions/visibility/thread-lens', () => ({
  getThreadLensBatch,
  getThreadLens: vi.fn(),
}))

const { publisher, realtime, orgCache } = vi.hoisted(() => ({
  publisher: { publish: vi.fn(async () => undefined), publishLater: vi.fn(async () => undefined) },
  realtime: {
    publishThreadUpdated: vi.fn(async () => undefined),
    publishThreadDeleted: vi.fn(async () => undefined),
    getRealtimeService: vi.fn(() => ({})),
  },
  orgCache: {
    get: vi.fn(async () => []),
    from: vi.fn(() => ({ bySystemAttribute: async () => null })),
  },
}))

vi.mock('../../events/publisher', () => ({ publisher }))
vi.mock('../../realtime', () => realtime)
vi.mock('../../field-values', () => ({
  FieldValueService: class {
    setValueWithBuiltIn = vi.fn(async () => undefined)
    addRelationValuesBulk = vi.fn(async () => ({ inserted: 0, skipped: 0 }))
    removeRelationValuesBulk = vi.fn(async () => ({ removed: 0 }))
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => orgCache,
  getCachedResources: vi.fn(async () => []),
  getCachedMembers: vi.fn(async () => []),
}))
vi.mock('../mail-counts', () => ({
  applyMailCountDeltas: vi.fn(async () => undefined),
  markMailCountsStale: vi.fn(async () => undefined),
  markMailCountsStaleForOrgMembers: vi.fn(async () => undefined),
}))

const { ThreadMutationService } = await import('../thread-mutation.service')

const ORG_ID = 'org_cuid000000000000000000000'
const ACTOR_ID = 'usr_cuid000000000000000000000'
const THREAD_ID = 'thr_cuid00000000000000000a'
const OLD_ASSIGNEE = 'usr_previousassignee0000000'
const NEW_ASSIGNEE = 'usr_newassignee00000000000a'

/** The row shape each `db.select(...)` in the update path resolves to, in order. */
function makeDb(selectResults: unknown[][], updateResult: unknown[]) {
  let call = 0
  const selectChain = (result: unknown[]) => {
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(result),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, err),
    })
    return chain
  }
  const updateChain: Record<string, unknown> = {}
  Object.assign(updateChain, {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve(updateResult),
  })
  return {
    select: () => selectChain(selectResults[call++] ?? []),
    update: () => updateChain,
  } as never
}

function viewer(): UserInstanceGrants {
  return {
    userId: ACTOR_ID,
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

/** The `patch` the service handed to `publishThreadUpdated`. */
function publishedPatch(): Record<string, unknown> {
  const args = realtime.publishThreadUpdated.mock.calls.at(-1) as unknown as unknown[]
  return (args[2] as { patch: Record<string, unknown> }).patch
}

beforeEach(() => {
  lensFixture.lenses = { [THREAD_ID]: 'read' }
  getThreadLensBatch.mockClear()
  for (const fn of Object.values(realtime)) fn.mockClear()
  publisher.publishLater.mockClear()
})

describe('ThreadMutationService.update — assignee patch format', () => {
  function service() {
    const db = makeDb(
      [
        [{ inboxId: null, status: 'OPEN', assigneeId: OLD_ASSIGNEE, integrationId: null }],
        [], // read-status rows for the count deltas
      ],
      [{ id: THREAD_ID, inboxId: null, assigneeId: NEW_ASSIGNEE }]
    )
    return new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: ACTOR_ID },
      viewer()
    )
  }

  it('publishes an ActorId, not the bare column value', async () => {
    await service().update(`thread:${THREAD_ID}` as never, {
      assigneeId: `user:${NEW_ASSIGNEE}` as never,
    })

    expect(publishedPatch().assigneeId).toBe(`user:${NEW_ASSIGNEE}`)
    expect(publishedPatch().assigneeId).not.toBe(NEW_ASSIGNEE)
  })

  it('publishes null when the thread is unassigned', async () => {
    const db = makeDb(
      [[{ inboxId: null, status: 'OPEN', assigneeId: OLD_ASSIGNEE, integrationId: null }], []],
      [{ id: THREAD_ID, inboxId: null, assigneeId: null }]
    )
    await new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: ACTOR_ID },
      viewer()
    ).update(`thread:${THREAD_ID}` as never, { assigneeId: null })

    expect(publishedPatch().assigneeId).toBeNull()
  })

  /**
   * The envelope's own `assigneeId` is a ROOM KEY, not store data — the
   * per-user full-payload fanout targets `user:<id>` rooms by bare id
   * (`publish-helpers.ts`). Prefixing it would silently misroute the fanout.
   */
  it('leaves the envelope assigneeId bare', async () => {
    await service().update(`thread:${THREAD_ID}` as never, {
      assigneeId: `user:${NEW_ASSIGNEE}` as never,
    })

    const args = realtime.publishThreadUpdated.mock.calls.at(-1) as unknown as unknown[]
    expect((args[2] as { assigneeId: string }).assigneeId).toBe(NEW_ASSIGNEE)
  })
})

describe('ThreadMutationService.updateBulk — assignee patch format', () => {
  it('publishes an ActorId for every thread in the batch', async () => {
    const db = makeDb(
      [
        [{ id: THREAD_ID, inboxId: null, status: 'OPEN', integrationId: null }],
        [], // read-status rows
      ],
      [{ id: THREAD_ID, inboxId: null, assigneeId: NEW_ASSIGNEE }]
    )
    await new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: ACTOR_ID },
      viewer()
    ).updateBulk([`thread:${THREAD_ID}` as never], { assigneeId: `user:${NEW_ASSIGNEE}` as never })

    expect(publishedPatch().assigneeId).toBe(`user:${NEW_ASSIGNEE}`)
  })
})
