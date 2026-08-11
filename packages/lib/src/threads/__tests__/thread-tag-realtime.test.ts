// packages/lib/src/threads/__tests__/thread-tag-realtime.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_VISIBILITY } from '../../permissions/visibility/context'

/**
 * Thread tags must publish the MAIL `thread:updated` event, not only the
 * field-value layer's `fieldValues:updated`.
 *
 * `tagThreadsBulk` delegates to `FieldValueService`, whose publish targets
 * `rooms.orgRecords(org, threadDefId)` — the per-def RECORDS channel that only
 * the Records grid joins. The mail UI subscribes to per-inbox lens channels and
 * has no `fieldValues:updated` handler, so every tag write was invisible there
 * until a reload: the classifier, the `add-tag` filter action, the workflow
 * CRUD node, Kopilot's `update-thread`, and the bulk toolbar — whose local
 * optimistic write hid it from the clicker but not from anyone else.
 *
 * Pinned here because the fix lives at the single shared write path, so one
 * regression would silently take all five callers down again.
 */

/**
 * Queued `batchGetThreadTagIds` results — the write path reads the tag set
 * twice (before, then after). An `Error` entry makes that read throw.
 */
const { tagFixture, batchGetThreadTagIds } = vi.hoisted(() => {
  const tagFixture: { reads: (Map<string, string[]> | Error)[] } = { reads: [] }
  return {
    tagFixture,
    batchGetThreadTagIds: vi.fn(async () => {
      const next = tagFixture.reads.shift()
      if (next instanceof Error) throw next
      return next ?? new Map()
    }),
  }
})

vi.mock('../../field-values/relationship-queries', () => ({ batchGetThreadTagIds }))

const { realtime, orgCache, addRelationValuesBulk } = vi.hoisted(() => ({
  realtime: {
    publishThreadUpdated: vi.fn(async () => undefined),
    publishThreadDeleted: vi.fn(async () => undefined),
    getRealtimeService: vi.fn(() => ({})),
  },
  orgCache: {
    get: vi.fn(async () => []),
    from: vi.fn(() => ({ bySystemAttribute: async () => ({ id: 'fld_threadtags' }) })),
  },
  addRelationValuesBulk: vi.fn(async () => ({ inserted: 1, skipped: 0 })),
}))

vi.mock('../../realtime', () => realtime)
vi.mock('../../events/publisher', () => ({
  publisher: { publish: vi.fn(async () => undefined), publishLater: vi.fn(async () => undefined) },
}))
vi.mock('../../field-values', () => ({
  FieldValueService: class {
    addRelationValuesBulk = addRelationValuesBulk
    removeRelationValuesBulk = vi.fn(async () => ({ removed: 0 }))
    setValueWithBuiltIn = vi.fn(async () => undefined)
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
const { markMailCountsStaleForOrgMembers } = await import('../mail-counts')

const ORG_ID = 'org_cuid000000000000000000000'
const THREAD_DEF = 'def_thread0000000000000000a'
const TAG_DEF = 'def_tag00000000000000000000a'
const THREAD_A = 'thr_cuid0000000000000000000a'
const THREAD_B = 'thr_cuid0000000000000000000b'
const INBOX_A = 'inb_cuid0000000000000000000a'
const SUPPORT = `${TAG_DEF}:tag_support00000000000000a`
const BILLING = `${TAG_DEF}:tag_billing00000000000000a`

/** `db.select()` in `publishTagChanges` — the inbox/assignee lookup. */
function makeDb(threadRows: unknown[]) {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    from: () => chain,
    where: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(threadRows).then(ok, err),
  })
  return { select: () => chain } as never
}

function service(threadRows: unknown[]) {
  return new ThreadMutationService(
    ORG_ID,
    makeDb(threadRows),
    undefined,
    undefined,
    SYSTEM_VISIBILITY
  )
}

/** Args of the last `publishThreadUpdated` call. */
function lastPublish() {
  const args = realtime.publishThreadUpdated.mock.calls.at(-1) as unknown as unknown[]
  return args[2] as { threadId: string; inboxId: string | null; patch: Record<string, unknown> }
}

beforeEach(() => {
  tagFixture.reads = []
  realtime.publishThreadUpdated.mockClear()
  vi.mocked(markMailCountsStaleForOrgMembers).mockClear()
})

describe('tagThreadsBulk — mail realtime', () => {
  it('publishes thread:updated carrying the FULL resulting tag set', async () => {
    tagFixture.reads = [new Map([[THREAD_A, [SUPPORT]]]), new Map([[THREAD_A, [SUPPORT, BILLING]]])]

    await service([{ id: THREAD_A, inboxId: INBOX_A, assigneeId: null }]).tagThreadsBulk(
      [`${THREAD_DEF}:${THREAD_A}` as never],
      [BILLING as never],
      'add'
    )

    expect(realtime.publishThreadUpdated).toHaveBeenCalledTimes(1)
    // Full replacement, not a delta — the store overwrites `tagIds` wholesale.
    expect(lastPublish().patch).toEqual({ tagIds: [SUPPORT, BILLING] })
    expect(lastPublish()).toMatchObject({ threadId: THREAD_A, inboxId: INBOX_A })
  })

  /**
   * Re-adding a tag a thread already carries is a deliberate no-op
   * (mail-classification C5, "accumulate don't replace"), and a retroactive
   * run over a backlog is mostly those. Publishing per requested thread rather
   * than per CHANGED thread would fan thousands of empty frames per run.
   */
  it('publishes only for threads whose tags actually changed', async () => {
    tagFixture.reads = [
      new Map([
        [THREAD_A, [SUPPORT]],
        [THREAD_B, [SUPPORT]],
      ]),
      new Map([
        [THREAD_A, [SUPPORT, BILLING]],
        [THREAD_B, [SUPPORT]],
      ]),
    ]

    await service([{ id: THREAD_A, inboxId: INBOX_A, assigneeId: null }]).tagThreadsBulk(
      [`${THREAD_DEF}:${THREAD_A}` as never, `${THREAD_DEF}:${THREAD_B}` as never],
      [BILLING as never],
      'add'
    )

    expect(realtime.publishThreadUpdated).toHaveBeenCalledTimes(1)
    expect(lastPublish().threadId).toBe(THREAD_A)
  })

  /** `batchGetThreadTagIds` has no ORDER BY — a reorder is not a change. */
  it('treats a reordered tag set as unchanged', async () => {
    tagFixture.reads = [
      new Map([[THREAD_A, [SUPPORT, BILLING]]]),
      new Map([[THREAD_A, [BILLING, SUPPORT]]]),
    ]

    await service([{ id: THREAD_A, inboxId: INBOX_A, assigneeId: null }]).tagThreadsBulk(
      [`${THREAD_DEF}:${THREAD_A}` as never],
      [BILLING as never],
      'add'
    )

    expect(realtime.publishThreadUpdated).not.toHaveBeenCalled()
  })

  /**
   * Mail views filter on arbitrary conditions, tag conditions included, and
   * `getViewCounts` counts unread threads matching them — so a tag write can
   * move a view badge.
   */
  it('marks mail counts stale when tags changed, and not otherwise', async () => {
    tagFixture.reads = [new Map(), new Map([[THREAD_A, [BILLING]]])]
    await service([{ id: THREAD_A, inboxId: INBOX_A, assigneeId: null }]).tagThreadsBulk(
      [`${THREAD_DEF}:${THREAD_A}` as never],
      [BILLING as never],
      'add'
    )
    expect(markMailCountsStaleForOrgMembers).toHaveBeenCalledTimes(1)

    vi.mocked(markMailCountsStaleForOrgMembers).mockClear()
    tagFixture.reads = [new Map([[THREAD_A, [BILLING]]]), new Map([[THREAD_A, [BILLING]]])]
    await service([{ id: THREAD_A, inboxId: INBOX_A, assigneeId: null }]).tagThreadsBulk(
      [`${THREAD_DEF}:${THREAD_A}` as never],
      [BILLING as never],
      'add'
    )
    expect(markMailCountsStaleForOrgMembers).not.toHaveBeenCalled()
  })

  /**
   * The tags are already committed by the time we publish, so a realtime
   * failure degrades to "stale until reload" — it must never surface as a
   * failed tag write to the classifier or the toolbar.
   */
  it('never fails the write when the publish throws', async () => {
    tagFixture.reads = [new Map(), new Map([[THREAD_A, [BILLING]]])]
    realtime.publishThreadUpdated.mockRejectedValueOnce(new Error('pusher down') as never)

    const result = await service([
      { id: THREAD_A, inboxId: INBOX_A, assigneeId: null },
    ]).tagThreadsBulk([`${THREAD_DEF}:${THREAD_A}` as never], [BILLING as never], 'add')

    expect(result.errors).toEqual([])
    expect(result.created).toBe(1)
  })

  /**
   * Separate from the case above: a rejected `publishThreadUpdated` is absorbed
   * by `Promise.allSettled`, so only a throw BEFORE the fan-out reaches the
   * outer catch. Without it a Redis blip on the read-back would turn every
   * classifier tag write into a failure.
   */
  it('never fails the write when the tag read-back throws', async () => {
    tagFixture.reads = [new Map(), new Error('db gone')]

    const result = await service([
      { id: THREAD_A, inboxId: INBOX_A, assigneeId: null },
    ]).tagThreadsBulk([`${THREAD_DEF}:${THREAD_A}` as never], [BILLING as never], 'add')

    expect(result.errors).toEqual([])
    expect(result.created).toBe(1)
    expect(realtime.publishThreadUpdated).not.toHaveBeenCalled()
  })
})
