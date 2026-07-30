// apps/web/src/components/threads/hooks/use-thread-mutation-assignee-identity.test.tsx

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 44 §3.1 — the one-directional "Assigned to me" badge.
 *
 * `applyCountUpdates` stripped `user:` off the INCOMING assignee but compared
 * the stored one — an `ActorId` — straight against the bare session id. So
 * `isAssigningToMe` worked while `wasAssignedToMe` never did: assigning a
 * thread to myself incremented the badge, unassigning it never decremented.
 * The optimistic count could only move up.
 *
 * Both sides now come from the same keyspace: the incoming id through
 * `safeParseActorId`, the stored one through `buildThreadCountContext`.
 */

const h = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  saveSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  updateMutate: vi.fn(),
  updateBulkMutate: vi.fn(),
  threads: {} as Record<string, unknown>,
}))

const ME = 'usr_me'
const OTHER = 'usr_other'

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ userId: 'usr_me' }) }))

vi.mock('~/components/mail/hooks', () => ({
  useCountUpdates: () => ({
    onMarkAsRead: vi.fn(),
    onMarkAsUnread: vi.fn(),
    onArchiveOrTrash: vi.fn(),
  }),
}))

vi.mock('~/components/mail/store', () => ({
  useMailCountsStore: (selector: (s: unknown) => unknown) =>
    selector({
      saveSnapshot: h.saveSnapshot,
      restoreSnapshot: h.restoreSnapshot,
      batchUpdate: h.batchUpdate,
    }),
}))

vi.mock('../store', () => ({
  useThreadStore: (selector: (s: unknown) => unknown) =>
    selector({
      updateThreadOptimistic: vi.fn(() => 1),
      confirmOptimistic: vi.fn(),
      rollbackOptimistic: vi.fn(),
      removeThread: vi.fn(),
      undeleteThread: vi.fn(),
      getThread: (id: string) => h.threads[id],
    }),
  useThreadSelectionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ setActiveThread: vi.fn() }),
    { getState: () => ({ activeThreadId: null }) }
  ),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    thread: {
      update: { useMutation: () => ({ mutate: h.updateMutate }) },
      updateBulk: { useMutation: () => ({ mutate: h.updateBulkMutate }) },
      remove: { useMutation: () => ({ mutate: vi.fn() }) },
      removeBulk: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}))

const { useThreadMutation } = await import('./use-thread-mutation')

/** An unread OPEN thread currently assigned to `assignee`, as the store holds it. */
function seed(assignee: string | null) {
  h.threads = {
    t_1: {
      id: 't_1',
      isUnread: true,
      status: 'OPEN',
      inboxId: 'inbox:ibx_shared',
      assigneeId: assignee,
    },
  }
}

/** The personal-inbox delta the reassignment batched. */
function inboxDelta(newAssignee: string | null): number {
  const { result } = renderHook(() => useThreadMutation())
  result.current.update('t_1', { assigneeId: newAssignee as never })
  return (h.batchUpdate.mock.calls.at(-1)?.[0] as { inbox: number }).inbox
}

beforeEach(() => {
  h.batchUpdate.mockReset()
  h.saveSnapshot.mockReset()
  h.restoreSnapshot.mockReset()
  h.updateMutate.mockReset()
})

describe('useThreadMutation assignee deltas — the badge moves both ways', () => {
  it('DECREMENTS when unassigning a thread from me', () => {
    seed(`user:${ME}`)

    expect(inboxDelta(null)).toBe(-1)
  })

  it('DECREMENTS when reassigning my thread to someone else', () => {
    seed(`user:${ME}`)

    expect(inboxDelta(`user:${OTHER}`)).toBe(-1)
  })

  it('increments when assigning to me (the half that always worked)', () => {
    seed(`user:${OTHER}`)

    expect(inboxDelta(`user:${ME}`)).toBe(1)
  })

  it('does not move when the reassignment never involves me', () => {
    seed(`user:${OTHER}`)

    expect(inboxDelta(null)).toBe(0)
  })

  it('does not move when the thread stays mine', () => {
    seed(`user:${ME}`)

    expect(inboxDelta(`user:${ME}`)).toBe(0)
  })
})
