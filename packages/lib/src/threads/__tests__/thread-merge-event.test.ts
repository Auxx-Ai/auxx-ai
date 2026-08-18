// packages/lib/src/threads/__tests__/thread-merge-event.test.ts

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * thread-events §13.1 — merge is dual-surface: the `TimelineEvent` markers are
 * the MECHANISM (unmerge reads them back) and the `thread:merged` `ThreadEvent`
 * on the surviving thread is the SURFACE. Pinned here:
 *
 * - a successful merge publishes one `thread:merged` per DIRECT source, on the
 *   surviving thread, attributed to the acting user;
 * - unmerge deletes the surviving thread's `thread:merged` row for that source
 *   (matched on threadId + type + `data->>'sourceThreadId'`) INSIDE the
 *   transaction, alongside the marker cleanup — the markers themselves are a
 *   different table and stay the mechanism.
 */

const { publisher } = vi.hoisted(() => ({
  publisher: { publish: vi.fn(async () => undefined), publishLater: vi.fn(async () => undefined) },
}))

vi.mock('../../events/publisher', () => ({ publisher }))
vi.mock('../../realtime', () => ({
  getRealtimeService: vi.fn(() => ({})),
  publishThreadUpdated: vi.fn(async () => undefined),
}))

const { ThreadMergeService } = await import('../thread-merge.service')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const TARGET = 'thr_target000000000000000000'
const SOURCE_A = 'thr_sourcea000000000000000aa'
const SOURCE_B = 'thr_sourceb000000000000000bb'

/**
 * Recursively collect every scalar reachable through a drizzle SQL tree —
 * Param values, inlined chunks and StringChunk text alike. Permissive on
 * purpose: the assertions below match exact full values, so stray SQL text
 * fragments cannot false-positive.
 */
function boundValues(node: unknown, out: unknown[] = []): unknown[] {
  if (node == null) return out
  if (typeof node !== 'object') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const chunk of node) boundValues(chunk, out)
    return out
  }
  const anyNode = node as { value?: unknown; queryChunks?: unknown[] }
  if (Array.isArray(anyNode.queryChunks)) {
    for (const chunk of anyNode.queryChunks) boundValues(chunk, out)
    return out
  }
  if ('value' in anyNode) boundValues(anyNode.value, out)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('merge — thread:merged emission', () => {
  it('publishes one thread:merged per direct source, post-commit, with the acting user', async () => {
    // The transaction's inner mechanics are not under test — return the
    // committed result directly; the emission loop runs off it after commit.
    const db = {
      transaction: vi.fn(async () => ({
        batchId: 'batch_1',
        targetThreadId: TARGET,
        sourceThreadIds: [SOURCE_A, SOURCE_B],
        movedMessageCount: 3,
        movedCommentCount: 0,
        unmergeableUntil: new Date(),
      })),
    }
    const service = new ThreadMergeService(db as never, ORG_ID, USER_ID)

    await service.merge({
      sourceThreadIds: [SOURCE_A, SOURCE_B],
      targetThreadId: TARGET,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    })

    const merged = (publisher.publishLater.mock.calls as unknown[][])
      .map(([e]) => e as { type: string; data: Record<string, unknown> })
      .filter((e) => e.type === 'thread:merged')
    expect(merged).toHaveLength(2)
    expect(merged.map((e) => e.data)).toEqual([
      expect.objectContaining({
        threadId: TARGET,
        organizationId: ORG_ID,
        sourceThreadId: SOURCE_A,
        actorId: `user:${USER_ID}`,
      }),
      expect.objectContaining({ threadId: TARGET, sourceThreadId: SOURCE_B }),
    ])
  })

  it('publishes nothing when every source was already merged (empty result)', async () => {
    const db = {
      transaction: vi.fn(async () => ({
        batchId: 'batch_1',
        targetThreadId: TARGET,
        sourceThreadIds: [],
        movedMessageCount: 0,
        movedCommentCount: 0,
        unmergeableUntil: new Date(),
      })),
    }
    const service = new ThreadMergeService(db as never, ORG_ID, USER_ID)

    await service.merge({
      sourceThreadIds: [SOURCE_A],
      targetThreadId: TARGET,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    })

    expect(publisher.publishLater).not.toHaveBeenCalled()
  })
})

describe('unmerge — thread:merged row deletion', () => {
  it("deletes the surviving thread's thread:merged ThreadEvent row for that source", async () => {
    const deletes: { table: unknown; condition: unknown }[] = []
    const thenable = (result: unknown) => {
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        set: () => chain,
        where: (condition?: unknown) => {
          if (condition !== undefined) chain.__condition = condition
          return chain
        },
        for: () => Promise.resolve(result),
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(ok, err),
      })
      return chain
    }
    const targetRow = {
      id: TARGET,
      mergedIntoThreadId: null,
      inboxId: null,
      mergeData: { sources: [{ threadId: SOURCE_A }] },
    }
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: async () => [targetRow] }) }) }),
      update: () => thenable([]),
      execute: async () => undefined,
      delete: (table: unknown) => ({
        where: (condition: unknown) => {
          deletes.push({ table, condition })
          return Promise.resolve(undefined)
        },
      }),
    }
    const db = { transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) }

    const service = new ThreadMergeService(db as never, ORG_ID, USER_ID)
    // The move-reversal mechanics are covered elsewhere; stub them so the test
    // isolates the event-row cleanup contract.
    const svc = service as unknown as Record<string, unknown>
    svc.loadSourceForUnmerge = async () => ({ mergedIntoThreadId: TARGET, inboxId: null })
    svc.loadMergedIntoEvent = async () => ({ eventData: {} })
    svc.reverseSourceMoves = async () => undefined
    svc.recomputeTargetMetadata = async () => ({
      messageCount: 0,
      participantCount: 0,
      lastMessageAt: null,
    })
    svc.publishUnmergeFanout = async () => undefined

    await service.unmerge(SOURCE_A, USER_ID)

    const threadEventDeletes = deletes.filter((d) => d.table === schema.ThreadEvent)
    expect(threadEventDeletes).toHaveLength(1)
    const values = boundValues(threadEventDeletes[0]?.condition)
    expect(values).toContain('thread:merged')
    expect(values).toContain(SOURCE_A)
    expect(values).toContain(TARGET)
    // The TimelineEvent MARKERS are cleaned for this source too — mechanism
    // and surface each get exactly their own delete.
    expect(deletes.filter((d) => d.table === schema.TimelineEvent)).toHaveLength(2)
  })
})
