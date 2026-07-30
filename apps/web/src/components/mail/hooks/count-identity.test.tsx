// apps/web/src/components/mail/hooks/count-identity.test.tsx

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 44 §3 — the identity-format mismatch in the optimistic count layer.
 *
 * `ThreadCountContext` documented `assigneeId` as "Plain user ID (not ActorId
 * format)" and every consumer then filled it straight from the thread store,
 * where it is an `ActorId`. So `thread.assigneeId === currentUserId` was
 * **always false** and the "Assigned to me" badge never moved optimistically.
 * The same shape repeats for `inboxId`: the store holds a RecordId while
 * `counts.sharedInboxes` is keyed by the bare instance id (`mail-counts.ts`
 * writes `si:{inboxId}`; `toResponse` strips the prefix), so that debit had
 * never matched either.
 *
 * These tests feed contexts from the REAL producer, `buildThreadCountContext`.
 * A hand-written literal is the test that passed all along — and it can no
 * longer be written by accident, because the fields are now named
 * `assigneeUserId` / `inboxInstanceId` and a raw `thread.assigneeId` does not
 * assign to them.
 */

const h = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  saveSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
}))

const ME = 'usr_me'
const OTHER = 'usr_other'
const SHARED_INBOX = 'ibx_shared'
const PERSONAL_INBOX = 'ibx_personal'

vi.mock('~/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'usr_me' } } }),
}))

vi.mock('../store', () => ({
  useMailCountsStore: (selector: (s: unknown) => unknown) =>
    selector({
      batchUpdate: h.batchUpdate,
      saveSnapshot: h.saveSnapshot,
      restoreSnapshot: h.restoreSnapshot,
      incrementDrafts: vi.fn(),
      decrementDrafts: vi.fn(),
    }),
}))

const { useCountUpdates } = await import('./use-count-updates')
const { buildThreadCountContext } = await import('../utils/thread-count-context')

type StoreThread = Parameters<typeof buildThreadCountContext>[0]

/** A store row exactly as `thread-query.service` mints it: prefixed on both ids. */
function storeThread(overrides: Partial<StoreThread> = {}): StoreThread {
  return {
    id: 't_1',
    isUnread: true,
    status: 'OPEN',
    assigneeId: `user:${ME}`,
    inboxId: `inbox:${SHARED_INBOX}`,
    ...overrides,
  } as StoreThread
}

/** Drive the real hook and hand back the deltas it batched. */
function markAsRead(thread: StoreThread) {
  const { result } = renderHook(() => useCountUpdates())
  result.current.onMarkAsRead([buildThreadCountContext(thread)], ME)
  return h.batchUpdate.mock.calls.at(-1)?.[0] as {
    inbox?: number
    sharedInboxes?: Record<string, number>
  }
}

beforeEach(() => {
  h.batchUpdate.mockReset()
  h.saveSnapshot.mockReset()
  h.restoreSnapshot.mockReset()
})

describe('buildThreadCountContext — the one normalization boundary', () => {
  it('parses the ActorId down to the bare user id', () => {
    expect(buildThreadCountContext(storeThread()).assigneeUserId).toBe(ME)
  })

  it('parses the inbox RecordId down to the bare instance id', () => {
    expect(buildThreadCountContext(storeThread()).inboxInstanceId).toBe(SHARED_INBOX)
  })

  it('handles a personal mailbox without mangling it', () => {
    const ctx = buildThreadCountContext(
      storeThread({ inboxId: `personal_inbox:${PERSONAL_INBOX}` as never })
    )

    expect(ctx.inboxInstanceId).toBe(PERSONAL_INBOX)
    expect(ctx.inboxInstanceId).not.toBe(`personal_${PERSONAL_INBOX}`)
  })

  it('leaves an unassigned / uninboxed thread null', () => {
    const ctx = buildThreadCountContext(storeThread({ assigneeId: null, inboxId: null }))

    expect(ctx.assigneeUserId).toBeNull()
    expect(ctx.inboxInstanceId).toBeNull()
  })
})

describe('useCountUpdates — "Assigned to me" badge (§3.1)', () => {
  it('decrements the personal inbox when the thread is assigned to me', () => {
    expect(markAsRead(storeThread()).inbox).toBe(-1)
  })

  it('does NOT decrement for a thread assigned to someone else', () => {
    expect(markAsRead(storeThread({ assigneeId: `user:${OTHER}` as never })).inbox).toBe(0)
  })

  it('increments again when the thread is marked unread', () => {
    const { result } = renderHook(() => useCountUpdates())
    result.current.onMarkAsUnread([buildThreadCountContext(storeThread({ isUnread: false }))], ME)

    expect(h.batchUpdate.mock.calls.at(-1)?.[0].inbox).toBe(1)
  })
})

describe('useCountUpdates — shared-inbox keyspace (§3.3)', () => {
  it('debits the BARE instance id for a shared mailbox', () => {
    expect(markAsRead(storeThread()).sharedInboxes).toEqual({ [SHARED_INBOX]: -1 })
  })

  it('debits the BARE instance id for a personal mailbox', () => {
    const deltas = markAsRead(storeThread({ inboxId: `personal_inbox:${PERSONAL_INBOX}` as never }))

    expect(deltas.sharedInboxes).toEqual({ [PERSONAL_INBOX]: -1 })
  })

  it('never files a delta under a whole RecordId', () => {
    const keys = Object.keys(markAsRead(storeThread()).sharedInboxes ?? {})

    expect(keys.some((k) => k.includes(':'))).toBe(false)
  })
})
