// apps/web/src/components/dashboard/hooks/__tests__/use-dashboard-kopilot-turn.test.ts
//
// The client half of the dashboard turn lock (plan v3/03 §2, v3/04 §6). Every
// claim here is a fail-open or a fail-safe one, and they pull in opposite
// directions, which is why they are pinned:
//
//  - re-derive from the SERVER on mount and on every (re)subscribe. A release
//    published while the socket was down is never replayed, so the local flag
//    cannot be trusted in either direction after a reconnect.
//  - an `ended` for a turn we never saw start is IGNORED: a late release from a
//    superseded turn must not unlock the canvas under the live one.
//  - the watchdog releases locally after a bound, so a lost `ended` cannot
//    strand the canvas read-only. A pending tool approval suppresses it,
//    because no events flow while the user decides and an idle timer would read
//    that legitimate wait as a dead server.
//
// The lock tracks the ACTIVE turn and nothing else. The Undo offer derives its
// turn id server-side from the snapshot slot, because the outcome that most
// often leaves one is `aborted` — a reload or navigate-away, i.e. the case
// where no client remembers anything.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  orgHandlers: null as null | {
    onEvent?: (event: string, payload: unknown) => void
    onSubscribed?: () => void
  },
  statusFetch: vi.fn(),
  messages: [] as Array<{ approval?: { status: string } }>,
}))

vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers?: Record<string, unknown>) => {
    h.orgHandlers = (handlers ?? null) as typeof h.orgHandlers
    return true
  },
}))

vi.mock('~/trpc/react', () => ({
  api: { useUtils: () => ({ dashboard: { kopilotTurnStatus: { fetch: h.statusFetch } } }) },
}))

vi.mock('~/components/kopilot/stores/kopilot-store', () => ({
  useKopilotStore: { getState: () => ({ messages: h.messages }) },
}))

import { getDashboardTurnLock, useDashboardKopilotTurn } from '../use-dashboard-kopilot-turn'

const WATCHDOG_MS = 3 * 60 * 1000

function turnEvent(payload: unknown) {
  act(() => {
    h.orgHandlers?.onEvent?.('dashboard:kopilot-turn', payload)
  })
}

async function mount() {
  const rendered = renderHook(() => useDashboardKopilotTurn('d1'))
  // Drain the mount re-derive so a test's own state is not raced by it.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return rendered
}

beforeEach(() => {
  vi.useFakeTimers()
  h.orgHandlers = null
  h.messages = []
  h.statusFetch.mockReset().mockResolvedValue({ active: false, turnId: null, startedAt: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDashboardKopilotTurn', () => {
  it('engages on `started` and releases on the matching `ended`', async () => {
    await mount()
    expect(getDashboardTurnLock('d1')).toBeNull()

    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })
    expect(getDashboardTurnLock('d1')?.turnId).toBe('t1')

    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'ended' })
    expect(getDashboardTurnLock('d1')).toBeNull()
  })

  it('ignores an `ended` for a turn it never saw start', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 'live', phase: 'started' })
    turnEvent({ dashboardId: 'd1', turnId: 'stale', phase: 'ended' })

    expect(getDashboardTurnLock('d1')?.turnId).toBe('live')
  })

  it('ignores another dashboard’s turn', async () => {
    await mount()
    turnEvent({ dashboardId: 'd2', turnId: 't1', phase: 'started' })
    expect(getDashboardTurnLock('d1')).toBeNull()
  })

  it('answers `null` for a dashboard it is not tracking', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })
    expect(getDashboardTurnLock('d2')).toBeNull()
  })

  it('re-derives from the server on mount', async () => {
    h.statusFetch.mockResolvedValue({ active: true, turnId: 'running', startedAt: 42 })
    await mount()

    expect(h.statusFetch).toHaveBeenCalledWith({ dashboardId: 'd1' }, { staleTime: 0 })
    expect(getDashboardTurnLock('d1')).toEqual({ turnId: 'running', startedAt: 42 })
  })

  it('re-derives on every (re)subscribe, because a release is never replayed', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })
    expect(getDashboardTurnLock('d1')?.turnId).toBe('t1')

    // The socket dropped and came back; the turn ended while it was down.
    await act(async () => {
      h.orgHandlers?.onSubscribed?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getDashboardTurnLock('d1')).toBeNull()
  })

  it('fails OPEN when the status check throws', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })

    h.statusFetch.mockRejectedValue(new Error('unreachable'))
    await act(async () => {
      h.orgHandlers?.onSubscribed?.()
      await vi.advanceTimersByTimeAsync(0)
    })
    // A stranded read-only canvas is recoverable only by reload, which is worse
    // than the race the lock exists to prevent.
    expect(getDashboardTurnLock('d1')).toBeNull()
  })

  it('the watchdog releases the canvas when a lost `ended` never arrives', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 1000)
    })
    expect(getDashboardTurnLock('d1')).toBeNull()
  })

  it('a draft write pushes the watchdog out, so a long turn does not time itself out', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1000)
      })
      act(() => {
        h.orgHandlers?.onEvent?.('dashboard:draft-updated', {
          dashboardId: 'd1',
          reason: 'kopilot',
        })
      })
    }
    expect(getDashboardTurnLock('d1')?.turnId).toBe('t1')
  })

  it('a pending tool approval suppresses the watchdog', async () => {
    await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })
    h.messages = [{ approval: { status: 'pending' } }]

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2 + 1000)
    })
    // The server keeps the turn open across the pause; no events flow while the
    // user decides, and unlocking then is the worst possible moment.
    expect(getDashboardTurnLock('d1')?.turnId).toBe('t1')
  })

  it('drops the lock on unmount, so it cannot clamp the next dashboard opened', async () => {
    const { unmount } = await mount()
    turnEvent({ dashboardId: 'd1', turnId: 't1', phase: 'started' })

    unmount()
    expect(getDashboardTurnLock('d1')).toBeNull()
  })
})
