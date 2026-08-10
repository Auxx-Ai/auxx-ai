// apps/web/src/components/global/notifications/notification-panel-store.ts
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * `unread` / `all` filter the notification feed; `approvals` swaps the source
 * entirely. `unread` is the default — opening the bell should show what still
 * needs attention, not the whole archive.
 */
export type NotificationPanelMode = 'all' | 'unread' | 'approvals'

/**
 * The Approvals tab's own sub-filter. Lives here rather than in `ApprovalsTab`
 * because the switch renders in the panel's filter strip — above the scroller, so
 * it does not scroll away — while the sections that read it render inside.
 */
export type ApprovalsView = 'pending' | 'past'

interface NotificationPanelState {
  open: boolean
  width: number
  /** Active tab. Lifted out of the panel so callers can open straight onto a tab. */
  mode: NotificationPanelMode
  /** Approvals tab sub-filter — what still needs a decision, or what is decided. */
  approvalsView: ApprovalsView
  /** Approval whose row should be scrolled to and flashed once the tab renders. */
  highlightApprovalId?: string
  /**
   * Monotonic counter the sidebar bell watches to flash itself.
   *
   * The bell's own pulse keys off the count going *up*, which a reminder never
   * does — it re-pings a request that is already counted. This is the explicit
   * channel for "flash even though the number did not move".
   */
  bellPulse: number
  toggle: () => void
  close: () => void
  setWidth: (width: number) => void
  setMode: (mode: NotificationPanelMode) => void
  setApprovalsView: (view: ApprovalsView) => void
  /** Opens the panel on the Approvals tab, optionally highlighting one entry. */
  openApprovals: (highlightApprovalId?: string) => void
  clearHighlight: () => void
  /** Flash the sidebar bell once. */
  pulseBell: () => void
}

export const useNotificationPanelStore = create<NotificationPanelState>()(
  persist(
    (set) => ({
      open: false,
      width: 420,
      mode: 'unread',
      approvalsView: 'pending',
      highlightApprovalId: undefined,
      bellPulse: 0,
      toggle: () => set((state) => ({ open: !state.open })),
      close: () => set({ open: false }),
      setWidth: (width) => set({ width }),
      setMode: (mode) => set({ mode }),
      setApprovalsView: (approvalsView) => set({ approvalsView }),
      // Resets the sub-view: a caller pointing at one request is always pointing
      // at a pending one (that is what the notification is for), and landing on
      // Past would silently drop the highlight as unlisted.
      openApprovals: (highlightApprovalId) =>
        set({ open: true, mode: 'approvals', approvalsView: 'pending', highlightApprovalId }),
      clearHighlight: () => set({ highlightApprovalId: undefined }),
      pulseBell: () => set((state) => ({ bellPulse: state.bellPulse + 1 })),
    }),
    {
      name: 'auxx:notifications:panel',
      // Width only. A persisted `mode` would reopen the panel days later on
      // whatever tab was last used, which is never what the bell should show.
      partialize: (state) => ({ width: state.width }) as NotificationPanelState,
    }
  )
)
