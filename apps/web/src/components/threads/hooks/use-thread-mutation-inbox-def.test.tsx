// apps/web/src/components/threads/hooks/use-thread-mutation-inbox-def.test.tsx

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40a §5.1 / §0 risk #4 — the FE inbox-move round trip.
 *
 * `useThreadMutation` takes an inbox RecordId and derives the BARE instance id
 * for its optimistic `sharedInboxes` count delta. It did that with
 * `updates.inboxId.replace('inbox:', '')`, which is wrong for both non-shared
 * shapes a mailbox RecordId can take:
 *
 *  - `personal_inbox:<id>` — the substring matches MID-WORD, yielding
 *    `personal_<id>`;
 *  - a def-CUID-keyed id — no match at all, yielding the whole RecordId.
 *
 * Either way the delta lands under a key the badge never reads: no error, no
 * toast, the counter simply stops moving. The parse must come from the RecordId
 * helper, not from string surgery.
 */

const h = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  saveSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  updateBulkMutate: vi.fn(),
  updateMutate: vi.fn(),
  threads: {} as Record<string, unknown>,
}))

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

const SHARED_INBOX = 'ibx_shared'
const PERSONAL_INBOX = 'ibx_personal'
const DEF_CUID = 'clw0000000000000000000000'

beforeEach(() => {
  h.batchUpdate.mockReset()
  h.saveSnapshot.mockReset()
  h.restoreSnapshot.mockReset()
  h.updateBulkMutate.mockReset()
  h.updateMutate.mockReset()
  h.threads = {
    t_1: { id: 't_1', isUnread: true, status: 'OPEN', inboxId: `inbox:${SHARED_INBOX}` },
  }
})

/** Every `sharedInboxes` delta the move batched, keyed as the store filed it. */
function inboxDeltas(inboxRecordId: string): Record<string, number> {
  const { result } = renderHook(() => useThreadMutation())
  result.current.updateBulk(['t_1'], { inboxId: inboxRecordId as never })
  const { sharedInboxes } = h.batchUpdate.mock.calls.at(-1)?.[0] as {
    sharedInboxes: Record<string, number>
  }
  return sharedInboxes
}

/** The key the DESTINATION credit landed under. */
function creditedKey(inboxRecordId: string): string {
  const credited = Object.entries(inboxDeltas(inboxRecordId)).filter(([, delta]) => delta > 0)
  expect(credited).toHaveLength(1)
  return credited[0]![0]
}

/** The key the SOURCE debit landed under. */
function debitedKey(inboxRecordId: string): string {
  const debited = Object.entries(inboxDeltas(inboxRecordId)).filter(([, delta]) => delta < 0)
  expect(debited).toHaveLength(1)
  return debited[0]![0]
}

describe('useThreadMutation inbox move — RecordId round trip (plan 40a §5.1)', () => {
  it('credits the BARE instance id when moving into a personal mailbox', () => {
    expect(creditedKey(`personal_inbox:${PERSONAL_INBOX}`)).toBe(PERSONAL_INBOX)
  })

  it('credits the bare instance id for a shared mailbox (negative control)', () => {
    h.threads.t_1 = { id: 't_1', isUnread: true, status: 'OPEN', inboxId: 'inbox:ibx_other' }

    expect(creditedKey(`inbox:${SHARED_INBOX}`)).toBe(SHARED_INBOX)
  })

  it('credits the bare instance id for a def-CUID-keyed RecordId', () => {
    // `thread.listMeta` mints this keyspace (`record.listAll` parity), so the
    // store can legitimately hand one back through an optimistic re-move.
    expect(creditedKey(`${DEF_CUID}:${PERSONAL_INBOX}`)).toBe(PERSONAL_INBOX)
  })

  it('never produces a mangled `personal_…` key', () => {
    expect(creditedKey(`personal_inbox:${PERSONAL_INBOX}`)).not.toBe(`personal_${PERSONAL_INBOX}`)
  })

  /**
   * Plan 44 §3.3. The source debit used to key off `context.inboxId`, the whole
   * stored RecordId, so it never matched the badge's bare-id keyspace — this
   * file previously said so and declined to pin it. The context producer now
   * parses it, so both halves of a move land in the same keyspace.
   */
  it('debits the BARE instance id of the source mailbox', () => {
    expect(debitedKey(`personal_inbox:${PERSONAL_INBOX}`)).toBe(SHARED_INBOX)
  })

  it('debits the bare instance id when the source is a personal mailbox', () => {
    h.threads.t_1 = {
      id: 't_1',
      isUnread: true,
      status: 'OPEN',
      inboxId: `personal_inbox:${PERSONAL_INBOX}`,
    }

    expect(debitedKey(`inbox:${SHARED_INBOX}`)).toBe(PERSONAL_INBOX)
  })

  it('still forwards the full RecordId to the server mutation', () => {
    renderHook(() => useThreadMutation()).result.current.updateBulk(['t_1'], {
      inboxId: `personal_inbox:${PERSONAL_INBOX}` as never,
    })

    expect(h.updateBulkMutate).toHaveBeenCalledWith(
      { recordIds: ['thread:t_1'], updates: { inboxId: `personal_inbox:${PERSONAL_INBOX}` } },
      expect.anything()
    )
  })
})
