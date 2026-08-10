// apps/web/src/components/global/notifications/hooks/use-notification-subscription.test.ts
//
// Plan 45 §3.2 — the requester's "requested" chip after someone else decides.
//
// Deny and supersede write no grant, so they publish no `visibility:changed` —
// correctly, since the requester's ACCESS did not change. What changed is their
// REQUEST, and the signal for that is the `ACCESS_REQUEST_DECIDED` notification
// `notifyRequesterDecided` already sends on all three outcomes. This file pins
// that the handler acts on it, and only on it.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  onEvent: undefined as undefined | ((event: string, payload: unknown) => void),
  preflightInvalidate: vi.fn(),
  approvalInvalidates: {
    getPendingCount: vi.fn(),
    // `approval.list` and `approvals.list` are different routers — distinct spies,
    // or one shadows the other in this object literal and both assertions pass off
    // whichever call happened to land last.
    approvalList: vi.fn(),
    count: vi.fn(),
    list: vi.fn(),
  },
  unreadSetData: vi.fn(),
  notificationInvalidates: { getUnreadCount: vi.fn(), getNotifications: vi.fn() },
}))

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ organizationId: 'org_1' }) }))

vi.mock('~/providers/dehydrated-state-provider', () => ({
  useDehydratedSettings: () => ({ 'notification.sound.bell': false }),
}))

vi.mock('~/lib/play-notification-sound', () => ({
  NEW_MESSAGE_SOUND: 'sound',
  playNotificationSound: vi.fn(),
}))

vi.mock('~/realtime/hooks', () => ({
  useRealtimeRoom: (_room: string | null, opts: any) => {
    h.onEvent = opts.onEvent
  },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      notification: {
        getUnreadCount: {
          setData: h.unreadSetData,
          invalidate: h.notificationInvalidates.getUnreadCount,
        },
        getNotifications: { invalidate: h.notificationInvalidates.getNotifications },
      },
      approval: {
        accessRequestPreflight: { invalidate: h.preflightInvalidate },
        getPendingCount: { invalidate: h.approvalInvalidates.getPendingCount },
        list: { invalidate: h.approvalInvalidates.approvalList },
      },
      approvals: {
        count: { invalidate: h.approvalInvalidates.count },
        list: { invalidate: h.approvalInvalidates.list },
      },
    }),
  },
}))

const { useNotificationSubscription } = await import('./use-notification-subscription')

const notification = (type: string) => ({ type, organizationId: 'org_1' })

beforeEach(() => {
  h.onEvent = undefined
  h.preflightInvalidate.mockClear()
  renderHook(() => useNotificationSubscription('usr_me'))
})

describe('§3.2 — an access-request decision clears the pending chip', () => {
  it('invalidates accessRequestPreflight on ACCESS_REQUEST_DECIDED', () => {
    h.onEvent?.('notification', notification('ACCESS_REQUEST_DECIDED'))

    // Covers approve, deny AND supersede: `notifyRequesterDecided` is the single
    // funnel for all three, so there is no per-outcome branch to forget.
    expect(h.preflightInvalidate).toHaveBeenCalled()
  })

  it('leaves it alone for any other notification type', () => {
    h.onEvent?.('notification', notification('ACCESS_REQUESTED'))
    h.onEvent?.('notification', notification('MESSAGE_SHARED'))

    expect(h.preflightInvalidate).not.toHaveBeenCalled()
  })

  it('does not fire on a bare notification with no type', () => {
    h.onEvent?.('notification', { organizationId: 'org_1' })

    expect(h.preflightInvalidate).not.toHaveBeenCalled()
  })
})
