// apps/web/src/components/threads/store/thread-store-force-request.test.ts
//
// Plan 45 §3.1 — `forceRequestThread`, the bypass `visibility:changed` needs.
//
// The two assertions that carry the design: it enqueues WITHOUT evicting (an
// eviction blanks the pane mid-read, because `thread-messages` returns null on a
// missing thread), and it clears `notFoundIds` (a thread that 404'd at `none` and
// has just been granted is exactly the case a `threads.has(id)`-only bypass
// misses — §5 hazard 2).

import { beforeEach, describe, expect, it } from 'vitest'
import { type ThreadMeta, useThreadStore } from './thread-store'

const thread = (id: string, myLens: ThreadMeta['myLens'] = 'metadata') =>
  ({
    id,
    subject: '',
    status: 'OPEN',
    lastMessageAt: '2026-07-29T10:00:00.000Z',
    myLens,
  }) as unknown as ThreadMeta

beforeEach(() => {
  useThreadStore.getState().reset()
})

describe('forceRequestThread', () => {
  it('enqueues a thread the store already holds — which requestThread refuses', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])

    useThreadStore.getState().requestThread('thr_1')
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(false)

    useThreadStore.getState().forceRequestThread('thr_1')
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)
  })

  it('does NOT evict — the old entry keeps rendering until the batch lands', () => {
    useThreadStore.getState().completeBatch([thread('thr_1', 'metadata')], [])

    useThreadStore.getState().forceRequestThread('thr_1')

    // The assertion that fails if someone reimplements this as evict-then-request.
    expect(useThreadStore.getState().threads.get('thr_1')).toBeDefined()
    expect(useThreadStore.getState().threads.get('thr_1')?.myLens).toBe('metadata')
  })

  it('replaces the entry in place once the forced batch completes', () => {
    useThreadStore.getState().completeBatch([thread('thr_1', 'metadata')], [])
    useThreadStore.getState().forceRequestThread('thr_1')

    expect(useThreadStore.getState().startBatch()).toContain('thr_1')
    useThreadStore.getState().completeBatch([thread('thr_1', 'full')], [])

    expect(useThreadStore.getState().threads.get('thr_1')?.myLens).toBe('full')
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(false)
  })

  it('clears notFoundIds — a thread that 404d at `none` must re-request', () => {
    useThreadStore.getState().completeBatch([], ['thr_1'])
    expect(useThreadStore.getState().notFoundIds.has('thr_1')).toBe(true)

    useThreadStore.getState().requestThread('thr_1')
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(false)

    useThreadStore.getState().forceRequestThread('thr_1')
    expect(useThreadStore.getState().notFoundIds.has('thr_1')).toBe(false)
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)
  })

  it('refuses a deleted thread — a lens change does not resurrect it', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])
    useThreadStore.getState().removeThread('thr_1')

    useThreadStore.getState().forceRequestThread('thr_1')

    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(false)
  })

  it('is a no-op when the id is already queued', () => {
    useThreadStore.getState().requestThread('thr_1')
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)

    useThreadStore.getState().forceRequestThread('thr_1')

    expect(Array.from(useThreadStore.getState().pendingIds)).toEqual(['thr_1'])
  })

  it('still enqueues while a batch is in flight — that fetch may predate the change', () => {
    useThreadStore.getState().requestThread('thr_1')
    useThreadStore.getState().startBatch()
    expect(useThreadStore.getState().loadingIds.has('thr_1')).toBe(true)

    useThreadStore.getState().forceRequestThread('thr_1')

    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)
  })
})
