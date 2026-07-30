// apps/web/src/components/mail/thread-display-read-gate.test.tsx

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 44 §1 — the detail pane's auto-mark-read must not fire a write it knows
 * will be refused.
 *
 * Read-state is top-tier: `UnreadService.setReadStatus` throws
 * `ForbiddenError` unless every target is at the `read` lens (spelled `full`
 * before the permissions-v3 rename — `read` is now the TOP lens). The pane marked read
 * on mount regardless, and `useThreadReadStatus` defaulted an unknown thread to
 * unread — so a share recipient following the MESSAGE_SHARED deep link (no list
 * load in front of it, store not yet hydrated) got a rejection toast on open.
 *
 * The assertion is `expect(markAsRead).not.toHaveBeenCalled()`. A test that
 * only checked "no toast" would pass with the gate deleted, because the toast
 * is downstream of the request.
 */

const h = vi.hoisted(() => ({
  markAsRead: vi.fn(),
  thread: null as Record<string, unknown> | null,
  isUnread: undefined as boolean | undefined,
}))

vi.mock('~/components/threads/hooks', () => ({
  useThread: () => ({
    thread: h.thread,
    isLoading: false,
    isNotFound: false,
    isDeleted: false,
  }),
  useThreadReadStatus: () => ({ isUnread: h.isUnread, markAsRead: h.markAsRead }),
}))

vi.mock('~/components/threads/store', () => ({
  useActiveThreadId: () => null,
  useHasMultipleSelected: () => false,
}))

vi.mock('./mail-filter-context', () => ({ useMailFilter: () => ({ viewMode: 'list' }) }))
vi.mock('~/hooks/use-compose', () => ({ useCompose: () => ({ openCompose: vi.fn() }) }))
vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ hasOnlyForwardingChannel: false }) }))

// Heavy children — none of them participate in the gate.
vi.mock('~/components/kopilot/context', () => ({ KopilotContext: () => null }))
vi.mock('~/components/kopilot/suggestions', () => ({ KopilotSuggestion: () => null }))
vi.mock('./thread-details', () => ({ default: () => null }))
vi.mock('./thread-provider', () => ({ ThreadProvider: () => null }))
vi.mock('../global/empty-state', () => ({ EmptyState: () => null }))

const { ThreadDisplay } = await import('./thread-display')

const THREAD_ID = 'thr_1'

/** A hydrated, unread thread at the given lens. */
function hydrated(myLens: 'read' | 'identity' | 'metadata') {
  h.thread = { id: THREAD_ID, subject: 'Hello', myLens, isUnread: true }
  h.isUnread = true
}

beforeEach(() => {
  h.markAsRead.mockReset()
  h.thread = null
  h.isUnread = undefined
})

describe('ThreadDisplay auto-mark-read gate', () => {
  it('marks read at `read` lens (positive control)', () => {
    hydrated('read')
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).toHaveBeenCalled()
  })

  it('does NOT mark read at `identity` lens', () => {
    hydrated('identity')
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).not.toHaveBeenCalled()
  })

  it('does NOT mark read at `metadata` lens', () => {
    hydrated('metadata')
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).not.toHaveBeenCalled()
  })

  /**
   * The actual reported path (§1.2): the URL supplies the id, the pane renders
   * before `getThreadMetaBatch` returns, and the lens is simply not knowable
   * yet. `useThreadReadStatus` used to default this to unread and turn it into
   * a write — a "log in and click a thread" manual pass never reproduces it.
   */
  it('does NOT mark read while the store is empty', () => {
    h.thread = null
    // `true` on purpose: that is what the hook used to synthesize for an
    // unknown thread (`isUnread ?? true`), so this pins the component's
    // `!!thread` half rather than riding on the hook's new `undefined`.
    h.isUnread = true
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).not.toHaveBeenCalled()
  })

  it('does not mark an already-read thread', () => {
    h.thread = { id: THREAD_ID, subject: 'Hello', myLens: 'read', isUnread: false }
    h.isUnread = false
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).not.toHaveBeenCalled()
  })

  /** Pre-lens cached payloads carry no `myLens`; those must keep working. */
  it('marks read when the payload predates `myLens`', () => {
    h.thread = { id: THREAD_ID, subject: 'Hello', isUnread: true }
    h.isUnread = true
    render(<ThreadDisplay expectedThreadId={THREAD_ID} />)

    expect(h.markAsRead).toHaveBeenCalled()
  })
})
