// packages/lib/src/threads/__tests__/thread-triage-update.test.ts
// Manual triage edits (plans/ai/decision/08-triage-indicators.md §7) are written and
// published by both `update` and `updateBulk`; harness copied from the assignee test.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInstanceGrants } from '../../permissions/visibility/context'

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
    set: (values: Record<string, unknown>) => {
      lastSet = values
      return updateChain
    },
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

let lastSet: Record<string, unknown> = {}

function service(selectResults: unknown[][]) {
  const db = makeDb(selectResults, [{ id: THREAD_ID, inboxId: null, assigneeId: null }])
  return new ThreadMutationService(ORG_ID, db, undefined, { kind: 'user', id: ACTOR_ID }, viewer())
}

beforeEach(() => {
  lensFixture.lenses = { [THREAD_ID]: 'read' }
  lastSet = {}
  for (const fn of Object.values(realtime)) fn.mockClear()
})

describe('ThreadMutationService — manual triage', () => {
  it('update writes and publishes the three fields', async () => {
    await service([
      [{ inboxId: null, status: 'OPEN', assigneeId: null, integrationId: null }],
      [],
    ]).update(`thread:${THREAD_ID}` as never, {
      priority: 'HIGH',
      needsReply: false,
      sentiment: 'POSITIVE',
    })

    expect(lastSet).toMatchObject({ priority: 'HIGH', needsReply: false, sentiment: 'POSITIVE' })
    expect(publishedPatch()).toMatchObject({
      priority: 'HIGH',
      needsReply: false,
      sentiment: 'POSITIVE',
    })
  })

  it('update clears with null', async () => {
    await service([
      [{ inboxId: null, status: 'OPEN', assigneeId: null, integrationId: null }],
      [],
    ]).update(`thread:${THREAD_ID}` as never, { priority: null })

    expect(lastSet).toMatchObject({ priority: null })
    expect(publishedPatch()).toEqual({ priority: null })
  })

  it('updateBulk writes and publishes priority', async () => {
    await service([
      [{ id: THREAD_ID, inboxId: null, status: 'OPEN', integrationId: null }],
      [],
    ]).updateBulk([`thread:${THREAD_ID}` as never], { priority: 'URGENT' })

    expect(lastSet).toMatchObject({ priority: 'URGENT' })
    expect(publishedPatch()).toEqual({ priority: 'URGENT' })
  })
})
