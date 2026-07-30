// apps/web/src/components/threads/store/thread-store-revoke-eviction.test.ts
//
// A revoked thread must leave the store, and a broken connection must not.
//
// `thread.getByIds` answers a lens denial by simply omitting the thread, which
// `use-batch-drain` turns into a not-found id. `completeBatch` used to tombstone
// that id while LEAVING the stale row in `threads`, which had two consequences:
// `thread-details` renders "Thread not found" only on `!thread`, so the revoked
// viewer kept seeing the header/subject/participants; and `useMessages`' gate is
// `enabled: !!thread`, so it refetched a 404 on every focus and reconnect.
//
// The hazard the eviction introduces is the second half of this file: the drain
// reports a FAILED fetch as "the whole batch is not found", so without a
// separate signal a dropped connection would empty the mailbox.

import { beforeEach, describe, expect, it } from 'vitest'
import { useMessageListStore } from './message-list-store'
import { type ThreadMeta, useThreadStore } from './thread-store'

const thread = (id: string, myLens: ThreadMeta['myLens'] = 'read') =>
  ({
    id,
    subject: 'Refund request',
    status: 'OPEN',
    lastMessageAt: '2026-07-29T10:00:00.000Z',
    myLens,
  }) as unknown as ThreadMeta

beforeEach(() => {
  useThreadStore.getState().reset()
  useMessageListStore.getState().invalidateAll()
})

describe('completeBatch — a thread that came back not-found', () => {
  it('EVICTS the stale row, so `!thread` consumers stop rendering it', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])
    expect(useThreadStore.getState().threads.get('thr_1')).toBeDefined()

    // The revoke: `visibility:changed` → `forceRequestThread` → the thread is
    // no longer in the response.
    useThreadStore.getState().completeBatch([], ['thr_1'])

    expect(useThreadStore.getState().threads.has('thr_1')).toBe(false)
    expect(useThreadStore.getState().notFoundIds.has('thr_1')).toBe(true)
  })

  it('drops the message id list — what makes the bodies reachable', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])
    useMessageListStore
      .getState()
      .setList('thr_1', { messageIds: ['msg_1', 'msg_2'], total: 2, fetchedAt: 0 })

    useThreadStore.getState().completeBatch([], ['thr_1'])

    expect(useMessageListStore.getState().lists.has('thr_1')).toBe(false)
  })

  it('leaves other threads in the same batch alone', () => {
    useThreadStore.getState().completeBatch([thread('thr_1'), thread('thr_2')], [])

    useThreadStore.getState().completeBatch([thread('thr_2')], ['thr_1'])

    expect(useThreadStore.getState().threads.has('thr_1')).toBe(false)
    expect(useThreadStore.getState().threads.has('thr_2')).toBe(true)
  })

  it('clears loadingIds either way', () => {
    useThreadStore.getState().requestThread('thr_1')
    useThreadStore.getState().startBatch()
    expect(useThreadStore.getState().loadingIds.has('thr_1')).toBe(true)

    useThreadStore.getState().completeBatch([], ['thr_1'])

    expect(useThreadStore.getState().loadingIds.has('thr_1')).toBe(false)
  })

  it('a re-grant repopulates — eviction is not a tombstone', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])
    useThreadStore.getState().completeBatch([], ['thr_1'])

    // `forceRequestThread` is the only bypass that clears `notFoundIds`.
    useThreadStore.getState().forceRequestThread('thr_1')
    expect(useThreadStore.getState().startBatch()).toContain('thr_1')
    useThreadStore.getState().completeBatch([thread('thr_1', 'read')], [])

    expect(useThreadStore.getState().threads.get('thr_1')?.myLens).toBe('read')
    expect(useThreadStore.getState().notFoundIds.has('thr_1')).toBe(false)
  })
})

describe('failBatch — the fetch itself threw', () => {
  it('does NOT evict: a dropped connection is not a revoke', () => {
    useThreadStore.getState().completeBatch([thread('thr_1'), thread('thr_2')], [])
    useThreadStore.getState().requestThread('thr_3')
    useThreadStore.getState().startBatch()

    // This is what `use-batch-drain` calls in its catch block. Routing it to
    // `completeBatch([], batch)` — the old behaviour — is what this pins.
    useThreadStore.getState().failBatch(['thr_1', 'thr_2', 'thr_3'])

    expect(useThreadStore.getState().threads.has('thr_1')).toBe(true)
    expect(useThreadStore.getState().threads.has('thr_2')).toBe(true)
  })

  it('does NOT tombstone, so the ids can be requested again', () => {
    useThreadStore.getState().requestThread('thr_3')
    useThreadStore.getState().startBatch()

    useThreadStore.getState().failBatch(['thr_3'])

    expect(useThreadStore.getState().notFoundIds.has('thr_3')).toBe(false)
    expect(useThreadStore.getState().loadingIds.has('thr_3')).toBe(false)

    useThreadStore.getState().requestThread('thr_3')
    expect(useThreadStore.getState().pendingIds.has('thr_3')).toBe(true)
  })

  it('keeps the message list — nothing was revoked', () => {
    useThreadStore.getState().completeBatch([thread('thr_1')], [])
    useMessageListStore
      .getState()
      .setList('thr_1', { messageIds: ['msg_1'], total: 1, fetchedAt: 0 })

    useThreadStore.getState().failBatch(['thr_1'])

    expect(useMessageListStore.getState().lists.has('thr_1')).toBe(true)
  })
})
