// apps/web/src/components/threads/hooks/use-thread-read-status-default.test.tsx

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 44 §1.3 — `useThreadReadStatus` must not invent read state.
 *
 * It used to return `isUnread ?? true`, so a thread the store has never seen
 * read as unread. That default exists for *list rows* (a not-yet-loaded row
 * renders bold); the detail pane's auto-mark effect turned it into a WRITE,
 * against a thread whose lens it could not yet know. The unknown case is now
 * `undefined` and each caller decides.
 */

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  threads: new Map<string, unknown>(),
}))

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ userId: 'usr_me' }) }))

vi.mock('~/components/mail/hooks', () => ({
  useCountUpdates: () => ({
    onMarkAsRead: vi.fn(),
    onMarkAsUnread: vi.fn(),
    rollback: vi.fn(),
  }),
}))

vi.mock('../store', () => ({
  useThreadStore: (selector: (s: unknown) => unknown) =>
    selector({ threads: h.threads, updateThread: vi.fn() }),
}))

vi.mock('~/trpc/react', () => ({
  api: { thread: { update: { useMutation: () => ({ mutate: h.mutate }) } } },
}))

const { useThreadReadStatus } = await import('./use-thread-read-status')

beforeEach(() => {
  h.mutate.mockReset()
  h.threads = new Map()
})

describe('useThreadReadStatus.isUnread', () => {
  it('is `undefined` for a thread the store has not hydrated', () => {
    const { result } = renderHook(() => useThreadReadStatus('thr_unknown'))

    expect(result.current.isUnread).toBeUndefined()
  })

  it('is `undefined` when no thread is selected', () => {
    const { result } = renderHook(() => useThreadReadStatus(null))

    expect(result.current.isUnread).toBeUndefined()
  })

  it('reports the stored value once hydrated', () => {
    h.threads.set('thr_1', { id: 'thr_1', isUnread: false })

    expect(renderHook(() => useThreadReadStatus('thr_1')).result.current.isUnread).toBe(false)
  })

  it('reports unread when the stored thread is unread', () => {
    h.threads.set('thr_1', { id: 'thr_1', isUnread: true })

    expect(renderHook(() => useThreadReadStatus('thr_1')).result.current.isUnread).toBe(true)
  })
})
