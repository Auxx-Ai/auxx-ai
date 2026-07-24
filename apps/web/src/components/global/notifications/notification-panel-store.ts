// apps/web/src/components/global/notifications/notification-panel-store.ts
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotificationPanelState {
  open: boolean
  width: number
  toggle: () => void
  close: () => void
  setWidth: (width: number) => void
}

export const useNotificationPanelStore = create<NotificationPanelState>()(
  persist(
    (set) => ({
      open: false,
      width: 420,
      toggle: () => set((state) => ({ open: !state.open })),
      close: () => set({ open: false }),
      setWidth: (width) => set({ width }),
    }),
    {
      name: 'auxx:notifications:panel',
      partialize: (state) => ({ width: state.width }) as NotificationPanelState,
    }
  )
)
