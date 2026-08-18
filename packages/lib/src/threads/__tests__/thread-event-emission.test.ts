// packages/lib/src/threads/__tests__/thread-event-emission.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInstanceGrants } from '../../permissions/visibility/context'

/**
 * Phase 5 emission contract (plans/threads/thread-events.md §12.4, §13.2,
 * §13.7):
 *
 * - `update()` emits lifecycle events UNCONDITIONALLY — the old
 *   `this.actorUserId` gate meant every automation status change (mail filter,
 *   provider sync, exclude-senders) silently skipped the event. No actor now
 *   means `actorId: null`, with automation provenance in `data.source`.
 * - `updateBulk()` emits the same lifecycle events per affected thread, using
 *   each thread's ACTUAL previous state — only ARCHIVED transitions map onto
 *   the archived/reopened vocabulary; other hops (e.g. OPEN→IGNORED) stay
 *   silent for now.
 * - `tagThreadsBulk()` is the single `thread:tagged`/`thread:untagged` emit
 *   site: one event per thread per direction with the full changed-tag list
 *   and a batched display-name snapshot.
 */

const { lensFixture, getThreadLensBatch } = vi.hoisted(() => {
  const lensFixture: { lenses: Record<string, string> } = { lenses: {} }
  return {
    lensFixture,
    getThreadLensBatch: vi.fn(async (_db: unknown, _o: string, _v: unknown, ids: string[]) => {
      const map = new Map<string, string>()
      for (const id of ids) map.set(id, lensFixture.lenses[id] ?? 'read')
      return map
    }),
  }
})

vi.mock('../../permissions/visibility/thread-lens', () => ({
  getThreadLensBatch,
  getThreadLens: vi.fn(),
}))

const { publisher, realtime, orgCache, tagFixture, batchGetThreadTagIds } = vi.hoisted(() => ({
  publisher: { publish: vi.fn(async () => undefined), publishLater: vi.fn(async () => undefined) },
  realtime: {
    publishThreadUpdated: vi.fn(async () => undefined),
    publishThreadDeleted: vi.fn(async () => undefined),
    getRealtimeService: vi.fn(() => ({})),
  },
  orgCache: {
    get: vi.fn(async () => []),
    from: vi.fn(() => ({ bySystemAttribute: async () => ({ id: 'fld_threadtags' }) })),
  },
  tagFixture: { reads: [] as Map<string, string[]>[] },
  batchGetThreadTagIds: vi.fn(async () => tagFixture.reads.shift() ?? new Map()),
}))

vi.mock('../../events/publisher', () => ({ publisher }))
vi.mock('../../realtime', () => realtime)
vi.mock('../../field-values/relationship-queries', () => ({ batchGetThreadTagIds }))
vi.mock('../../field-values', () => ({
  FieldValueService: class {
    setValueWithBuiltIn = vi.fn(async () => undefined)
    addRelationValuesBulk = vi.fn(async () => ({ inserted: 1, skipped: 0 }))
    removeRelationValuesBulk = vi.fn(async () => ({ removed: 1 }))
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
vi.mock('../../jobs/messages/thread-provider-status-sync-job', () => ({
  enqueueProviderSyncForEligibleThreads: vi.fn(async () => undefined),
}))
vi.mock('../../jobs/approvals/learned-extraction-job', () => ({
  enqueueLearnedExtraction: vi.fn(async () => undefined),
}))

const { ThreadMutationService } = await import('../thread-mutation.service')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const THREAD_A = 'thr_cuid0000000000000000000a'
const THREAD_B = 'thr_cuid0000000000000000000b'
const TAG_DEF = 'def_tag00000000000000000000a'
const TAG_SUPPORT_ID = 'tag_support00000000000000a'
const TAG_SUPPORT = `${TAG_DEF}:${TAG_SUPPORT_ID}`

/** Sequential `db.select(...)` results plus a shared `update(...).returning()` result. */
function makeDb(selectResults: unknown[][], updateResult: unknown[] = []) {
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
    userId: USER_ID,
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
  } as UserInstanceGrants
}

/** All publishLater calls of one event type. */
function published(type: string): Record<string, unknown>[] {
  return (publisher.publishLater.mock.calls as unknown[][])
    .map(([e]) => e as { type: string; data: Record<string, unknown> })
    .filter((e) => e.type === type)
    .map((e) => e.data)
}

beforeEach(() => {
  vi.clearAllMocks()
  lensFixture.lenses = {}
  tagFixture.reads = []
})

describe('update() — lifecycle events emit unconditionally (§12.4)', () => {
  function statusDb(prevStatus: string) {
    return makeDb(
      [
        [
          {
            inboxId: null,
            status: prevStatus,
            assigneeId: null,
            integrationId: null,
            metadata: {},
          },
        ],
        [], // read-status rows for the count deltas
      ],
      [{ id: THREAD_A, inboxId: null, assigneeId: null }]
    )
  }

  it('emits thread:archived with a null actor when no actor is set', async () => {
    const service = new ThreadMutationService(
      ORG_ID,
      statusDb('OPEN'),
      undefined,
      undefined,
      viewer()
    )
    await service.update(`thread:${THREAD_A}` as never, { status: 'ARCHIVED' })

    const [event] = published('thread:archived')
    expect(event).toMatchObject({ threadId: THREAD_A, organizationId: ORG_ID, actorId: null })
    expect(event).not.toHaveProperty('userId')
    expect(event).not.toHaveProperty('source')
  })

  it('carries mail_filter provenance in data.source with a null actorId', async () => {
    const service = new ThreadMutationService(
      ORG_ID,
      statusDb('ARCHIVED'),
      undefined,
      { kind: 'mail_filter', id: 'flt_1', runId: 'run_1', name: 'Auto-close' },
      viewer()
    )
    await service.update(`thread:${THREAD_A}` as never, { status: 'OPEN' })

    const [event] = published('thread:reopened')
    expect(event).toMatchObject({
      actorId: null,
      source: { kind: 'mail_filter', id: 'flt_1', runId: 'run_1', name: 'Auto-close' },
    })
    expect(event).not.toHaveProperty('userId')
  })

  it('keeps userId AND adds the branded actorId for a human actor', async () => {
    const service = new ThreadMutationService(
      ORG_ID,
      statusDb('OPEN'),
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.update(`thread:${THREAD_A}` as never, { status: 'ARCHIVED' })

    const [event] = published('thread:archived')
    expect(event).toMatchObject({ userId: USER_ID, actorId: `user:${USER_ID}` })
  })
})

describe('updateBulk() — per-thread lifecycle events (§13.2)', () => {
  it('emits archived only for threads that were not already ARCHIVED', async () => {
    const db = makeDb(
      [
        [
          { id: THREAD_A, inboxId: null, status: 'OPEN', assigneeId: null, integrationId: null },
          {
            id: THREAD_B,
            inboxId: null,
            status: 'ARCHIVED',
            assigneeId: null,
            integrationId: null,
          },
        ],
      ],
      [
        { id: THREAD_A, inboxId: null, assigneeId: null },
        { id: THREAD_B, inboxId: null, assigneeId: null },
      ]
    )
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.updateBulk([`thread:${THREAD_A}` as never, `thread:${THREAD_B}` as never], {
      status: 'ARCHIVED',
    })

    const events = published('thread:archived')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ threadId: THREAD_A, actorId: `user:${USER_ID}` })
  })

  it('maps a from-ARCHIVED transition onto thread:reopened, and other hops onto nothing', async () => {
    const db = makeDb(
      [
        [
          {
            id: THREAD_A,
            inboxId: null,
            status: 'ARCHIVED',
            assigneeId: null,
            integrationId: null,
          },
          { id: THREAD_B, inboxId: null, status: 'OPEN', assigneeId: null, integrationId: null },
        ],
      ],
      [
        { id: THREAD_A, inboxId: null, assigneeId: null },
        { id: THREAD_B, inboxId: null, assigneeId: null },
      ]
    )
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'system', name: 'exclude-senders' },
      viewer()
    )
    await service.updateBulk([`thread:${THREAD_A}` as never, `thread:${THREAD_B}` as never], {
      status: 'IGNORED',
    })

    // ARCHIVED→IGNORED is an un-archive = reopened; OPEN→IGNORED has no
    // vocabulary yet and stays silent (§13.2 "not decided" list).
    const reopened = published('thread:reopened')
    expect(reopened).toHaveLength(1)
    expect(reopened[0]).toMatchObject({
      threadId: THREAD_A,
      actorId: null,
      source: { kind: 'system', name: 'exclude-senders' },
    })
    expect(published('thread:archived')).toHaveLength(0)
  })

  it('emits assignee:changed per thread whose assignee actually moved', async () => {
    const db = makeDb(
      [
        [
          { id: THREAD_A, inboxId: null, status: 'OPEN', assigneeId: null, integrationId: null },
          { id: THREAD_B, inboxId: null, status: 'OPEN', assigneeId: USER_ID, integrationId: null },
        ],
      ],
      [
        { id: THREAD_A, inboxId: null, assigneeId: USER_ID },
        { id: THREAD_B, inboxId: null, assigneeId: USER_ID },
      ]
    )
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.updateBulk([`thread:${THREAD_A}` as never, `thread:${THREAD_B}` as never], {
      assigneeId: `user:${USER_ID}` as never,
    })

    const events = published('thread:assignee:changed')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      threadId: THREAD_A,
      fromUserId: null,
      toUserId: USER_ID,
      actorId: `user:${USER_ID}`,
    })
  })
})

describe('tagThreadsBulk() — thread:tagged / thread:untagged (§13.2)', () => {
  it('emits thread:tagged with the added ids and their display names', async () => {
    tagFixture.reads = [
      new Map([[THREAD_A, []]]), // before
      new Map([[THREAD_A, [TAG_SUPPORT]]]), // after
    ]
    const db = makeDb([
      [{ id: THREAD_A, inboxId: null, assigneeId: null }], // publishTagChanges row read
      [{ id: TAG_SUPPORT_ID, displayName: 'Support' }], // emitTagEvents name snapshot
    ])
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'classification' },
      viewer()
    )
    await service.tagThreadsBulk([`thread:${THREAD_A}` as never], [TAG_SUPPORT as never], 'add')

    const events = published('thread:tagged')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      threadId: THREAD_A,
      tagIds: [TAG_SUPPORT],
      tagNames: ['Support'],
      actorId: null,
      source: { kind: 'classification' },
    })
    expect(published('thread:untagged')).toHaveLength(0)
  })

  it('emits thread:untagged on removal, attributed to the acting user', async () => {
    tagFixture.reads = [
      new Map([[THREAD_A, [TAG_SUPPORT]]]), // before
      new Map([[THREAD_A, []]]), // after
    ]
    const db = makeDb([
      [{ id: THREAD_A, inboxId: null, assigneeId: null }],
      [{ id: TAG_SUPPORT_ID, displayName: 'Support' }],
    ])
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.tagThreadsBulk([`thread:${THREAD_A}` as never], [TAG_SUPPORT as never], 'remove')

    const events = published('thread:untagged')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      threadId: THREAD_A,
      tagIds: [TAG_SUPPORT],
      tagNames: ['Support'],
      actorId: `user:${USER_ID}`,
    })
  })

  it('emits nothing when the write was a no-op (tag already present)', async () => {
    tagFixture.reads = [
      new Map([[THREAD_A, [TAG_SUPPORT]]]), // before
      new Map([[THREAD_A, [TAG_SUPPORT]]]), // after — unchanged
    ]
    const db = makeDb([])
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.tagThreadsBulk([`thread:${THREAD_A}` as never], [TAG_SUPPORT as never], 'add')

    expect(published('thread:tagged')).toHaveLength(0)
    expect(published('thread:untagged')).toHaveLength(0)
  })

  it("allows an empty tag list for 'set' (clear-all) and emits the removals", async () => {
    tagFixture.reads = [
      new Map([[THREAD_A, [TAG_SUPPORT]]]), // before
      new Map([[THREAD_A, []]]), // after — cleared
    ]
    const db = makeDb([
      [{ id: THREAD_A, inboxId: null, assigneeId: null }],
      [{ id: TAG_SUPPORT_ID, displayName: 'Support' }],
    ])
    const service = new ThreadMutationService(
      ORG_ID,
      db,
      undefined,
      { kind: 'user', id: USER_ID },
      viewer()
    )
    await service.tagThreadsBulk([`thread:${THREAD_A}` as never], [], 'set')

    const events = published('thread:untagged')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ tagIds: [TAG_SUPPORT], tagNames: ['Support'] })
  })
})
