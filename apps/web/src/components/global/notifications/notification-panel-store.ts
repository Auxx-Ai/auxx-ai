// apps/web/src/components/global/notifications/notification-panel-store.ts
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** `all` / `unread` filter the notification feed; `approvals` swaps the source entirely. */
export type NotificationPanelMode = 'all' | 'unread' | 'approvals'

interface NotificationPanelState {
  open: boolean
  width: number
  /** Active tab. Lifted out of the panel so callers can open straight onto a tab. */
  mode: NotificationPanelMode
  /** Approval whose row should be scrolled to and flashed once the tab renders. */
  highlightApprovalId?: string
  toggle: () => void
  close: () => void
  setWidth: (width: number) => void
  setMode: (mode: NotificationPanelMode) => void
  /** Opens the panel on the Approvals tab, optionally highlighting one entry. */
  openApprovals: (highlightApprovalId?: string) => void
  clearHighlight: () => void
}

export const useNotificationPanelStore = create<NotificationPanelState>()(
  persist(
    (set) => ({
      open: false,
      width: 420,
      mode: 'all',
      highlightApprovalId: undefined,
      toggle: () => set((state) => ({ open: !state.open })),
      close: () => set({ open: false }),
      setWidth: (width) => set({ width }),
      setMode: (mode) => set({ mode }),
      openApprovals: (highlightApprovalId) =>
        set({ open: true, mode: 'approvals', highlightApprovalId }),
      clearHighlight: () => set({ highlightApprovalId: undefined }),
    }),
    {
      name: 'auxx:notifications:panel',
      // Width only. A persisted `mode` would reopen the panel days later on
      // whatever tab was last used, which is never what the bell should show.
      partialize: (state) => ({ width: state.width }) as NotificationPanelState,
    }
  )
)
