// apps/web/src/components/global/notifications/notification-panel-root.tsx
'use client'

import { SidePanel } from '@auxx/ui/components/side-panel'
import { useSidebar } from '@auxx/ui/components/sidebar'
import { NotificationPanel } from './notification-panel'
import { useNotificationPanelStore } from './notification-panel-store'

/** Root-level notification panel host. */
export function NotificationPanelRoot() {
  const open = useNotificationPanelStore((state) => state.open)
  const close = useNotificationPanelStore((state) => state.close)
  const width = useNotificationPanelStore((state) => state.width)
  const setWidth = useNotificationPanelStore((state) => state.setWidth)
  const { state: sidebarState, isResizing } = useSidebar()

  return (
    <SidePanel
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
      title='Notifications'
      width={width}
      offset={sidebarState === 'expanded' ? 'var(--sidebar-width)' : 0}
      onWidthChange={setWidth}
      className={isResizing ? 'transition-none' : undefined}
      resizable>
      <NotificationPanel />
    </SidePanel>
  )
}
