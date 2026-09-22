// apps/web/src/components/channels/ui/sync-status/sync-status-dock.test.tsx

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Channel, useChannelStore } from '../../store/channel-store'
import { useSyncDockStore } from '../../store/sync-dock-store'
import { SyncStatusCard } from './sync-status-card'
import { SyncStatusSidebarItem } from './sync-status-sidebar-item'

vi.mock('../../hooks/use-channel-reconnect', () => ({
  useChannelReconnect: () => ({ reconnect: vi.fn(), pending: false, Dialogs: null }),
}))
vi.mock('@auxx/ui/components/sidebar', () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
  SidebarMenuItem: ({ children, ...props }: { children: ReactNode }) => (
    <li {...props}>{children}</li>
  ),
  SidebarMenuButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  SidebarMenuBadge: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const channel = (id: string, email: string) => ({ id, email, name: null }) as unknown as Channel

function setChannels(syncing: Channel[], authErrors: Channel[]) {
  act(() => {
    useChannelStore.setState({
      syncingChannels: syncing,
      authErrorChannels: authErrors,
      isLoading: false,
    })
  })
}

function renderShell() {
  return render(
    <>
      <ul>
        <SyncStatusSidebarItem />
      </ul>
      <SyncStatusCard />
    </>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  useSyncDockStore.setState({ phase: 'floating', dockedAuthIds: [], target: null })
})

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.clear()
})

describe('sync status dock', () => {
  it('X moves the card into the sidebar, and the sidebar row brings it back expanded', () => {
    setChannels([channel('c1', 'a@x.com')], [])
    renderShell()
    expect(screen.getByText('Syncing 1 channel')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Syncing channels/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Move to sidebar' }))
    act(() => vi.advanceTimersByTime(500))

    expect(useSyncDockStore.getState().phase).toBe('docked')
    expect(screen.queryByText('Syncing 1 channel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Syncing channels/ }))
    act(() => vi.advanceTimersByTime(500))

    expect(useSyncDockStore.getState().phase).toBe('floating')
    expect(screen.getByText('Syncing 1 channel')).toBeTruthy()
    expect(screen.getByText('a@x.com')).toBeTruthy()
  })

  it('pops back out for a new login failure, but not for a new sync', () => {
    setChannels([channel('c1', 'a@x.com')], [channel('c2', 'b@x.com')])
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Move to sidebar' }))
    act(() => vi.advanceTimersByTime(500))
    expect(useSyncDockStore.getState().phase).toBe('docked')

    setChannels([channel('c1', 'a@x.com'), channel('c3', 'c@x.com')], [channel('c2', 'b@x.com')])
    expect(useSyncDockStore.getState().phase).toBe('docked')

    setChannels([channel('c1', 'a@x.com')], [channel('c2', 'b@x.com'), channel('c4', 'd@x.com')])
    expect(useSyncDockStore.getState().phase).toBe('undocking')
  })

  it('resets to floating once nothing is syncing or needs login', () => {
    setChannels([channel('c1', 'a@x.com')], [])
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Move to sidebar' }))
    act(() => vi.advanceTimersByTime(500))

    setChannels([], [])
    expect(useSyncDockStore.getState().phase).toBe('floating')
    // The row stays mounted while it collapses, then unmounts.
    expect(screen.getByRole('button', { name: /Syncing channels/ })).toBeTruthy()
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByRole('button', { name: /Syncing channels/ })).toBeNull()
  })
})
